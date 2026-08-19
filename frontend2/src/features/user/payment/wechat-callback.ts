export enum WechatPaymentCallbackState {
  PROCESSING = 'processing',
  ERROR = 'error'
}

export interface WechatPaymentCallbackInput {
  fragment: URLSearchParams
  query: Record<string, unknown>
  origin: string
}

export interface WechatPaymentCallbackTarget {
  path: string
  query: Record<string, string>
}

export interface WechatPaymentCallbackResult {
  state: WechatPaymentCallbackState
  target?: WechatPaymentCallbackTarget
  error?: string
}

const PURCHASE_PATH = '/app/purchase'

function queryString(query: Record<string, unknown>, key: string): string {
  const value = query[key]
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function readParam(input: WechatPaymentCallbackInput, key: string): string {
  return input.fragment.get(key) || queryString(input.query, key)
}

function normalizeRedirectPath(path: string): string {
  const value = path.trim()
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('://')) {
    return PURCHASE_PATH
  }
  if (value === '/payment' || value === '/purchase') return PURCHASE_PATH
  if (value.startsWith('/payment?')) return `${PURCHASE_PATH}${value.slice('/payment'.length)}`
  if (value.startsWith('/purchase?')) return `${PURCHASE_PATH}${value.slice('/purchase'.length)}`
  return value
}

function append(query: Record<string, string>, key: string, value: string): void {
  if (value) query[key] = value
}

export function resolveWechatPaymentCallback(
  input: WechatPaymentCallbackInput
): WechatPaymentCallbackResult {
  const providerError = readParam(input, 'error')
    || readParam(input, 'err_msg')
    || readParam(input, 'errmsg')
  const providerMessage = readParam(input, 'error_description') || readParam(input, 'message')
  if (providerError) {
    return {
      state: WechatPaymentCallbackState.ERROR,
      error: providerMessage || providerError
    }
  }

  const resumeToken = readParam(input, 'wechat_resume_token')
  const openid = readParam(input, 'openid')
  if (!resumeToken && !openid) {
    return {
      state: WechatPaymentCallbackState.ERROR,
      error: '微信支付回调缺少恢复令牌，请返回支付页重新发起。'
    }
  }

  const redirectUrl = new URL(normalizeRedirectPath(readParam(input, 'redirect')), input.origin)
  const query: Record<string, string> = {
    ...Object.fromEntries(redirectUrl.searchParams.entries()),
    wechat_resume: '1'
  }

  if (resumeToken) {
    query.wechat_resume_token = resumeToken
  } else {
    query.openid = openid
    append(query, 'state', readParam(input, 'state'))
    append(query, 'scope', readParam(input, 'scope'))
    append(query, 'payment_type', readParam(input, 'payment_type'))
    append(query, 'amount', readParam(input, 'amount'))
    append(query, 'order_type', readParam(input, 'order_type'))
    append(query, 'plan_id', readParam(input, 'plan_id'))
  }

  return {
    state: WechatPaymentCallbackState.PROCESSING,
    target: { path: redirectUrl.pathname, query }
  }
}

export function parseWechatPaymentFragment(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
}
