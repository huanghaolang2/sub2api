import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import type {
  CreateOrderRequest,
  CreateOrderResult,
  MethodLimit,
  OrderType,
  SubscriptionPlan,
  WechatJSAPIPayload,
  WechatOAuthInfo
} from '@/types/payment'

export enum PaymentTab {
  RECHARGE = 'recharge',
  SUBSCRIPTION = 'subscription'
}

export enum PaymentPhase {
  SELECT = 'select',
  PAYING = 'paying'
}

export enum VisiblePaymentMethod {
  ALIPAY = 'alipay',
  WXPAY = 'wxpay',
  STRIPE = 'stripe',
  AIRWALLEX = 'airwallex'
}

export enum PaymentLaunchKind {
  QR_WAITING = 'qr_waiting',
  ALIPAY_DEEP_LINK = 'alipay_deep_link',
  REDIRECT_WAITING = 'redirect_waiting',
  STRIPE_POPUP = 'stripe_popup',
  STRIPE_ROUTE = 'stripe_route',
  AIRWALLEX_ROUTE = 'airwallex_route',
  WECHAT_OAUTH = 'wechat_oauth',
  WECHAT_JSAPI = 'wechat_jsapi',
  UNHANDLED = 'unhandled'
}

export const PAYMENT_RECOVERY_STORAGE_KEY = 'payment.recovery.current'
export const DEFAULT_PAYMENT_CURRENCY = 'CNY'
export const PAYMENT_METHOD_ORDER = [
  VisiblePaymentMethod.ALIPAY,
  VisiblePaymentMethod.WXPAY,
  VisiblePaymentMethod.STRIPE,
  VisiblePaymentMethod.AIRWALLEX
] as const

const VISIBLE_METHOD_ALIASES: Record<string, VisiblePaymentMethod> = {
  alipay: VisiblePaymentMethod.ALIPAY,
  alipay_direct: VisiblePaymentMethod.ALIPAY,
  wxpay: VisiblePaymentMethod.WXPAY,
  wxpay_direct: VisiblePaymentMethod.WXPAY,
  wechat: VisiblePaymentMethod.WXPAY,
  wechat_pay: VisiblePaymentMethod.WXPAY,
  stripe: VisiblePaymentMethod.STRIPE,
  airwallex: VisiblePaymentMethod.AIRWALLEX
}

const METHOD_LABELS: Record<string, string> = {
  [VisiblePaymentMethod.ALIPAY]: '支付宝',
  [VisiblePaymentMethod.WXPAY]: '微信支付',
  [VisiblePaymentMethod.STRIPE]: 'Stripe',
  [VisiblePaymentMethod.AIRWALLEX]: 'Airwallex'
}

export interface PaymentRecoverySnapshot {
  orderId: number
  amount: number
  qrCode: string
  expiresAt: string
  paymentType: string
  payUrl: string
  outTradeNo: string
  clientSecret: string
  intentId: string
  currency: string
  countryCode: string
  paymentEnv: string
  payAmount: number
  orderType: OrderType | ''
  paymentMode: string
  resumeToken: string
  alipayMobilePrecreateDeepLink: boolean
  createdAt: number
}

export interface PaymentLaunchContext {
  visibleMethod: string
  orderType: OrderType
  isMobile: boolean
  isWechatBrowser: boolean
  forceQRCode?: boolean
  mobilePrecreateDeepLink?: boolean
  now?: number
  stripePopupUrl?: string
  stripeRouteUrl?: string
  airwallexRouteUrl?: string
}

export interface PaymentLaunchDecision {
  kind: PaymentLaunchKind
  paymentState: PaymentRecoverySnapshot
  recovery: PaymentRecoverySnapshot
  stripeMethod?: 'alipay' | 'wechat_pay'
  oauth?: WechatOAuthInfo
  jsapi?: WechatJSAPIPayload
}

export interface ParsedWechatResumeRoute {
  orderAmount: number
  orderType: OrderType
  paymentType: string
  planId?: number
  openid?: string
  wechatResumeToken?: string
}

type StorageWriter = Pick<Storage, 'removeItem' | 'setItem'>

export function normalizeVisibleMethod(method: string): VisiblePaymentMethod | '' {
  return VISIBLE_METHOD_ALIASES[method.trim().toLowerCase()] || ''
}

export function paymentMethodLabel(method: string, displayName?: string): string {
  return displayName?.trim() || METHOD_LABELS[normalizeVisibleMethod(method) || method] || method || '未知方式'
}

export function getVisibleMethods(methods: Record<string, MethodLimit>): Record<string, MethodLimit> {
  const visible: Record<string, MethodLimit> = {}
  Object.entries(methods).forEach(([type, limit]) => {
    const normalized = normalizeVisibleMethod(type) || type.trim()
    if (!normalized) return
    const existing = visible[normalized]
    if (!existing || type === normalized) visible[normalized] = { ...limit }
  })
  return visible
}

export function isMobileDevice(userAgent: string = navigator.userAgent): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
}

export function isWechatBrowser(userAgent: string = navigator.userAgent): boolean {
  return /MicroMessenger/i.test(userAgent)
}

export function getPaymentPopupFeatures(screenValue: Pick<Screen, 'availWidth' | 'availHeight'> | null = typeof window === 'undefined' ? null : window.screen): string {
  const preferredWidth = 1250
  const preferredHeight = 900
  const availableWidth = screenValue?.availWidth || preferredWidth
  const availableHeight = screenValue?.availHeight || preferredHeight
  const width = Math.min(preferredWidth, Math.max(360, availableWidth - 40))
  const height = Math.min(preferredHeight, Math.max(520, availableHeight - 40))
  const left = Math.max(0, Math.floor((availableWidth - width) / 2))
  const top = Math.max(0, Math.floor((availableHeight - height) / 2))
  return `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
}

export function normalizePaymentCurrency(currency?: string | null): string {
  const normalized = String(currency || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : DEFAULT_PAYMENT_CURRENCY
}

export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export function roundPaymentAmount(value: number, currency: string): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** currencyFractionDigits(currency)
  return Math.round(value * factor) / factor
}

export function ceilPaymentAmount(value: number, currency: string): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** currencyFractionDigits(currency)
  return Math.ceil(value * factor) / factor
}

export function formatPaymentAmount(value: number, currency?: string | null): string {
  const normalized = normalizePaymentCurrency(currency)
  const digits = currencyFractionDigits(normalized)
  try {
    return new Intl.NumberFormat(normalized === 'USD' ? 'en-US' : 'zh-CN', {
      style: 'currency', currency: normalized, currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits, maximumFractionDigits: digits
    }).format(Number.isFinite(value) ? value : 0)
  } catch {
    return `${normalized} ${(Number.isFinite(value) ? value : 0).toFixed(digits)}`
  }
}

export function amountFitsMethod(amount: number, method: string, methods: Record<string, MethodLimit>): boolean {
  if (amount <= 0) return true
  const limit = methods[method]
  if (!limit || limit.available === false) return false
  if (limit.single_min > 0 && amount < limit.single_min) return false
  if (limit.single_max > 0 && amount > limit.single_max) return false
  if (limit.daily_remaining > 0 && amount > limit.daily_remaining) return false
  return true
}

export function subscriptionPaymentAmount(priceUsd: number, currency: string, usdToCnyRate: number): number {
  const normalized = normalizePaymentCurrency(currency)
  const converted = usdToCnyRate > 0 && normalized === DEFAULT_PAYMENT_CURRENCY ? priceUsd * usdToCnyRate : priceUsd
  return roundPaymentAmount(converted, normalized)
}

export function feeAndTotal(amount: number, feeRate: number, currency: string): { fee: number; total: number } {
  const fee = amount > 0 && feeRate > 0 ? ceilPaymentAmount(amount * feeRate / 100, currency) : 0
  return { fee, total: roundPaymentAmount(amount + fee, currency) }
}

export function planValidityLabel(plan: Pick<SubscriptionPlan, 'validity_days' | 'validity_unit'>): string {
  const unit = String(plan.validity_unit || 'day').trim().toLowerCase().replace(/s$/, '')
  if (unit === 'month') return plan.validity_days === 1 ? '月' : `${plan.validity_days} 个月`
  if (unit === 'week') return `${plan.validity_days} 周`
  return `${plan.validity_days} 天`
}

export function buildCreateOrderPayload(input: {
  amount: number
  paymentType: string
  orderType: OrderType
  planId?: number
  origin?: string
  isMobile: boolean
  isWechatBrowser: boolean
  forceQRCode?: boolean
  mobilePrecreateDeepLink?: boolean
}): CreateOrderRequest {
  const visibleMethod = normalizeVisibleMethod(input.paymentType) || input.paymentType.trim()
  const normalizedOrigin = (input.origin || '').trim().replace(/\/+$/, '')
  const effectiveMobile = input.forceQRCode && !input.mobilePrecreateDeepLink && visibleMethod === VisiblePaymentMethod.ALIPAY
    ? false
    : input.isMobile
  const payload: CreateOrderRequest = {
    amount: input.amount,
    payment_type: visibleMethod,
    order_type: input.orderType,
    is_mobile: effectiveMobile,
    payment_source: visibleMethod === VisiblePaymentMethod.WXPAY && input.isWechatBrowser
      ? 'wechat_in_app_resume'
      : 'hosted_redirect'
  }
  if (input.planId) payload.plan_id = input.planId
  if (normalizedOrigin) payload.return_url = `${normalizedOrigin}/payment/result`
  return payload
}

export function emptyPaymentState(): PaymentRecoverySnapshot {
  return {
    orderId: 0, amount: 0, qrCode: '', expiresAt: '', paymentType: '', payUrl: '', outTradeNo: '',
    clientSecret: '', intentId: '', currency: '', countryCode: '', paymentEnv: '', payAmount: 0,
    orderType: '', paymentMode: '', resumeToken: '', alipayMobilePrecreateDeepLink: false, createdAt: 0
  }
}

export function createPaymentRecoverySnapshot(
  state: Omit<PaymentRecoverySnapshot, 'createdAt'>,
  now: number = Date.now()
): PaymentRecoverySnapshot {
  return { ...state, createdAt: now }
}

export function decidePaymentLaunch(
  result: CreateOrderResult & { resume_token?: string },
  context: PaymentLaunchContext
): PaymentLaunchDecision {
  const visibleMethod = normalizeVisibleMethod(context.visibleMethod) || context.visibleMethod
  const baseState = createPaymentRecoverySnapshot({
    orderId: result.order_id,
    amount: result.amount,
    qrCode: result.qr_code || '',
    expiresAt: result.expires_at || '',
    paymentType: visibleMethod,
    payUrl: result.pay_url || '',
    outTradeNo: result.out_trade_no || '',
    clientSecret: result.client_secret || '',
    intentId: result.intent_id || '',
    currency: result.currency || '',
    countryCode: result.country_code || '',
    paymentEnv: result.payment_env || '',
    payAmount: result.pay_amount,
    orderType: context.orderType,
    paymentMode: (result.payment_mode || '').trim(),
    resumeToken: result.resume_token || '',
    alipayMobilePrecreateDeepLink: result.alipay_mobile_precreate_deep_link === true
  }, context.now)

  if (visibleMethod === VisiblePaymentMethod.AIRWALLEX && baseState.clientSecret && baseState.intentId) {
    if (!context.airwallexRouteUrl) return { kind: PaymentLaunchKind.UNHANDLED, paymentState: baseState, recovery: baseState }
    const state = { ...baseState, payUrl: context.airwallexRouteUrl }
    return { kind: PaymentLaunchKind.AIRWALLEX_ROUTE, paymentState: state, recovery: state }
  }
  if (baseState.clientSecret) {
    const stripeMethod = visibleMethod === VisiblePaymentMethod.STRIPE
      ? undefined
      : visibleMethod === VisiblePaymentMethod.WXPAY ? 'wechat_pay' : 'alipay'
    const kind = stripeMethod === 'alipay' && !context.isMobile
      ? PaymentLaunchKind.STRIPE_POPUP
      : PaymentLaunchKind.STRIPE_ROUTE
    const payUrl = kind === PaymentLaunchKind.STRIPE_POPUP
      ? context.stripePopupUrl || context.stripeRouteUrl || ''
      : context.stripeRouteUrl || context.stripePopupUrl || ''
    const state = { ...baseState, payUrl }
    return { kind, paymentState: state, recovery: state, stripeMethod }
  }
  if (result.result_type === 'oauth_required' && result.oauth?.authorize_url) {
    return { kind: PaymentLaunchKind.WECHAT_OAUTH, paymentState: baseState, recovery: baseState, oauth: result.oauth }
  }
  const jsapiPayload = result.jsapi || result.jsapi_payload
  if (result.result_type === 'jsapi_ready' && jsapiPayload) {
    return { kind: PaymentLaunchKind.WECHAT_JSAPI, paymentState: baseState, recovery: baseState, jsapi: jsapiPayload }
  }
  if (
    visibleMethod === VisiblePaymentMethod.ALIPAY && context.isMobile
    && baseState.alipayMobilePrecreateDeepLink && baseState.qrCode
  ) {
    return { kind: PaymentLaunchKind.ALIPAY_DEEP_LINK, paymentState: baseState, recovery: baseState }
  }
  const paymentMode = baseState.paymentMode.toLowerCase()
  const effectiveMobile = context.forceQRCode && !context.mobilePrecreateDeepLink && visibleMethod === VisiblePaymentMethod.ALIPAY
    ? false
    : context.isMobile
  const prefersRedirect = paymentMode === 'redirect' || paymentMode === 'popup' || (effectiveMobile && Boolean(baseState.payUrl))
  const prefersQr = paymentMode === 'qrcode' || paymentMode === 'native' || (!prefersRedirect && Boolean(baseState.qrCode))
  if (visibleMethod === VisiblePaymentMethod.WXPAY && context.isWechatBrowser && baseState.payUrl && !baseState.qrCode) {
    return { kind: PaymentLaunchKind.REDIRECT_WAITING, paymentState: baseState, recovery: baseState }
  }
  if (prefersRedirect && baseState.payUrl) return { kind: PaymentLaunchKind.REDIRECT_WAITING, paymentState: baseState, recovery: baseState }
  if (prefersQr && baseState.qrCode) return { kind: PaymentLaunchKind.QR_WAITING, paymentState: baseState, recovery: baseState }
  if (baseState.payUrl) return { kind: PaymentLaunchKind.REDIRECT_WAITING, paymentState: baseState, recovery: baseState }
  return { kind: PaymentLaunchKind.UNHANDLED, paymentState: baseState, recovery: baseState }
}

export function writePaymentRecoverySnapshot(storage: StorageWriter, snapshot: PaymentRecoverySnapshot): void {
  storage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot))
}

export function clearPaymentRecoverySnapshot(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(PAYMENT_RECOVERY_STORAGE_KEY)
}

export function readPaymentRecoverySnapshot(
  raw: string | null | undefined,
  options: { now?: number; resumeToken?: string } = {}
): PaymentRecoverySnapshot | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PaymentRecoverySnapshot>
    if (
      typeof value.orderId !== 'number' || typeof value.amount !== 'number' || typeof value.qrCode !== 'string'
      || typeof value.expiresAt !== 'string' || typeof value.paymentType !== 'string' || typeof value.payUrl !== 'string'
      || typeof value.clientSecret !== 'string' || typeof value.payAmount !== 'number' || typeof value.paymentMode !== 'string'
      || typeof value.resumeToken !== 'string' || typeof value.createdAt !== 'number'
    ) return null
    const expiresAt = Date.parse(value.expiresAt)
    if (Number.isFinite(expiresAt) && expiresAt <= (options.now ?? Date.now())) return null
    if (options.resumeToken && value.resumeToken !== options.resumeToken) return null
    return {
      orderId: value.orderId,
      amount: value.amount,
      qrCode: value.qrCode,
      expiresAt: value.expiresAt,
      paymentType: value.paymentType,
      payUrl: value.payUrl,
      outTradeNo: value.outTradeNo || '',
      clientSecret: value.clientSecret,
      intentId: value.intentId || '',
      currency: value.currency || '',
      countryCode: value.countryCode || '',
      paymentEnv: value.paymentEnv || '',
      payAmount: value.payAmount,
      orderType: value.orderType === 'subscription' ? 'subscription' : 'balance',
      paymentMode: value.paymentMode,
      resumeToken: value.resumeToken,
      alipayMobilePrecreateDeepLink: value.alipayMobilePrecreateDeepLink === true,
      createdAt: value.createdAt
    }
  } catch {
    return null
  }
}

function readQueryString(query: LocationQuery, key: string): string {
  const value = query[key]
  return Array.isArray(value) ? (typeof value[0] === 'string' ? value[0] : '') : (typeof value === 'string' ? value : '')
}

export function hasWechatResumeQuery(query: LocationQuery): boolean {
  return readQueryString(query, 'wechat_resume') === '1'
    || Boolean(readQueryString(query, 'wechat_resume_token'))
    || Boolean(readQueryString(query, 'openid'))
}

export function parseWechatResumeRoute(
  query: LocationQuery,
  plans: SubscriptionPlan[],
  fallbackBalanceAmount: number
): ParsedWechatResumeRoute | null {
  if (!hasWechatResumeQuery(query)) return null
  const wechatResumeToken = readQueryString(query, 'wechat_resume_token')
  const paymentType = normalizeVisibleMethod(readQueryString(query, 'payment_type')) || VisiblePaymentMethod.WXPAY
  const planId = Number.parseInt(readQueryString(query, 'plan_id'), 10)
  const hasPlanId = Number.isFinite(planId) && planId > 0
  const orderType: OrderType = readQueryString(query, 'order_type') === 'subscription' || hasPlanId ? 'subscription' : 'balance'
  if (wechatResumeToken) {
    return { wechatResumeToken, paymentType, orderType, orderAmount: 0, planId: hasPlanId ? planId : undefined }
  }
  const openid = readQueryString(query, 'openid')
  if (!openid) return null
  const rawAmount = Number.parseFloat(readQueryString(query, 'amount'))
  const orderAmount = Number.isFinite(rawAmount) && rawAmount > 0
    ? rawAmount
    : orderType === 'subscription' ? (plans.find((plan) => plan.id === planId)?.price || 0) : fallbackBalanceAmount
  return { openid, paymentType, orderType, orderAmount, planId: hasPlanId ? planId : undefined }
}

export function stripWechatResumeQuery(query: LocationQuery): LocationQueryRaw {
  const next: LocationQueryRaw = { ...query }
  for (const key of ['wechat_resume', 'wechat_resume_token', 'openid', 'state', 'scope', 'payment_type', 'amount', 'order_type', 'plan_id']) {
    delete next[key]
  }
  return next
}

export function buildWechatOAuthAuthorizeUrl(authorizeUrl: string, context: {
  paymentType: string
  orderType: OrderType
  planId?: number
  orderAmount: number
}, origin: string): string {
  const normalized = authorizeUrl.trim()
  if (!normalized) return ''
  try {
    const target = new URL(normalized, origin)
    const redirect = new URL(target.searchParams.get('redirect') || '/app/purchase', origin)
    redirect.searchParams.set('payment_type', normalizeVisibleMethod(context.paymentType) || context.paymentType || VisiblePaymentMethod.WXPAY)
    redirect.searchParams.set('order_type', context.orderType)
    if (context.planId) redirect.searchParams.set('plan_id', String(context.planId))
    if (context.orderAmount > 0) redirect.searchParams.set('amount', String(context.orderAmount))
    target.searchParams.set('redirect', `${redirect.pathname}${redirect.search}`)
    return target.toString()
  } catch {
    return normalized
  }
}

export function paymentErrorMessage(error: unknown, method: string, mobile: boolean, wechatBrowser: boolean): { message: string; hint?: string } {
  const value = error as { reason?: string; message?: string; response?: { data?: { detail?: string; reason?: string; message?: string } } }
  const reason = value.reason || value.response?.data?.reason || ''
  const raw = value.response?.data?.detail || value.response?.data?.message || value.message || '创建支付订单失败'
  const visibleMethod = normalizeVisibleMethod(method) || method
  if (reason === 'TOO_MANY_PENDING') return { message: '待支付订单过多，请先完成或取消已有订单。', hint: '可前往“我的订单”处理。' }
  if (reason === 'CANCEL_RATE_LIMITED') return { message: '取消订单过于频繁，请稍后重试。' }
  if (visibleMethod === VisiblePaymentMethod.WXPAY) {
    if (reason === 'WECHAT_H5_NOT_AUTHORIZED') return { message: '当前微信 H5 支付未授权。', hint: mobile ? '请在微信内打开或使用二维码支付。' : '请使用微信扫码。' }
    if (reason === 'WECHAT_PAYMENT_MP_NOT_CONFIGURED') return { message: '微信内支付尚未配置。', hint: wechatBrowser ? '请切换普通浏览器后扫码。' : '请使用二维码支付。' }
    if (['NO_AVAILABLE_INSTANCE', 'PAYMENT_GATEWAY_ERROR', 'UNHANDLED_PAYMENT_SCENARIO', 'WECHAT_JSAPI_FAILED'].includes(reason)) {
      return { message: '微信支付暂不可用。', hint: mobile ? '可尝试二维码或其他支付方式。' : '请稍后重试或切换支付方式。' }
    }
  }
  if (visibleMethod === VisiblePaymentMethod.ALIPAY && ['PAYMENT_GATEWAY_ERROR', 'UNHANDLED_PAYMENT_SCENARIO'].includes(reason)) {
    return { message: '支付宝支付暂不可用。', hint: mobile ? '请尝试打开支付宝或切换支付方式。' : '请稍后重试或使用二维码。' }
  }
  return { message: raw }
}

export function shouldFallbackToDesktopQr(error: unknown, paymentMethod: string, attempted: boolean, mobile: boolean): boolean {
  if (attempted || !mobile) return false
  const value = error as { reason?: string; message?: string; response?: { data?: { reason?: string } } }
  const reason = value.reason || value.response?.data?.reason || ''
  const message = (value.message || '').toLowerCase()
  const method = normalizeVisibleMethod(paymentMethod) || paymentMethod
  if (method === VisiblePaymentMethod.WXPAY) {
    return ['WECHAT_H5_NOT_AUTHORIZED', 'WECHAT_PAYMENT_MP_NOT_CONFIGURED', 'WECHAT_JSAPI_FAILED', 'PAYMENT_GATEWAY_ERROR', 'UNHANDLED_PAYMENT_SCENARIO'].includes(reason)
      || message.includes('weixinjsbridge is unavailable') || message.includes('wechat_jsapi_unavailable')
  }
  return method === VisiblePaymentMethod.ALIPAY && ['PAYMENT_GATEWAY_ERROR', 'UNHANDLED_PAYMENT_SCENARIO'].includes(reason)
}
