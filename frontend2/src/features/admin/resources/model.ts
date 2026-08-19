import type { ChannelModelPricing, PricingInterval } from '@shared-api/admin/channels'
import type { GroupPlatform } from '@/types'

export enum ResourceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
  EXPIRED = 'expired',
  DISABLED = 'disabled'
}

export enum GroupPlatformOption {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
  ANTIGRAVITY = 'antigravity',
  GROK = 'grok',
  KIMI = 'kimi',
  ZHIPU = 'zhipu',
  DEEPSEEK = 'deepseek',
  COMPOSITE = 'composite'
}

export enum SubscriptionMode {
  STANDARD = 'standard',
  SUBSCRIPTION = 'subscription'
}

export enum BillingModeOption {
  TOKEN = 'token',
  PER_REQUEST = 'per_request',
  IMAGE = 'image',
  VIDEO = 'video'
}

export enum SortDirection {
  ASC = 'asc',
  DESC = 'desc'
}

export enum GroupOverrideMode {
  RATE = 'rate',
  RPM = 'rpm'
}

export const groupPlatformOptions: Array<{ value: GroupPlatform; label: string }> = [
  { value: GroupPlatformOption.OPENAI, label: 'OpenAI' },
  { value: GroupPlatformOption.ANTHROPIC, label: 'Anthropic' },
  { value: GroupPlatformOption.GEMINI, label: 'Gemini' },
  { value: GroupPlatformOption.ANTIGRAVITY, label: 'Antigravity' },
  { value: GroupPlatformOption.GROK, label: 'Grok' },
  { value: GroupPlatformOption.KIMI, label: 'Kimi' },
  { value: GroupPlatformOption.ZHIPU, label: '智谱' },
  { value: GroupPlatformOption.DEEPSEEK, label: 'DeepSeek' },
  { value: GroupPlatformOption.COMPOSITE, label: '复合路由' }
]

const MILLION = 1_000_000

export function platformName(value: string): string {
  return groupPlatformOptions.find((item) => item.value === value)?.label || value || '未指定'
}

export function parseOptionalNumber(value: unknown): number | null {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseNonNegative(value: unknown, field: string, allowNull = true): number | null {
  const parsed = parseOptionalNumber(value)
  if (parsed == null) {
    if (allowNull) return null
    throw new Error(`${field}不能为空`)
  }
  if (parsed < 0) throw new Error(`${field}不能为负数`)
  return parsed
}

export function splitValues(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))]
}

export function stringifyJson(value: unknown, fallback: unknown = {}): string {
  return JSON.stringify(value ?? fallback, null, 2)
}

export function parseJsonValue<T>(value: string, field: string, fallback: T): T {
  if (!value.trim()) return fallback
  try { return JSON.parse(value) as T }
  catch { throw new Error(`${field}不是有效 JSON`) }
}

export function perTokenToMillion(value: number | null | undefined): number | null {
  if (value == null) return null
  return Number((value * MILLION).toPrecision(10))
}

export function millionToPerToken(value: unknown): number | null {
  const parsed = parseOptionalNumber(value)
  return parsed == null ? null : Number((parsed / MILLION).toPrecision(10))
}

function nonNegativeMillionToPerToken(value: unknown, field: string): number | null {
  const parsed = parseNonNegative(value, field)
  return parsed == null ? null : Number((parsed / MILLION).toPrecision(10))
}

export interface PricingIntervalDraft {
  min_tokens: number | string
  max_tokens: number | string | null
  tier_label: string
  input_price: number | string | null
  output_price: number | string | null
  cache_write_price: number | string | null
  cache_read_price: number | string | null
  per_request_price: number | string | null
  sort_order: number
}

export interface ChannelPricingDraft {
  platform: string
  modelsText: string
  billing_mode: BillingModeOption
  input_price: number | string | null
  output_price: number | string | null
  cache_write_price: number | string | null
  cache_read_price: number | string | null
  image_input_price: number | string | null
  image_output_price: number | string | null
  per_request_price: number | string | null
  intervals: PricingIntervalDraft[]
}

export function pricingToDraft(value: ChannelModelPricing): ChannelPricingDraft {
  return {
    platform: value.platform || '',
    modelsText: (value.models || []).join('\n'),
    billing_mode: value.billing_mode as BillingModeOption,
    input_price: perTokenToMillion(value.input_price),
    output_price: perTokenToMillion(value.output_price),
    cache_write_price: perTokenToMillion(value.cache_write_price),
    cache_read_price: perTokenToMillion(value.cache_read_price),
    image_input_price: perTokenToMillion(value.image_input_price),
    image_output_price: perTokenToMillion(value.image_output_price),
    per_request_price: value.per_request_price,
    intervals: (value.intervals || []).map((interval) => ({
      min_tokens: interval.min_tokens,
      max_tokens: interval.max_tokens,
      tier_label: interval.tier_label || '',
      input_price: perTokenToMillion(interval.input_price),
      output_price: perTokenToMillion(interval.output_price),
      cache_write_price: perTokenToMillion(interval.cache_write_price),
      cache_read_price: perTokenToMillion(interval.cache_read_price),
      per_request_price: interval.per_request_price,
      sort_order: interval.sort_order
    }))
  }
}

export function emptyPricingDraft(platform = ''): ChannelPricingDraft {
  return {
    platform,
    modelsText: '',
    billing_mode: BillingModeOption.TOKEN,
    input_price: null,
    output_price: null,
    cache_write_price: null,
    cache_read_price: null,
    image_input_price: null,
    image_output_price: null,
    per_request_price: null,
    intervals: []
  }
}

function intervalToApi(value: PricingIntervalDraft, index: number): PricingInterval {
  const min = parseNonNegative(value.min_tokens, `第 ${index + 1} 个区间的起点`, false)!
  const max = parseNonNegative(value.max_tokens, `第 ${index + 1} 个区间的终点`)
  if (max != null && max <= min) throw new Error(`第 ${index + 1} 个区间的终点必须大于起点`)
  return {
    min_tokens: min,
    max_tokens: max,
    tier_label: value.tier_label.trim(),
    input_price: nonNegativeMillionToPerToken(value.input_price, `第 ${index + 1} 个区间的输入价格`),
    output_price: nonNegativeMillionToPerToken(value.output_price, `第 ${index + 1} 个区间的输出价格`),
    cache_write_price: nonNegativeMillionToPerToken(value.cache_write_price, `第 ${index + 1} 个区间的缓存写入价格`),
    cache_read_price: nonNegativeMillionToPerToken(value.cache_read_price, `第 ${index + 1} 个区间的缓存读取价格`),
    per_request_price: parseNonNegative(value.per_request_price, `第 ${index + 1} 个区间的按次价格`),
    sort_order: index
  }
}

export function pricingDraftsToApi(values: ChannelPricingDraft[]): ChannelModelPricing[] {
  const exactModels = new Set<string>()
  return values.map((value, entryIndex) => {
    const models = splitValues(value.modelsText)
    if (!models.length) throw new Error(`第 ${entryIndex + 1} 组价格至少需要一个模型`)
    for (const model of models) {
      const key = `${value.platform.toLowerCase()}:${model.toLowerCase()}`
      if (exactModels.has(key)) throw new Error(`模型 ${model} 在同一平台重复配置`)
      exactModels.add(key)
    }
    const intervals = value.intervals.map((item, index) => intervalToApi(item, index))
    if ((value.billing_mode === BillingModeOption.PER_REQUEST || value.billing_mode === BillingModeOption.IMAGE)
      && parseOptionalNumber(value.per_request_price) == null && intervals.length === 0) {
      throw new Error(`模型 ${models.join('、')} 的按次价格不能为空`)
    }
    if (value.billing_mode === BillingModeOption.TOKEN) {
      const sorted = [...intervals].sort((left, right) => left.min_tokens - right.min_tokens)
      sorted.forEach((item, index) => {
        if (item.max_tokens == null && index !== sorted.length - 1) throw new Error('无上限 Token 区间必须放在最后')
        const previous = sorted[index - 1]
        if (previous && (previous.max_tokens == null || previous.max_tokens > item.min_tokens)) {
          throw new Error('Token 价格区间不能重叠')
        }
      })
    }
    return {
      platform: value.platform.trim(),
      models,
      billing_mode: value.billing_mode,
      input_price: nonNegativeMillionToPerToken(value.input_price, '输入价格'),
      output_price: nonNegativeMillionToPerToken(value.output_price, '输出价格'),
      cache_write_price: nonNegativeMillionToPerToken(value.cache_write_price, '缓存写入价格'),
      cache_read_price: nonNegativeMillionToPerToken(value.cache_read_price, '缓存读取价格'),
      image_input_price: nonNegativeMillionToPerToken(value.image_input_price, '图片输入价格'),
      image_output_price: nonNegativeMillionToPerToken(value.image_output_price, '图片输出价格'),
      per_request_price: parseNonNegative(value.per_request_price, '按次价格'),
      intervals
    }
  })
}

interface ModelPattern { pattern: string; prefix: string; wildcard: boolean }

function modelPattern(value: string): ModelPattern {
  const normalized = value.toLowerCase()
  const wildcard = normalized.endsWith('*')
  return { pattern: value, prefix: wildcard ? normalized.slice(0, -1) : normalized, wildcard }
}

export function findModelConflict(models: string[]): [string, string] | null {
  const patterns = models.map(modelPattern)
  for (let left = 0; left < patterns.length; left += 1) {
    for (let right = left + 1; right < patterns.length; right += 1) {
      const a = patterns[left]
      const b = patterns[right]
      const conflicts = !a.wildcard && !b.wildcard
        ? a.prefix === b.prefix
        : a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix)
      if (conflicts) return [a.pattern, b.pattern]
    }
  }
  return null
}

export function resourceStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    [ResourceStatus.ACTIVE]: '启用',
    [ResourceStatus.INACTIVE]: '停用',
    [ResourceStatus.ERROR]: '异常',
    [ResourceStatus.EXPIRED]: '已过期',
    [ResourceStatus.DISABLED]: '停用'
  }
  return labels[status] || status || '未知'
}

export function formatResourceDate(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const date = typeof value === 'number'
    ? new Date(value > 10_000_000_000 ? value : value * 1000)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}
