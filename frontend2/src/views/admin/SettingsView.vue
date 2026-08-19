<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import DOMPurify from 'dompurify'
import * as accountsAPI from '@shared-api/admin/accounts'
import * as settingsAPI from '@shared-api/admin/settings'
import * as systemAPI from '@shared-api/admin/system'
import type {
  AdminApiKeyStatus,
  BetaPolicySettings,
  EmailTemplateDetail,
  EmailTemplateEventOption,
  EmailTemplateListResponse,
  OverloadCooldownSettings,
  PanelRateLimitSettings,
  RateLimit429CooldownSettings,
  RectifierSettings,
  StreamTimeoutSettings,
  UpdateSettingsRequest,
  WebSearchEmulationConfig,
  WebSearchTestResult,
} from '@shared-api/admin/settings'
import type { RollbackVersionInfo, VersionInfo } from '@shared-api/admin/system'
import type { OllamaCloudUsageSettings, UpstreamBillingProbeSettings } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, useStepUp } from '@/composables/useStepUp'
import {
  SettingsSection,
  StreamTimeoutAction,
  WebSearchProviderType,
  cloneData,
  isReadonlySetting,
  parseSettingDraft,
  serializeSetting,
  settingLabel,
  settingSectionForKey,
  splitLines,
  validateSettingsRecord,
} from '@/features/admin/governance/model'

type SettingsRecord = Record<string, unknown>

const SECTION_OPTIONS = [
  { id: SettingsSection.GENERAL, label: '站点与外观' },
  { id: SettingsSection.AGREEMENT, label: '协议与内容' },
  { id: SettingsSection.FEATURES, label: '功能开关' },
  { id: SettingsSection.SECURITY, label: '安全与登录' },
  { id: SettingsSection.USERS, label: '用户默认值' },
  { id: SettingsSection.GATEWAY, label: '网关与策略' },
  { id: SettingsSection.PAYMENT, label: '支付与商业化' },
  { id: SettingsSection.EMAIL, label: '邮件与通知' },
  { id: SettingsSection.ADVANCED, label: '系统与高级' },
] as const

const SECRET_FIELDS = [
  { configuredKey: 'smtp_password_configured', requestKey: 'smtp_password', label: 'SMTP 密码', section: SettingsSection.EMAIL },
  { configuredKey: 'turnstile_secret_key_configured', requestKey: 'turnstile_secret_key', label: 'Turnstile Secret Key', section: SettingsSection.SECURITY },
  { configuredKey: 'tencent_captcha_app_secret_key_configured', requestKey: 'tencent_captcha_app_secret_key', label: '腾讯验证码 App Secret', section: SettingsSection.SECURITY },
  { configuredKey: 'tencent_captcha_cloud_secret_id_configured', requestKey: 'tencent_captcha_cloud_secret_id', label: '腾讯云 Secret ID', section: SettingsSection.SECURITY },
  { configuredKey: 'tencent_captcha_cloud_secret_key_configured', requestKey: 'tencent_captcha_cloud_secret_key', label: '腾讯云 Secret Key', section: SettingsSection.SECURITY },
  { configuredKey: 'aliyun_captcha_access_key_secret_configured', requestKey: 'aliyun_captcha_access_key_secret', label: '阿里云 Access Key Secret', section: SettingsSection.SECURITY },
  { configuredKey: 'linuxdo_connect_client_secret_configured', requestKey: 'linuxdo_connect_client_secret', label: 'LinuxDo Client Secret', section: SettingsSection.GATEWAY },
  { configuredKey: 'dingtalk_connect_client_secret_configured', requestKey: 'dingtalk_connect_client_secret', label: '钉钉 Client Secret', section: SettingsSection.GATEWAY },
  { configuredKey: 'wechat_connect_app_secret_configured', requestKey: 'wechat_connect_app_secret', label: '微信兼容 App Secret', section: SettingsSection.GATEWAY },
  { configuredKey: 'wechat_connect_open_app_secret_configured', requestKey: 'wechat_connect_open_app_secret', label: '微信开放平台 App Secret', section: SettingsSection.GATEWAY },
  { configuredKey: 'wechat_connect_mp_app_secret_configured', requestKey: 'wechat_connect_mp_app_secret', label: '微信公众号 App Secret', section: SettingsSection.GATEWAY },
  { configuredKey: 'wechat_connect_mobile_app_secret_configured', requestKey: 'wechat_connect_mobile_app_secret', label: '微信移动应用 App Secret', section: SettingsSection.GATEWAY },
  { configuredKey: 'oidc_connect_client_secret_configured', requestKey: 'oidc_connect_client_secret', label: 'OIDC Client Secret', section: SettingsSection.GATEWAY },
  { configuredKey: 'github_oauth_client_secret_configured', requestKey: 'github_oauth_client_secret', label: 'GitHub Client Secret', section: SettingsSection.GATEWAY },
  { configuredKey: 'google_oauth_client_secret_configured', requestKey: 'google_oauth_client_secret', label: 'Google Client Secret', section: SettingsSection.GATEWAY },
] as const

const app = useAppStore()
const confirm = useConfirmStore()
const stepUp = useStepUp()
const loading = ref(true)
const extrasLoading = ref(true)
const saving = ref(false)
const error = ref('')
const extrasWarning = ref('')
const activeSection = ref(SettingsSection.GENERAL)
const search = ref('')
const originalSettings = ref<SettingsRecord>({})
const drafts = reactive<Record<string, string>>({})
const secretDrafts = reactive<Record<string, string>>({})
const fieldErrors = reactive<Record<string, string>>({})

const emailTemplateMeta = ref<EmailTemplateListResponse | null>(null)
const selectedTemplateEvent = ref('')
const selectedTemplateLocale = ref('')
const templateDetail = ref<EmailTemplateDetail | null>(null)
const templateDraft = reactive({ subject: '', html: '' })
const templateLoading = ref(false)
const templateSaving = ref(false)
const templatePreviewOpen = ref(false)
const templatePreviewSubject = ref('')
const templatePreviewHTML = ref('')

const adminKey = ref<AdminApiKeyStatus | null>(null)
const revealedAdminKey = ref('')
const overload = ref<OverloadCooldownSettings | null>(null)
const rate429 = ref<RateLimit429CooldownSettings | null>(null)
const panelRateLimit = ref<PanelRateLimitSettings | null>(null)
const streamTimeout = ref<StreamTimeoutSettings | null>(null)
const rectifier = ref<RectifierSettings | null>(null)
const rectifierPatterns = ref('')
const betaPolicy = ref<BetaPolicySettings | null>(null)
const betaPolicyDraft = ref('')
const webSearch = ref<WebSearchEmulationConfig | null>(null)
const webSearchQuery = ref('Claude Code release notes')
const webSearchResult = ref<WebSearchTestResult | null>(null)
const upstreamProbe = ref<UpstreamBillingProbeSettings | null>(null)
const ollamaUsage = ref<OllamaCloudUsageSettings | null>(null)
const smtpTestRecipient = ref('')
const actionBusy = ref('')

const versionInfo = ref<VersionInfo | null>(null)
const rollbackVersions = ref<RollbackVersionInfo[]>([])
const rollbackTarget = ref('')
const systemBusy = ref('')

const visibleSettingsKeys = computed(() => Object.keys(originalSettings.value).filter((key) => !isReadonlySetting(key)))
const activeSecrets = computed(() => SECRET_FIELDS.filter((field) => field.section === activeSection.value))
const sectionCounts = computed(() => {
  const counts = Object.fromEntries(SECTION_OPTIONS.map((section) => [section.id, 0])) as Record<SettingsSection, number>
  for (const key of Object.keys(originalSettings.value)) counts[settingSectionForKey(key)] += 1
  return counts
})
const visibleEntries = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return Object.keys(originalSettings.value)
    .filter((key) => settingSectionForKey(key) === activeSection.value && !isReadonlySetting(key))
    .filter((key) => !needle || key.toLowerCase().includes(needle) || settingLabel(key).toLowerCase().includes(needle))
    .sort((left, right) => settingLabel(left).localeCompare(settingLabel(right), 'zh-CN'))
})
const readonlyEntries = computed(() => Object.keys(originalSettings.value)
  .filter((key) => settingSectionForKey(key) === activeSection.value && isReadonlySetting(key))
  .sort())
const changedKeys = computed(() => visibleSettingsKeys.value.filter((key) => {
  try { return JSON.stringify(parseSettingDraft(drafts[key], originalSettings.value[key])) !== JSON.stringify(originalSettings.value[key]) }
  catch { return true }
}))
const pendingSecretCount = computed(() => Object.values(secretDrafts).filter((value) => value.trim()).length)
const hasUnsavedSettings = computed(() => changedKeys.value.length > 0 || pendingSecretCount.value > 0)
const sanitizedTemplatePreview = computed(() => DOMPurify.sanitize(templatePreviewHTML.value))

function warnBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedSettings.value) return
  event.preventDefault()
  event.returnValue = ''
}

function hydrateSettings(value: SettingsRecord): void {
  originalSettings.value = cloneData(value)
  for (const key of Object.keys(drafts)) delete drafts[key]
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key]
  for (const [key, setting] of Object.entries(value)) drafts[key] = serializeSetting(setting)
}

function inputIsLong(key: string): boolean {
  return /(content|prompt|blocks|blacklist|whitelist|description|help_text|scopes|headers|origins|documents|subscriptions|quotas|items|endpoints|emails|patterns|settings)$/.test(key)
}

function setBoolean(key: string, event: Event): void {
  drafts[key] = (event.target as HTMLInputElement).checked ? 'true' : 'false'
  delete fieldErrors[key]
}

function clearFieldError(key: string): void {
  delete fieldErrors[key]
}

function configuredLabel(value: unknown): string {
  return value === true ? '已配置' : value === false ? '未配置' : serializeSetting(value)
}

function showActionError(caught: unknown, fallback: string): void {
  if (isStepUpCancelled(caught)) return
  if (isStepUpBlocked(caught)) {
    app.showError(stepUpBlockReason(caught) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN' ? '管理员 API Key 会话不能执行此敏感操作' : '请先为管理员启用 TOTP，再执行敏感操作')
    return
  }
  app.showError((caught as { message?: string }).message || fallback)
}

async function loadSettings(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const value = await settingsAPI.getSettings()
    hydrateSettings(value as unknown as SettingsRecord)
  } catch (caught) {
    error.value = (caught as { message?: string }).message || '系统设置加载失败'
  } finally {
    loading.value = false
  }
}

async function loadExtras(): Promise<void> {
  extrasLoading.value = true
  extrasWarning.value = ''
  const failures: string[] = []
  const tasks = [
    settingsAPI.getEmailTemplates().then((value) => { emailTemplateMeta.value = value }).catch(() => failures.push('邮件模板')),
    settingsAPI.getAdminApiKey().then((value) => { adminKey.value = value }).catch(() => failures.push('管理员 Key')),
    settingsAPI.getOverloadCooldownSettings().then((value) => { overload.value = value }).catch(() => failures.push('529 冷却')),
    settingsAPI.getRateLimit429CooldownSettings().then((value) => { rate429.value = value }).catch(() => failures.push('429 冷却')),
    settingsAPI.getPanelRateLimitSettings().then((value) => { panelRateLimit.value = value }).catch(() => failures.push('面板限流')),
    settingsAPI.getStreamTimeoutSettings().then((value) => { streamTimeout.value = value }).catch(() => failures.push('流超时')),
    settingsAPI.getRectifierSettings().then((value) => { rectifier.value = value; rectifierPatterns.value = value.apikey_signature_patterns.join('\n') }).catch(() => failures.push('请求矫正')),
    settingsAPI.getBetaPolicySettings().then((value) => { betaPolicy.value = value; betaPolicyDraft.value = JSON.stringify(value, null, 2) }).catch(() => failures.push('Beta 策略')),
    settingsAPI.getWebSearchEmulationConfig().then((value) => { webSearch.value = value }).catch(() => failures.push('Web Search')),
    accountsAPI.getUpstreamBillingProbeSettings().then((value) => { upstreamProbe.value = value }).catch(() => failures.push('上游倍率探测')),
    accountsAPI.getOllamaCloudUsageSettings().then((value) => { ollamaUsage.value = value }).catch(() => failures.push('Ollama 用量')),
    loadSystemInfo().catch(() => failures.push('系统版本')),
  ]
  await Promise.all(tasks)
  if (emailTemplateMeta.value) {
    const firstEvent = emailTemplateMeta.value.events[0]
    selectedTemplateEvent.value ||= firstEvent ? templateEventValue(firstEvent) : ''
    selectedTemplateLocale.value ||= emailTemplateMeta.value.locales[0] || ''
    if (selectedTemplateEvent.value && selectedTemplateLocale.value) await loadTemplate()
  }
  extrasWarning.value = failures.length ? `${failures.join('、')}暂时无法加载；其他设置仍可正常维护。` : ''
  extrasLoading.value = false
}

async function saveSettings(): Promise<void> {
  const payload: SettingsRecord = {}
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key]
  for (const key of changedKeys.value) {
    try {
      payload[key] = parseSettingDraft(drafts[key], originalSettings.value[key])
    } catch (caught) {
      fieldErrors[key] = (caught as { message?: string }).message || '设置值格式不正确'
    }
  }
  const parseErrorKey = changedKeys.value.find((key) => fieldErrors[key])
  if (parseErrorKey) {
    activeSection.value = settingSectionForKey(parseErrorKey)
    search.value = ''
    app.showError(`${settingLabel(parseErrorKey)}：${fieldErrors[parseErrorKey]}`)
    return
  }
  for (const field of SECRET_FIELDS) {
    const value = secretDrafts[field.requestKey]?.trim()
    if (value) payload[field.requestKey] = value
  }
  if (!Object.keys(payload).length) { app.showSuccess('没有待保存的修改'); return }
  const issues = validateSettingsRecord({ ...originalSettings.value, ...payload })
  for (const issue of issues) fieldErrors[issue.key] = issue.message
  if (issues.length > 0) {
    const first = issues[0]
    activeSection.value = settingSectionForKey(first.key)
    search.value = ''
    app.showError(`${settingLabel(first.key)}：${first.message}`)
    return
  }
  saving.value = true
  try {
    const updated = await stepUp.run(() => settingsAPI.updateSettings(payload as UpdateSettingsRequest))
    hydrateSettings(updated as unknown as SettingsRecord)
    for (const key of Object.keys(secretDrafts)) secretDrafts[key] = ''
    app.showSuccess(`已保存 ${Object.keys(payload).length} 项系统设置`)
  } catch (caught) { showActionError(caught, '系统设置保存失败') }
  finally { saving.value = false }
}

function settingValue(key: string): unknown {
  try { return parseSettingDraft(drafts[key] ?? '', originalSettings.value[key]) }
  catch { return originalSettings.value[key] }
}

function smtpPayload() {
  return {
    smtp_host: String(settingValue('smtp_host') || ''),
    smtp_port: Number(settingValue('smtp_port') || 0),
    smtp_username: String(settingValue('smtp_username') || ''),
    smtp_password: secretDrafts.smtp_password || '',
    smtp_use_tls: settingValue('smtp_use_tls') === true,
  }
}

async function testSmtp(): Promise<void> {
  actionBusy.value = 'smtp-test'
  try { const result = await settingsAPI.testSmtpConnection(smtpPayload()); app.showSuccess(result.message || 'SMTP 连接成功') }
  catch (caught) { showActionError(caught, 'SMTP 连接失败') }
  finally { actionBusy.value = '' }
}

async function sendTestEmail(): Promise<void> {
  if (!smtpTestRecipient.value.trim()) { app.showError('请输入测试收件邮箱'); return }
  actionBusy.value = 'smtp-send'
  try {
    const result = await settingsAPI.sendTestEmail({
      ...smtpPayload(), email: smtpTestRecipient.value.trim(),
      smtp_from_email: String(settingValue('smtp_from_email') || ''),
      smtp_from_name: String(settingValue('smtp_from_name') || ''),
    })
    app.showSuccess(result.message || '测试邮件已发送')
  } catch (caught) { showActionError(caught, '测试邮件发送失败') }
  finally { actionBusy.value = '' }
}

function templateEventValue(option: EmailTemplateEventOption): string { return typeof option === 'string' ? option : option.value }
function templateEventLabel(option: EmailTemplateEventOption): string { return typeof option === 'string' ? option : option.label || option.value }

async function loadTemplate(): Promise<void> {
  if (!selectedTemplateEvent.value || !selectedTemplateLocale.value) return
  templateLoading.value = true
  try {
    const value = await settingsAPI.getEmailTemplate(selectedTemplateEvent.value, selectedTemplateLocale.value)
    templateDetail.value = value
    Object.assign(templateDraft, { subject: value.subject, html: value.html })
  } catch (caught) { showActionError(caught, '邮件模板加载失败') }
  finally { templateLoading.value = false }
}

async function saveTemplate(): Promise<void> {
  if (!templateDraft.subject.trim() || !templateDraft.html.trim()) { app.showError('模板主题和 HTML 不能为空'); return }
  templateSaving.value = true
  try {
    const value = await stepUp.run(() => settingsAPI.updateEmailTemplate(selectedTemplateEvent.value, selectedTemplateLocale.value, cloneData(templateDraft)))
    templateDetail.value = value
    Object.assign(templateDraft, { subject: value.subject, html: value.html })
    app.showSuccess('邮件模板已保存')
  } catch (caught) { showActionError(caught, '模板保存失败') }
  finally { templateSaving.value = false }
}

async function previewTemplate(): Promise<void> {
  try {
    const value = await settingsAPI.previewEmailTemplate({ event: selectedTemplateEvent.value, locale: selectedTemplateLocale.value, ...cloneData(templateDraft) })
    templatePreviewSubject.value = value.subject
    templatePreviewHTML.value = value.html
    templatePreviewOpen.value = true
  } catch (caught) { showActionError(caught, '模板预览生成失败') }
}

async function restoreTemplate(): Promise<void> {
  if (!await confirm.ask({ title: '恢复官方模板', message: '当前自定义主题和 HTML 将被官方模板覆盖。', confirmText: '恢复模板', tone: ConfirmTone.DANGER })) return
  templateSaving.value = true
  try {
    const value = await stepUp.run(() => settingsAPI.restoreOfficialEmailTemplate(selectedTemplateEvent.value, selectedTemplateLocale.value))
    templateDetail.value = value
    Object.assign(templateDraft, { subject: value.subject, html: value.html })
    app.showSuccess('已恢复官方模板')
  } catch (caught) { showActionError(caught, '模板恢复失败') }
  finally { templateSaving.value = false }
}

async function regenerateAdminKey(): Promise<void> {
  if (!await confirm.ask({ title: '重新生成管理员 API Key', message: '旧 Key 会立即失效，新 Key 只显示一次。', confirmText: '重新生成', tone: ConfirmTone.DANGER })) return
  actionBusy.value = 'admin-key'
  try {
    const result = await stepUp.run(() => settingsAPI.regenerateAdminApiKey())
    revealedAdminKey.value = result.key
    adminKey.value = { exists: true, masked_key: `${result.key.slice(0, 8)}••••${result.key.slice(-4)}` }
    app.showSuccess('管理员 API Key 已重新生成，请立即保存')
  } catch (caught) { showActionError(caught, 'Key 生成失败') }
  finally { actionBusy.value = '' }
}

async function deleteAdminKey(): Promise<void> {
  if (!await confirm.ask({ title: '删除管理员 API Key', message: '所有使用该 Key 的自动化将立即失效。', confirmText: '删除 Key', tone: ConfirmTone.DANGER })) return
  actionBusy.value = 'admin-key'
  try { await stepUp.run(() => settingsAPI.deleteAdminApiKey()); adminKey.value = { exists: false, masked_key: '' }; revealedAdminKey.value = ''; app.showSuccess('管理员 API Key 已删除') }
  catch (caught) { showActionError(caught, 'Key 删除失败') }
  finally { actionBusy.value = '' }
}

async function copyAdminKey(): Promise<void> {
  try { await navigator.clipboard.writeText(revealedAdminKey.value); app.showSuccess('完整 Key 已复制') }
  catch { app.showError('复制失败，请手动复制') }
}

async function saveReliabilityPolicies(): Promise<void> {
  if (!overload.value || !rate429.value || !panelRateLimit.value || !streamTimeout.value || !rectifier.value) return
  actionBusy.value = 'reliability'
  rectifier.value.apikey_signature_patterns = splitLines(rectifierPatterns.value)
  try {
    const [overloadValue, rateValue, panelValue, streamValue, rectifierValue] = await stepUp.run(() => Promise.all([
      settingsAPI.updateOverloadCooldownSettings(cloneData(overload.value!)),
      settingsAPI.updateRateLimit429CooldownSettings(cloneData(rate429.value!)),
      settingsAPI.updatePanelRateLimitSettings(cloneData(panelRateLimit.value!)),
      settingsAPI.updateStreamTimeoutSettings(cloneData(streamTimeout.value!)),
      settingsAPI.updateRectifierSettings(cloneData(rectifier.value!)),
    ]))
    overload.value = overloadValue; rate429.value = rateValue; panelRateLimit.value = panelValue; streamTimeout.value = streamValue; rectifier.value = rectifierValue
    rectifierPatterns.value = rectifierValue.apikey_signature_patterns.join('\n')
    app.showSuccess('冷却、限流、超时与请求矫正策略已保存')
  } catch (caught) { showActionError(caught, '可靠性策略保存失败') }
  finally { actionBusy.value = '' }
}

async function saveBetaPolicy(): Promise<void> {
  let payload: BetaPolicySettings
  try { payload = JSON.parse(betaPolicyDraft.value) as BetaPolicySettings; if (!Array.isArray(payload.rules)) throw new Error('rules 必须是数组') }
  catch (caught) { app.showError((caught as { message?: string }).message || 'Beta 策略 JSON 无效'); return }
  actionBusy.value = 'beta'
  try { betaPolicy.value = await stepUp.run(() => settingsAPI.updateBetaPolicySettings(payload)); betaPolicyDraft.value = JSON.stringify(betaPolicy.value, null, 2); app.showSuccess('Beta 策略已保存') }
  catch (caught) { showActionError(caught, 'Beta 策略保存失败') }
  finally { actionBusy.value = '' }
}

function addWebSearchProvider(): void {
  if (!webSearch.value) return
  webSearch.value.providers.push({ type: WebSearchProviderType.BRAVE, api_key: '', api_key_configured: false, quota_limit: null, subscribed_at: null, proxy_id: null, expires_at: null })
}

async function saveWebSearch(): Promise<void> {
  if (!webSearch.value) return
  actionBusy.value = 'web-search'
  try { webSearch.value = await stepUp.run(() => settingsAPI.updateWebSearchEmulationConfig(cloneData(webSearch.value!))); app.showSuccess('Web Search 模拟配置已保存') }
  catch (caught) { showActionError(caught, 'Web Search 配置保存失败') }
  finally { actionBusy.value = '' }
}

async function testWebSearch(): Promise<void> {
  if (!webSearchQuery.value.trim()) { app.showError('请输入测试查询'); return }
  actionBusy.value = 'web-search-test'
  try { webSearchResult.value = await settingsAPI.testWebSearchEmulation(webSearchQuery.value.trim()); app.showSuccess(`返回 ${webSearchResult.value.results.length} 条结果`) }
  catch (caught) { showActionError(caught, 'Web Search 测试失败') }
  finally { actionBusy.value = '' }
}

async function resetProviderUsage(type: WebSearchProviderType): Promise<void> {
  if (!await confirm.ask({ title: '重置用量统计', message: `确认重置 ${type} 的已用配额？`, confirmText: '重置用量', tone: ConfirmTone.DEFAULT })) return
  try { await stepUp.run(() => settingsAPI.resetWebSearchUsage({ provider_type: type })); app.showSuccess(`${type} 用量已重置`) }
  catch (caught) { showActionError(caught, '用量重置失败') }
}

async function saveAccountAutomation(): Promise<void> {
  if (!upstreamProbe.value || !ollamaUsage.value) return
  actionBusy.value = 'account-automation'
  try {
    const [probeValue, ollamaValue] = await stepUp.run(() => Promise.all([
      accountsAPI.updateUpstreamBillingProbeSettings(cloneData(upstreamProbe.value!)),
      accountsAPI.updateOllamaCloudUsageSettings(cloneData(ollamaUsage.value!)),
    ]))
    upstreamProbe.value = probeValue; ollamaUsage.value = ollamaValue
    app.showSuccess('上游倍率探测与 Ollama 用量刷新策略已保存')
  } catch (caught) { showActionError(caught, '账号自动化策略保存失败') }
  finally { actionBusy.value = '' }
}

async function loadSystemInfo(): Promise<void> {
  const [version, rollbacks] = await Promise.all([systemAPI.checkUpdates(), systemAPI.getRollbackVersions()])
  versionInfo.value = version
  rollbackVersions.value = rollbacks.versions || []
  rollbackTarget.value ||= rollbackVersions.value[0]?.version || ''
}

async function checkSystemUpdate(): Promise<void> {
  systemBusy.value = 'check'
  try { versionInfo.value = await systemAPI.checkUpdates(true); app.showSuccess(versionInfo.value.has_update ? `发现新版本 ${versionInfo.value.latest_version}` : '当前已是最新版本') }
  catch (caught) { showActionError(caught, '检查更新失败') }
  finally { systemBusy.value = '' }
}

async function performSystemUpdate(): Promise<void> {
  if (!await confirm.ask({ title: '执行系统更新', message: `将下载并应用 ${versionInfo.value?.latest_version || '最新版本'}，完成后可能需要重启服务。`, confirmText: '开始更新', tone: ConfirmTone.DANGER })) return
  systemBusy.value = 'update'
  try { const result = await stepUp.run(() => systemAPI.performUpdate()); app.showSuccess(result.message); await loadSystemInfo() }
  catch (caught) { showActionError(caught, '系统更新失败') }
  finally { systemBusy.value = '' }
}

async function rollbackSystem(): Promise<void> {
  if (!rollbackTarget.value || !await confirm.ask({ title: '回滚系统版本', message: `确认回滚到 ${rollbackTarget.value}？当前二进制会被替换。`, confirmText: '确认回滚', tone: ConfirmTone.DANGER })) return
  systemBusy.value = 'rollback'
  try { const result = await stepUp.run(() => systemAPI.rollback(rollbackTarget.value)); app.showSuccess(result.message); await loadSystemInfo() }
  catch (caught) { showActionError(caught, '系统回滚失败') }
  finally { systemBusy.value = '' }
}

async function restartSystem(): Promise<void> {
  if (!await confirm.ask({ title: '重启服务', message: '服务会短暂不可用，请确认当前没有正在执行的关键任务。', confirmText: '重启服务', tone: ConfirmTone.DANGER })) return
  systemBusy.value = 'restart'
  try { const result = await stepUp.run(() => systemAPI.restartService()); app.showSuccess(result.message) }
  catch (caught) { showActionError(caught, '服务重启失败') }
  finally { systemBusy.value = '' }
}

onBeforeRouteLeave(async () => {
  if (!hasUnsavedSettings.value || saving.value) return true
  return confirm.ask({
    title: '离开系统设置？',
    message: `仍有 ${changedKeys.value.length} 个字段和 ${pendingSecretCount.value} 个密钥草稿未保存。离开后这些修改会丢失。`,
    confirmText: '放弃修改',
    tone: ConfirmTone.DANGER,
  })
})

onMounted(() => {
  window.addEventListener('beforeunload', warnBeforeUnload)
  void loadSettings()
  void loadExtras()
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))
</script>

<template>
  <ConsoleShell>
    <main class="resource-page settings-console">
      <header class="resource-page__heading">
        <div><span class="resource-eyebrow">System Control</span><h1>系统设置</h1><p>所有现有设置字段、专项策略和高风险运维动作统一维护；保存只提交发生变化的值。</p></div>
        <div class="resource-toolbar__actions"><span v-if="changedKeys.length || pendingSecretCount" class="resource-status resource-status--degraded">{{ changedKeys.length + pendingSecretCount }} 项待保存</span><button class="resource-button" :disabled="saving" @click="saveSettings">{{ saving ? '保存中…' : '保存系统设置' }}</button></div>
      </header>

      <nav class="resource-tabs settings-tabs" aria-label="系统设置分区">
        <button v-for="section in SECTION_OPTIONS" :key="section.id" :aria-selected="activeSection === section.id" @click="activeSection = section.id; search = ''">{{ section.label }} <small>{{ sectionCounts[section.id] }}</small></button>
      </nav>

      <PageState :loading="loading" :error="error" @retry="loadSettings">
        <section class="resource-toolbar"><div class="resource-toolbar__filters"><label>搜索当前分区<input v-model="search" type="search" placeholder="名称或字段键" /></label></div><span class="muted">{{ visibleEntries.length }} 个可编辑字段 · {{ readonlyEntries.length }} 个后端状态</span></section>
        <p v-if="extrasWarning" class="governance-inline-warning">{{ extrasWarning }}</p>

        <section class="settings-field-grid">
          <article v-for="key in visibleEntries" :key="key" class="settings-field">
            <header><div><strong>{{ settingLabel(key) }}</strong><code>{{ key }}</code></div><span v-if="changedKeys.includes(key)" class="resource-status resource-status--degraded">已修改</span></header>
            <label v-if="typeof originalSettings[key] === 'boolean'" class="resource-check settings-toggle"><input type="checkbox" :checked="drafts[key] === 'true'" :aria-label="settingLabel(key)" :aria-invalid="Boolean(fieldErrors[key])" @change="setBoolean(key, $event)" /><span>{{ drafts[key] === 'true' ? '已启用' : '已停用' }}</span></label>
            <input v-else-if="typeof originalSettings[key] === 'number'" v-model="drafts[key]" type="number" step="any" :aria-label="settingLabel(key)" :aria-invalid="Boolean(fieldErrors[key])" @input="clearFieldError(key)" />
            <textarea v-else-if="Array.isArray(originalSettings[key]) || (typeof originalSettings[key] === 'object' && originalSettings[key] !== null)" v-model="drafts[key]" rows="6" spellcheck="false" :aria-label="settingLabel(key)" :aria-invalid="Boolean(fieldErrors[key])" @input="clearFieldError(key)" />
            <textarea v-else-if="inputIsLong(key)" v-model="drafts[key]" rows="4" :aria-label="settingLabel(key)" :aria-invalid="Boolean(fieldErrors[key])" @input="clearFieldError(key)" />
            <input v-else v-model="drafts[key]" :aria-label="settingLabel(key)" :aria-invalid="Boolean(fieldErrors[key])" @input="clearFieldError(key)" />
            <p v-if="fieldErrors[key]" class="settings-field__error" role="alert">{{ fieldErrors[key] }}</p>
          </article>
        </section>

        <section v-if="activeSecrets.length" class="governance-card">
          <header class="governance-card__header"><div><h2>敏感凭据</h2><p>留空表示保留当前值；后端只返回配置状态，密文本身不会回显。</p></div></header>
          <div class="resource-form-grid resource-form-grid--3"><label v-for="field in activeSecrets" :key="field.requestKey">{{ field.label }} <small>{{ configuredLabel(originalSettings[field.configuredKey]) }}</small><input v-model="secretDrafts[field.requestKey]" type="password" autocomplete="new-password" placeholder="留空不修改" /></label></div>
        </section>

        <details v-if="readonlyEntries.length" class="governance-card settings-readonly"><summary>后端计算状态（{{ readonlyEntries.length }}）</summary><dl class="governance-detail"><template v-for="key in readonlyEntries" :key="key"><dt>{{ settingLabel(key) }}<code>{{ key }}</code></dt><dd>{{ configuredLabel(originalSettings[key]) }}</dd></template></dl></details>

        <section v-if="activeSection === SettingsSection.EMAIL" class="governance-grid">
          <article class="governance-card"><header class="governance-card__header"><div><h2>SMTP 联通验证</h2><p>使用上方尚未保存的 SMTP 草稿执行测试，便于保存前确认。</p></div></header><div class="resource-form-stack"><label>测试收件邮箱<input v-model="smtpTestRecipient" type="email" placeholder="ops@example.com" /></label><div class="resource-inline-actions"><button class="resource-button resource-button--secondary" :disabled="actionBusy !== ''" @click="testSmtp">测试连接</button><button class="resource-button" :disabled="actionBusy !== ''" @click="sendTestEmail">发送测试邮件</button></div></div></article>
          <article class="governance-card governance-card--wide"><header class="governance-card__header"><div><h2>事件邮件模板</h2><p>按事件和语言编辑主题与 HTML，支持变量预览和恢复官方版本。</p></div><span v-if="templateDetail" :class="['resource-status', templateDetail.is_custom && 'resource-status--active']">{{ templateDetail.is_custom ? '自定义' : '官方' }}</span></header><div class="resource-form-grid"><label>事件<select v-model="selectedTemplateEvent" @change="loadTemplate"><option v-for="event in emailTemplateMeta?.events || []" :key="templateEventValue(event)" :value="templateEventValue(event)">{{ templateEventLabel(event) }}</option></select></label><label>语言<select v-model="selectedTemplateLocale" @change="loadTemplate"><option v-for="locale in emailTemplateMeta?.locales || []" :key="locale" :value="locale">{{ locale }}</option></select></label></div><div v-if="templateLoading" class="page-state">正在加载模板…</div><div v-else-if="templateDetail" class="resource-form-stack"><label>邮件主题<input v-model="templateDraft.subject" /></label><label>HTML 模板<textarea v-model="templateDraft.html" rows="14" spellcheck="false" /></label><p class="muted">可用变量：{{ (templateDetail.placeholders || emailTemplateMeta?.placeholders || []).join('、') || '以后端事件定义为准' }}</p><div class="resource-inline-actions"><button class="resource-button resource-button--secondary" @click="previewTemplate">预览</button><button class="resource-button resource-button--secondary" :disabled="templateSaving" @click="restoreTemplate">恢复官方</button><button class="resource-button" :disabled="templateSaving" @click="saveTemplate">{{ templateSaving ? '保存中…' : '保存模板' }}</button></div></div></article>
        </section>

        <template v-if="activeSection === SettingsSection.SECURITY">
          <article class="governance-card"><header class="governance-card__header"><div><h2>管理员 API Key</h2><p>用于可信自动化调用管理接口；重新生成后旧 Key 立即失效。</p></div><span :class="['resource-status', adminKey?.exists && 'resource-status--active']">{{ adminKey?.exists ? adminKey.masked_key : '未创建' }}</span></header><div v-if="revealedAdminKey" class="governance-danger-zone"><strong>仅显示一次</strong><code class="settings-one-time-key">{{ revealedAdminKey }}</code><button class="resource-button resource-button--secondary" @click="copyAdminKey">复制完整 Key</button></div><div class="resource-inline-actions"><button class="resource-button" :disabled="actionBusy !== ''" @click="regenerateAdminKey">{{ adminKey?.exists ? '重新生成' : '生成 Key' }}</button><button v-if="adminKey?.exists" class="resource-button resource-button--danger" :disabled="actionBusy !== ''" @click="deleteAdminKey">删除 Key</button></div></article>
        </template>

        <template v-if="activeSection === SettingsSection.GATEWAY">
          <section v-if="overload && rate429 && panelRateLimit && streamTimeout && rectifier" class="governance-grid">
            <article class="governance-card"><header class="governance-card__header"><div><h2>上游冷却</h2><p>分别处理 529 过载与 429 限流。</p></div></header><div class="resource-form-stack"><label class="resource-check"><input v-model="overload.enabled" type="checkbox" />启用 529 冷却</label><label>529 冷却分钟<input v-model.number="overload.cooldown_minutes" type="number" min="1" /></label><label class="resource-check"><input v-model="rate429.enabled" type="checkbox" />启用 429 冷却</label><label>429 冷却秒<input v-model.number="rate429.cooldown_seconds" type="number" min="1" /></label></div></article>
            <article class="governance-card"><header class="governance-card__header"><div><h2>面板 API 限流</h2><p>登录用户按账号，公共接口按真实客户端 IP。</p></div></header><div class="resource-form-stack"><label class="resource-check"><input v-model="panelRateLimit.enabled" type="checkbox" />启用面板限流</label><div class="resource-form-grid"><label>用户 RPM<input v-model.number="panelRateLimit.user_rpm" type="number" /></label><label>重接口 RPM<input v-model.number="panelRateLimit.heavy_rpm" type="number" /></label><label>公共 IP RPM<input v-model.number="panelRateLimit.public_ip_rpm" type="number" /></label></div><label class="resource-check"><input v-model="panelRateLimit.exempt_admin" type="checkbox" />管理员豁免</label></div></article>
            <article class="governance-card"><header class="governance-card__header"><div><h2>流超时处置</h2><p>连续超时达到窗口阈值后的账号动作。</p></div></header><div class="resource-form-stack"><label class="resource-check"><input v-model="streamTimeout.enabled" type="checkbox" />启用流超时检测</label><label>动作<select v-model="streamTimeout.action"><option :value="StreamTimeoutAction.TEMP_UNSCHEDULE">临时下线</option><option :value="StreamTimeoutAction.ERROR">记为错误</option><option :value="StreamTimeoutAction.NONE">仅记录</option></select></label><div class="resource-form-grid"><label>临时下线分钟<input v-model.number="streamTimeout.temp_unsched_minutes" type="number" /></label><label>阈值次数<input v-model.number="streamTimeout.threshold_count" type="number" /></label><label>统计窗口分钟<input v-model.number="streamTimeout.threshold_window_minutes" type="number" /></label></div></div></article>
            <article class="governance-card"><header class="governance-card__header"><div><h2>请求矫正器</h2><p>修正 thinking 与 API Key 签名兼容问题。</p></div></header><div class="resource-form-stack"><label class="resource-check"><input v-model="rectifier.enabled" type="checkbox" />启用矫正器</label><label class="resource-check"><input v-model="rectifier.thinking_signature_enabled" type="checkbox" />修正 thinking signature</label><label class="resource-check"><input v-model="rectifier.thinking_budget_enabled" type="checkbox" />修正 thinking budget</label><label class="resource-check"><input v-model="rectifier.apikey_signature_enabled" type="checkbox" />启用 Key 签名模式</label><label>签名模式（每行一个）<textarea v-model="rectifierPatterns" rows="5" /></label></div></article>
          </section>
          <div v-if="overload && rate429 && panelRateLimit && streamTimeout && rectifier" class="governance-sticky-actions"><span>这组设置由 5 个现有专项接口分别保存。</span><button class="resource-button" :disabled="actionBusy !== ''" @click="saveReliabilityPolicies">保存可靠性策略</button></div>

          <section v-if="upstreamProbe && ollamaUsage" class="governance-grid">
            <article class="governance-card"><header class="governance-card__header"><div><h2>上游倍率自动探测</h2><p>定期同步 OpenAI Key 所连接上游站点声明的计费倍率。</p></div></header><div class="resource-form-stack"><label class="resource-check"><input v-model="upstreamProbe.enabled" type="checkbox" />启用全局探测</label><label>探测周期分钟<input v-model.number="upstreamProbe.interval_minutes" type="number" min="5" max="1440" /></label></div></article>
            <article class="governance-card"><header class="governance-card__header"><div><h2>Ollama Cloud 用量</h2><p>请求活跃时延后刷新，安静窗口结束后再抓取用量。</p></div></header><div class="resource-form-stack"><label class="resource-check"><input v-model="ollamaUsage.enabled" type="checkbox" />启用全局刷新</label><label>安静窗口分钟<input v-model.number="ollamaUsage.debounce_minutes" type="number" min="1" /></label><label>最长等待分钟<input v-model.number="ollamaUsage.interval_minutes" type="number" min="1" /></label></div></article>
          </section>
          <button v-if="upstreamProbe && ollamaUsage" class="resource-button" :disabled="actionBusy !== ''" @click="saveAccountAutomation">保存账号自动化策略</button>

          <section class="governance-grid">
            <article v-if="betaPolicy" class="governance-card"><header class="governance-card__header"><div><h2>Anthropic Beta 策略</h2><p>完整规则按现有契约编辑，保存前校验 JSON 与 rules 数组。</p></div></header><textarea v-model="betaPolicyDraft" rows="16" spellcheck="false" /><button class="resource-button" :disabled="actionBusy !== ''" @click="saveBetaPolicy">保存 Beta 策略</button></article>
            <article v-if="webSearch" class="governance-card governance-card--wide"><header class="governance-card__header"><div><h2>Web Search 模拟</h2><p>配置 Brave/Tavily 凭据、配额、代理、订阅和到期时间。</p></div><label class="resource-check"><input v-model="webSearch.enabled" type="checkbox" />启用</label></header><div class="governance-list"><article v-for="(provider, index) in webSearch.providers" :key="`${provider.type}-${index}`" class="settings-provider"><div class="resource-form-grid resource-form-grid--3"><label>提供商<select v-model="provider.type"><option :value="WebSearchProviderType.BRAVE">Brave</option><option :value="WebSearchProviderType.TAVILY">Tavily</option></select></label><label>API Key <small>{{ provider.api_key_configured ? '已配置' : '未配置' }}</small><input v-model="provider.api_key" type="password" autocomplete="new-password" placeholder="留空保留" /></label><label>配额<input v-model.number="provider.quota_limit" type="number" /></label><label>已用<input :value="provider.quota_used ?? 0" disabled /></label><label>代理 ID<input v-model.number="provider.proxy_id" type="number" /></label><label>订阅时间戳<input v-model.number="provider.subscribed_at" type="number" /></label><label>到期时间戳<input v-model.number="provider.expires_at" type="number" /></label></div><div class="resource-inline-actions"><button class="resource-link" @click="resetProviderUsage(provider.type as WebSearchProviderType)">重置用量</button><button class="resource-link resource-link--danger" @click="webSearch.providers.splice(index, 1)">移除</button></div></article></div><div class="resource-inline-actions"><button class="resource-button resource-button--secondary" @click="addWebSearchProvider">添加提供商</button><button class="resource-button" :disabled="actionBusy !== ''" @click="saveWebSearch">保存 Web Search</button></div><div class="settings-web-test"><label>联通测试<input v-model="webSearchQuery" @keyup.enter="testWebSearch" /></label><button class="resource-button resource-button--secondary" :disabled="actionBusy !== ''" @click="testWebSearch">测试搜索</button></div><div v-if="webSearchResult" class="governance-list"><article v-for="result in webSearchResult.results" :key="result.url"><div><a :href="result.url" target="_blank" rel="noreferrer">{{ result.title }}</a><small>{{ result.snippet }}</small></div><span>{{ result.page_age || '—' }}</span></article></div></article>
          </section>
        </template>

        <section v-if="activeSection === SettingsSection.PAYMENT" class="governance-card settings-delegation"><div><h2>商业化专项入口</h2><p>本页保留全部支付、返利和功能开关字段；计划、支付渠道、订单及兑换码的结构化管理在对应工作台完成。</p></div><div class="resource-inline-actions"><RouterLink class="resource-button" to="/admin/orders/plans">计划与支付</RouterLink><RouterLink class="resource-button resource-button--secondary" to="/admin/orders">订单管理</RouterLink><RouterLink class="resource-button resource-button--secondary" to="/admin/redeem">兑换码</RouterLink></div></section>

        <template v-if="activeSection === SettingsSection.ADVANCED">
          <section class="governance-card"><header class="governance-card__header"><div><h2>系统版本与运行控制</h2><p>检查更新、原地升级、回滚和重启均复用现有后端能力，并要求危险操作确认。</p></div><span class="resource-status">{{ versionInfo?.build_type || '未知构建' }}</span></header><div v-if="versionInfo" class="resource-summary"><div><span>当前版本</span><strong>{{ versionInfo.current_version }}</strong></div><div><span>最新版本</span><strong>{{ versionInfo.latest_version }}</strong></div><div><span>更新状态</span><strong>{{ versionInfo.has_update ? '可更新' : '已是最新' }}</strong></div><div><span>数据来源</span><strong>{{ versionInfo.cached ? '缓存' : '实时' }}</strong></div></div><p v-if="versionInfo?.warning" class="governance-inline-warning">{{ versionInfo.warning }}</p><div class="resource-inline-actions"><button class="resource-button resource-button--secondary" :disabled="systemBusy !== ''" @click="checkSystemUpdate">检查更新</button><button class="resource-button" :disabled="systemBusy !== '' || !versionInfo?.has_update" @click="performSystemUpdate">升级到最新版本</button><select v-model="rollbackTarget"><option value="">选择回滚版本</option><option v-for="item in rollbackVersions" :key="item.version" :value="item.version">{{ item.version }} · {{ item.published_at }}</option></select><button class="resource-button resource-button--secondary" :disabled="systemBusy !== '' || !rollbackTarget" @click="rollbackSystem">回滚</button><button class="resource-button resource-button--danger" :disabled="systemBusy !== ''" @click="restartSystem">重启服务</button></div></section>
          <section class="governance-card settings-delegation"><div><h2>数据、备份与运维专项</h2><p>入口从设置页保持可发现，但读写在专用工作台完成，避免同一配置出现两个保存源。</p></div><div class="resource-inline-actions"><RouterLink class="resource-button" to="/admin/data">数据与备份</RouterLink><RouterLink class="resource-button resource-button--secondary" to="/admin/ops">实时运维</RouterLink></div></section>
        </template>

        <div class="governance-sticky-actions"><span>{{ changedKeys.length }} 个字段、{{ pendingSecretCount }} 个密钥等待保存。切换分区不会丢失草稿。</span><button class="resource-button" :disabled="saving" @click="saveSettings">{{ saving ? '保存中…' : '保存系统设置' }}</button></div>
      </PageState>
    </main>

    <SurfaceDialog :show="templatePreviewOpen" :title="templatePreviewSubject || '邮件模板预览'" description="预览内容已经过前端安全清洗；实际发送仍由后端模板引擎渲染。" :width="DialogWidth.WIDE" @close="templatePreviewOpen = false"><div class="settings-email-preview" v-html="sanitizedTemplatePreview" /></SurfaceDialog>
    <TotpStepUpDialog :controller="stepUp" />
  </ConsoleShell>
</template>

<style scoped>
.settings-console { padding-bottom: 110px; }
.settings-tabs { position: sticky; top: 70px; z-index: 12; padding-block: 8px; background: color-mix(in srgb, var(--surface-canvas) 92%, transparent); backdrop-filter: blur(12px); }
.settings-tabs small { margin-left: 4px; opacity: .6; }
.settings-field-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.settings-field { min-width: 0; padding: 16px; display: grid; align-content: start; gap: 12px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 14px; }
.settings-field header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.settings-field header > div { min-width: 0; display: grid; gap: 4px; }
.settings-field strong { font-size: 12px; }
.settings-field code, .settings-readonly code { display: block; overflow-wrap: anywhere; color: var(--text-tertiary); font-size: var(--font-meta); }
.settings-field input:not([type='checkbox']), .settings-field textarea { width: 100%; min-width: 0; }
.settings-field textarea { font-family: var(--font-mono, monospace); font-size: var(--font-meta); }
.settings-field [aria-invalid='true'] { border-color: color-mix(in srgb, var(--danger) 68%, var(--border-subtle)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 10%, transparent); }
.settings-field__error { margin: -4px 0 0; color: var(--danger); font-size: var(--font-meta); line-height: 1.45; }
.settings-toggle { min-height: 38px; }
.settings-readonly summary { cursor: pointer; font-weight: 760; }
.settings-readonly .governance-detail { margin-top: 18px; }
.settings-one-time-key { display: block; margin: 10px 0; padding: 12px; overflow-wrap: anywhere; user-select: all; }
.settings-provider { display: grid !important; gap: 12px; align-items: stretch !important; }
.settings-web-test { margin-top: 18px; display: flex; align-items: end; gap: 8px; }
.settings-web-test label { flex: 1; }
.settings-delegation { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.settings-delegation h2 { margin: 0 0 6px; }
.settings-delegation p { margin: 0; color: var(--text-secondary); }
.settings-email-preview { padding: 18px; overflow: auto; color: #15131b; background: #fff; border-radius: 12px; }
.governance-inline-warning { padding: 12px 14px; color: var(--warning-text, #8a5a00); background: var(--warning-soft, #fff3d0); border-radius: 10px; font-size: var(--font-body-sm); }
@media (max-width: 1180px) { .settings-field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .settings-tabs { position: static; } .settings-field-grid { grid-template-columns: 1fr; } .settings-delegation, .settings-web-test { align-items: stretch; flex-direction: column; } }
</style>
