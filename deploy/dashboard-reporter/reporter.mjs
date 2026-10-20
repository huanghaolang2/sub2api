import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { chromium } from 'playwright'

const env = process.env

function required(name) {
  const value = String(env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function optional(name, fallback = '') {
  const value = String(env[name] || '').trim()
  return value || fallback
}

function intEnv(name, fallback) {
  const value = Number.parseInt(optional(name), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseJsonEnv(name, fallback = {}) {
  const raw = optional(name)
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be an object')
    return value
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`)
  }
}

function parseMentionIds() {
  return optional('FEISHU_MENTION_OPEN_IDS')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function safeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dashboard'
}

function reportFilename(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: optional('REPORT_TIMEZONE', 'Asia/Shanghai'),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value
    return result
  }, {})
  const stamp = `${parts.year}-${parts.month}-${parts.day}`
  return `${safeFilename(optional('REPORT_FILE_PREFIX', 'cyds-dashboard'))}-${stamp}.png`
}

function getPath(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object)
}

async function readStorageState() {
  const filename = optional('DASHBOARD_STORAGE_STATE', '/data/dashboard-storage-state.json')
  try {
    await fs.access(filename)
    return filename
  } catch {
    return undefined
  }
}

async function loginIfNeeded(page) {
  const loginEmail = optional('DASHBOARD_LOGIN_EMAIL')
  const loginPassword = optional('DASHBOARD_LOGIN_PASSWORD')
  if (!loginEmail && !loginPassword) return
  if (!loginEmail || !loginPassword) throw new Error('DASHBOARD_LOGIN_EMAIL and DASHBOARD_LOGIN_PASSWORD must be set together')

  const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="username"]').first()
  const passwordInput = page.locator('input[type="password"], input[name="password"], input[autocomplete="current-password"]').first()
  if (!(await emailInput.isVisible().catch(() => false)) || !(await passwordInput.isVisible().catch(() => false))) return

  await emailInput.fill(loginEmail)
  await passwordInput.fill(loginPassword)
  const submit = page.locator('button[type="submit"], button:has-text("登录"), button:has-text("Sign in")').first()
  if (!(await submit.isVisible().catch(() => false))) throw new Error('dashboard login button was not found')
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: intEnv('DASHBOARD_TIMEOUT_MS', 60000) }).catch(() => {}),
    submit.click(),
  ])
}

async function captureDashboard() {
  const dashboardUrl = required('DASHBOARD_URL')
  const timeout = intEnv('DASHBOARD_TIMEOUT_MS', 60000)
  const storageState = await readStorageState()
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext(storageState ? { storageState } : {})
    const page = await context.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
    await page.goto(dashboardUrl, { waitUntil: 'networkidle', timeout })
    await loginIfNeeded(page)
    await page.goto(dashboardUrl, { waitUntil: 'networkidle', timeout })
    if (/\/login(?:[/?#]|$)/i.test(page.url())) {
      throw new Error('dashboard login is required; configure DASHBOARD_STORAGE_STATE or login credentials')
    }
    await page.waitForTimeout(intEnv('DASHBOARD_SETTLE_MS', 1500))

    const bodyText = await page.locator('body').innerText()
    const outputPath = optional('DASHBOARD_SCREENSHOT_PATH', '/tmp/sub2api-dashboard.png')
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await page.screenshot({ path: outputPath, fullPage: true })
    return { outputPath, bodyText }
  } finally {
    await browser.close()
  }
}

function extractSummary(bodyText) {
  const text = bodyText.replaceAll('\u00a0', ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n').trim()
  const period = text.match(/\d{4}-\d{2}-\d{2} 到 \d{4}-\d{2}-\d{2}/)?.[0] || '当前周期'
  const users = text.match(/使用人数\s+([^\n]+)/)?.[1]?.trim() || '暂无数据'
  const tokens = text.match(/Token 使用量\s+([^\n]+)/)?.[1]?.trim() || '暂无数据'
  const top = text.match(/当周使用 Top[\s\S]{0,160}?Tokens\s+([^\n]+)/)?.[1]?.trim() || '暂无数据'
  return { period, users, tokens, top }
}

async function uploadScreenshot(filename, outputPath) {
  const mode = optional('COS_UPLOAD_MODE', 'presigned_api')
  const bytes = await fs.readFile(outputPath)
  const contentType = 'image/png'
  const baseHeaders = parseJsonEnv('COS_UPLOAD_HEADERS_JSON')

  if (mode === 'presigned_api') {
    const endpoint = required('COS_UPLOAD_URL')
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...baseHeaders },
      body: JSON.stringify({ filename, content_type: contentType, size: bytes.length }),
    })
    if (!response.ok) throw new Error(`COS presign request failed with HTTP ${response.status}`)
    const payload = await response.json()
    const uploadUrl = getPath(payload, optional('COS_UPLOAD_URL_FIELD', 'upload_url'))
    const publicUrl = getPath(payload, optional('COS_PUBLIC_URL_FIELD', 'public_url'))
    if (!uploadUrl || !publicUrl) throw new Error('COS presign response must contain upload_url and public_url')
    const putResponse = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes })
    if (!putResponse.ok) throw new Error(`COS upload failed with HTTP ${putResponse.status}`)
    return String(publicUrl)
  }

  if (mode === 'multipart') {
    const endpoint = required('COS_UPLOAD_URL')
    const form = new FormData()
    form.append('file', new File([bytes], filename, { type: contentType }))
    form.append('filename', filename)
    const response = await fetch(endpoint, { method: 'POST', headers: baseHeaders, body: form })
    if (!response.ok) throw new Error(`COS multipart upload failed with HTTP ${response.status}`)
    const payload = await response.json()
    const publicUrl = getPath(payload, optional('COS_PUBLIC_URL_FIELD', 'url'))
    if (!publicUrl) throw new Error('COS multipart response does not contain the configured public URL field')
    return String(publicUrl)
  }

  throw new Error(`unsupported COS_UPLOAD_MODE: ${mode}`)
}

function buildWebhookUrl() {
  const base = required('FEISHU_WEBHOOK_URL')
  const secret = optional('FEISHU_WEBHOOK_SECRET')
  if (!secret) return base
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const sign = crypto.createHmac('sha256', `${timestamp}\n${secret}`).digest('base64')
  const url = new URL(base)
  url.searchParams.set('timestamp', timestamp)
  url.searchParams.set('sign', sign)
  return url.toString()
}

function buildPostContent(summary, screenshotUrl, filename, imageKey = '') {
  const mentions = parseMentionIds()
  const mentionNodes = mentions.map((userId) => ({ tag: 'at', user_id: userId }))
  const title = optional('REPORT_TITLE', 'cyds 看板周报')
  const content = [
    [{ tag: 'text', text: `${title}（${summary.period}）` }, ...mentionNodes],
    [{ tag: 'text', text: `使用人数：${summary.users}` }],
    [{ tag: 'text', text: `Token 使用量：${summary.tokens}` }],
    [{ tag: 'text', text: `当周使用 Top：${summary.top}` }],
  ]
  if (imageKey) content.push([{ tag: 'img', image_key: imageKey }])
  if (screenshotUrl) content.push([{ tag: 'text', text: '截图：' }, { tag: 'a', text: filename, href: screenshotUrl }])
  return { title, content }
}

function buildWebhookPayload(summary, screenshotUrl, filename) {
  const post = buildPostContent(summary, screenshotUrl, filename)
  return { msg_type: 'post', content: { zh_cn: post } }
}

async function sendWebhook(payload) {
  const endpoint = buildWebhookUrl()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`Feishu webhook failed with HTTP ${response.status}`)
  const result = await response.json().catch(() => ({}))
  const code = Number(result.code)
  if (Number.isFinite(code) && code !== 0) throw new Error(`Feishu webhook rejected the message: ${result.msg || result.code}`)
  return result
}

async function getTenantAccessToken() {
  const apiBase = optional('FEISHU_API_BASE_URL', 'https://open.feishu.cn').replace(/\/$/, '')
  const response = await fetch(`${apiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: required('FEISHU_APP_ID'), app_secret: required('FEISHU_APP_SECRET') }),
  })
  if (!response.ok) throw new Error(`Feishu token request failed with HTTP ${response.status}`)
  const payload = await response.json()
  if (!payload.tenant_access_token) throw new Error(`Feishu token request rejected: ${payload.msg || payload.code || 'unknown error'}`)
  return String(payload.tenant_access_token)
}

async function uploadImageToFeishu(outputPath, accessToken) {
  const apiBase = optional('FEISHU_API_BASE_URL', 'https://open.feishu.cn').replace(/\/$/, '')
  const bytes = await fs.readFile(outputPath)
  const form = new FormData()
  form.append('image_type', 'message')
  form.append('image', new File([bytes], reportFilename(), { type: 'image/png' }))
  const response = await fetch(`${apiBase}/open-apis/im/v1/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  if (!response.ok) throw new Error(`Feishu image upload failed with HTTP ${response.status}`)
  const payload = await response.json()
  const imageKey = payload?.data?.image_key
  if (!imageKey) throw new Error(`Feishu image upload rejected: ${payload.msg || payload.code || 'missing image_key'}`)
  return String(imageKey)
}

async function sendAppMessage(post, accessToken) {
  const apiBase = optional('FEISHU_API_BASE_URL', 'https://open.feishu.cn').replace(/\/$/, '')
  const response = await fetch(`${apiBase}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      receive_id: required('FEISHU_CHAT_ID'),
      msg_type: 'post',
      content: JSON.stringify({ zh_cn: post }),
    }),
  })
  if (!response.ok) throw new Error(`Feishu app message failed with HTTP ${response.status}`)
  const payload = await response.json().catch(() => ({}))
  const code = Number(payload.code)
  if (Number.isFinite(code) && code !== 0) throw new Error(`Feishu app message rejected: ${payload.msg || payload.code}`)
  return payload
}

async function main() {
  const { outputPath, bodyText } = await captureDashboard()
  const filename = reportFilename()
  const summary = extractSummary(bodyText)
  if (optional('REPORT_DRY_RUN', 'false').toLowerCase() === 'true') {
    console.log(JSON.stringify({ filename, summary, screenshotPath: outputPath, mentionCount: parseMentionIds().length }, null, 2))
    return
  }
  const transport = optional('FEISHU_TRANSPORT', 'app').toLowerCase()
  let result
  let screenshotUrl = ''
  if (transport === 'app') {
    const accessToken = await getTenantAccessToken()
    const imageKey = await uploadImageToFeishu(outputPath, accessToken)
    if (optional('COS_UPLOAD_MODE', 'disabled') !== 'disabled' && optional('COS_UPLOAD_URL')) {
      screenshotUrl = await uploadScreenshot(filename, outputPath)
    }
    result = await sendAppMessage(buildPostContent(summary, screenshotUrl, filename, imageKey), accessToken)
  } else if (transport === 'webhook') {
    screenshotUrl = await uploadScreenshot(filename, outputPath)
    result = await sendWebhook(buildWebhookPayload(summary, screenshotUrl, filename))
  } else {
    throw new Error(`unsupported FEISHU_TRANSPORT: ${transport}`)
  }
  console.log(JSON.stringify({ ok: true, filename, summary, messageCode: result.code ?? 0 }, null, 2))
}

main().catch((error) => {
  console.error(`[dashboard-reporter] ${error.message}`)
  process.exitCode = 1
})
