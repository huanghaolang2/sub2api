import type { BillingMode } from '@/constants/channel'
import {
  BILLING_MODE_IMAGE,
  BILLING_MODE_PER_REQUEST,
  BILLING_MODE_TOKEN,
  BILLING_MODE_VIDEO
} from '@/constants/channel'
import type { UserPricingInterval, UserSupportedModelPricing } from '@shared-api/channels'
import type { ModelPlazaGroup, PlazaOfficialPricing } from '@shared-api/modelPlaza'

export enum PricingBillingFilter {
  ALL = 'all',
  TOKEN = 'token',
  PER_REQUEST = 'per_request',
  IMAGE = 'image',
  VIDEO = 'video'
}

export interface PricingRow {
  key: string
  groupId: number
  groupName: string
  groupDescription: string
  platform: string
  subscriptionType: string
  isExclusive: boolean
  defaultRate: number
  userRate: number | null
  effectiveRate: number
  peakRateEnabled: boolean
  peakStart: string
  peakEnd: string
  peakRate: number
  imageRateIndependent: boolean
  imageRate: number
  model: string
  billingMode: BillingMode
  pricing: UserSupportedModelPricing | null
  officialPricing: PlazaOfficialPricing | null
  input: number | null
  output: number | null
  cacheWrite: number | null
  cacheRead: number | null
  imageInput: number | null
  imageOutput: number | null
  perRequest: number | null
  intervals: UserPricingInterval[]
  officialInput: number | null
  officialOutput: number | null
  officialCacheWrite: number | null
  officialCacheWrite1h: number | null
  officialCacheRead: number | null
}

export function flattenPricing(groups: ModelPlazaGroup[]): PricingRow[] {
  return groups.flatMap((group) => group.models.map((model) => {
    const mode = model.pricing?.billing_mode ?? BILLING_MODE_TOKEN
    const groupRate = group.user_rate_multiplier ?? group.rate_multiplier
    const effectiveRate = mode === BILLING_MODE_IMAGE && group.image_rate_independent
      ? group.image_rate_multiplier
      : groupRate
    return {
      key: `${group.id}:${model.platform}:${model.name}`,
      groupId: group.id,
      groupName: group.name,
      groupDescription: group.description,
      platform: model.platform || group.platform,
      subscriptionType: group.subscription_type,
      isExclusive: group.is_exclusive,
      defaultRate: group.rate_multiplier,
      userRate: group.user_rate_multiplier ?? null,
      effectiveRate,
      peakRateEnabled: group.peak_rate_enabled,
      peakStart: group.peak_start,
      peakEnd: group.peak_end,
      peakRate: group.peak_rate_multiplier,
      imageRateIndependent: group.image_rate_independent,
      imageRate: group.image_rate_multiplier,
      model: model.name,
      billingMode: mode,
      pricing: model.pricing,
      officialPricing: model.official_pricing,
      input: model.pricing?.input_price ?? null,
      output: model.pricing?.output_price ?? null,
      cacheWrite: model.pricing?.cache_write_price ?? null,
      cacheRead: model.pricing?.cache_read_price ?? null,
      imageInput: model.pricing?.image_input_price ?? null,
      imageOutput: model.pricing?.image_output_price ?? null,
      perRequest: model.pricing?.per_request_price ?? null,
      intervals: model.pricing?.intervals ?? [],
      officialInput: model.official_pricing?.input_price ?? null,
      officialOutput: model.official_pricing?.output_price ?? null,
      officialCacheWrite: model.official_pricing?.cache_write_price ?? null,
      officialCacheWrite1h: model.official_pricing?.cache_write_1h_price ?? null,
      officialCacheRead: model.official_pricing?.cache_read_price ?? null
    }
  }))
}

export function filterPricing(
  rows: PricingRow[],
  query: string,
  platform: string,
  billingMode: PricingBillingFilter = PricingBillingFilter.ALL
): PricingRow[] {
  const normalized = query.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    const platformMatches = platform === 'all' || row.platform === platform
    const billingMatches = billingMode === PricingBillingFilter.ALL || row.billingMode === billingMode
    const queryMatches = !normalized || [
      row.model,
      row.platform,
      row.groupName,
      row.groupDescription,
      row.subscriptionType,
      row.isExclusive ? 'exclusive 专属' : 'public 公开'
    ].join(' ').toLocaleLowerCase().includes(normalized)
    return platformMatches && billingMatches && queryMatches
  })
}

export function billingModeLabel(mode: BillingMode): string {
  if (mode === BILLING_MODE_PER_REQUEST) return '按次'
  if (mode === BILLING_MODE_IMAGE) return '图片'
  if (mode === BILLING_MODE_VIDEO) return '视频'
  return 'Token'
}

export function formatBasePrice(value: number | null, mode: BillingMode = BILLING_MODE_TOKEN): string {
  if (value == null) return '—'
  const scale = mode === BILLING_MODE_TOKEN ? 1_000_000 : 1
  return `$${formatNumber(value * scale)}`
}

export function formatEffectivePrice(value: number | null, rate: number, mode: BillingMode = BILLING_MODE_TOKEN): string {
  if (value == null) return '—'
  const scale = mode === BILLING_MODE_TOKEN ? 1_000_000 : 1
  return `$${formatNumber(value * scale * rate)}`
}

export function formatTokenPrice(value: number | null, rate: number): string {
  return formatEffectivePrice(value, rate, BILLING_MODE_TOKEN)
}

export function formatRequestPrice(value: number | null, rate: number): string {
  return formatEffectivePrice(value, rate, BILLING_MODE_PER_REQUEST)
}

export function pricingUnit(mode: BillingMode): string {
  return mode === BILLING_MODE_TOKEN ? '/ 1M tokens' : '/ 次'
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(8).replace(/\.?0+$/, '')
}
