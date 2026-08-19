export enum PaymentProviderKey {
  EASYPAY = 'easypay',
  ALIPAY = 'alipay',
  WXPAY = 'wxpay',
  STRIPE = 'stripe',
  AIRWALLEX = 'airwallex'
}

export enum ProviderPaymentMode {
  DEFAULT = '',
  QRCODE = 'qrcode',
  POPUP = 'popup',
  REDIRECT = 'redirect'
}

export enum ProviderLimitField {
  SINGLE_MIN = 'singleMin',
  SINGLE_MAX = 'singleMax',
  DAILY_LIMIT = 'dailyLimit'
}

export interface ProviderOption {
  value: string
  label: string
}

export interface ProviderConfigField {
  key: string
  label?: string
  sensitive?: boolean
  multiline?: boolean
  optional?: boolean
  clearable?: boolean
  defaultValue?: string
  hintKey?: string
  options?: ProviderOption[]
}

export interface EasyPayCustomMethod {
  type: string
  upstreamType: string
  displayName: string
}

export interface ProviderCallbackPaths {
  notifyUrl?: string
  returnUrl?: string
}

export const PAYMENT_PROVIDER_KEYS = Object.values(PaymentProviderKey)

export const PROVIDER_SUPPORTED_TYPES: Record<PaymentProviderKey, string[]> = {
  [PaymentProviderKey.EASYPAY]: ['alipay', 'wxpay'],
  [PaymentProviderKey.ALIPAY]: ['alipay'],
  [PaymentProviderKey.WXPAY]: ['wxpay'],
  [PaymentProviderKey.STRIPE]: ['card', 'alipay', 'wxpay', 'link'],
  [PaymentProviderKey.AIRWALLEX]: ['airwallex']
}

export const PAYMENT_CURRENCY_OPTIONS: ProviderOption[] = [
  'CNY', 'HKD', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'JPY', 'KRW', 'NZD'
].map((value) => ({ value, label: value }))

export const STRIPE_SDK_API_VERSION = '2026-03-25.dahlia'

export const PROVIDER_WEBHOOK_PATHS: Record<PaymentProviderKey, string> = {
  [PaymentProviderKey.EASYPAY]: '/api/v1/payment/webhook/easypay',
  [PaymentProviderKey.ALIPAY]: '/api/v1/payment/webhook/alipay',
  [PaymentProviderKey.WXPAY]: '/api/v1/payment/webhook/wxpay',
  [PaymentProviderKey.STRIPE]: '/api/v1/payment/webhook/stripe',
  [PaymentProviderKey.AIRWALLEX]: '/api/v1/payment/webhook/airwallex'
}

export const PROVIDER_CALLBACK_PATHS: Partial<Record<PaymentProviderKey, ProviderCallbackPaths>> = {
  [PaymentProviderKey.EASYPAY]: { notifyUrl: PROVIDER_WEBHOOK_PATHS.easypay, returnUrl: '/payment/result' },
  [PaymentProviderKey.ALIPAY]: { notifyUrl: PROVIDER_WEBHOOK_PATHS.alipay, returnUrl: '/payment/result' },
  [PaymentProviderKey.WXPAY]: { notifyUrl: PROVIDER_WEBHOOK_PATHS.wxpay }
}

export const PROVIDER_CONFIG_FIELDS: Record<PaymentProviderKey, ProviderConfigField[]> = {
  [PaymentProviderKey.EASYPAY]: [
    { key: 'pid', label: 'PID' },
    { key: 'pkey', label: 'PKey', sensitive: true },
    { key: 'apiBase' },
    { key: 'cidAlipay', optional: true },
    { key: 'cidWxpay', optional: true }
  ],
  [PaymentProviderKey.ALIPAY]: [
    { key: 'appId', label: 'App ID' },
    { key: 'privateKey', sensitive: true, multiline: true },
    { key: 'publicKey', sensitive: true, multiline: true }
  ],
  [PaymentProviderKey.WXPAY]: [
    { key: 'appId', label: 'App ID' },
    { key: 'mchId' },
    { key: 'privateKey', sensitive: true, multiline: true },
    { key: 'apiV3Key', sensitive: true },
    { key: 'certSerial' },
    { key: 'publicKey', sensitive: true, multiline: true },
    { key: 'publicKeyId' }
  ],
  [PaymentProviderKey.STRIPE]: [
    { key: 'secretKey', sensitive: true },
    { key: 'publishableKey' },
    { key: 'webhookSecret', sensitive: true },
    { key: 'currency', defaultValue: 'CNY', hintKey: 'admin.settings.payment.field_paymentCurrencyHint', options: PAYMENT_CURRENCY_OPTIONS }
  ],
  [PaymentProviderKey.AIRWALLEX]: [
    { key: 'clientId' },
    { key: 'apiKey', sensitive: true },
    { key: 'webhookSecret', sensitive: true },
    { key: 'apiBase', defaultValue: 'https://api.airwallex.com/api/v1', hintKey: 'admin.settings.payment.field_airwallexApiBaseHint' },
    { key: 'countryCode', defaultValue: 'CN' },
    { key: 'currency', defaultValue: 'CNY', hintKey: 'admin.settings.payment.field_paymentCurrencyHint', options: PAYMENT_CURRENCY_OPTIONS },
    { key: 'accountId', optional: true, clearable: true, hintKey: 'admin.settings.payment.field_accountIdHint' }
  ]
}

export function isPaymentProviderKey(value: string): value is PaymentProviderKey {
  return PAYMENT_PROVIDER_KEYS.includes(value as PaymentProviderKey)
}

export function defaultProviderPaymentMode(providerKey: PaymentProviderKey): ProviderPaymentMode {
  return providerKey === PaymentProviderKey.EASYPAY ? ProviderPaymentMode.QRCODE : ProviderPaymentMode.DEFAULT
}

export function providerSupportsPaymentMode(providerKey: PaymentProviderKey): boolean {
  return providerKey === PaymentProviderKey.EASYPAY || providerKey === PaymentProviderKey.ALIPAY
}

export function normalizeProviderPaymentMode(providerKey: PaymentProviderKey, value: string): ProviderPaymentMode {
  if (providerKey === PaymentProviderKey.EASYPAY && [ProviderPaymentMode.QRCODE, ProviderPaymentMode.POPUP].includes(value as ProviderPaymentMode)) return value as ProviderPaymentMode
  if (providerKey === PaymentProviderKey.ALIPAY && [ProviderPaymentMode.DEFAULT, ProviderPaymentMode.REDIRECT].includes(value as ProviderPaymentMode)) return value as ProviderPaymentMode
  return defaultProviderPaymentMode(providerKey)
}

export function extractCallbackBaseUrl(fullUrl: string, path: string): string {
  if (!fullUrl) return ''
  if (fullUrl.endsWith(path)) return fullUrl.slice(0, -path.length)
  try { return new URL(fullUrl).origin } catch { return fullUrl }
}

export function parseEasyPayCustomMethods(raw: string | undefined): EasyPayCustomMethod[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => ({
        type: String((item as Record<string, unknown>)?.type || '').trim(),
        upstreamType: String((item as Record<string, unknown>)?.upstreamType || '').trim(),
        displayName: String((item as Record<string, unknown>)?.displayName || '').trim()
      }))
      .filter((item) => item.type && item.upstreamType)
  } catch { return [] }
}

export function serializeEasyPayCustomMethods(methods: EasyPayCustomMethod[]): string {
  const clean = methods
    .map((item) => ({ type: item.type.trim(), upstreamType: item.upstreamType.trim(), displayName: item.displayName.trim() }))
    .filter((item) => item.type && item.upstreamType)
  return clean.length ? JSON.stringify(clean) : ''
}
