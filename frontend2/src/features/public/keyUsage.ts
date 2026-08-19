import { buildGatewayUrl } from '@/api/url'
import {
  KeyUsageHistoryDays,
  KeyUsageRange,
  PublicKeyStatus,
  PublicKeyUsageMode,
  RateLimitWindow,
  localDate,
} from './model'

export interface PublicUsageMetric {
  requests?: number
  input_tokens?: number
  output_tokens?: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
  total_tokens?: number
  cost?: number
  actual_cost?: number
}

export interface PublicUsageSummary {
  today?: PublicUsageMetric
  total?: PublicUsageMetric
  average_duration_ms?: number
  rpm?: number
  tpm?: number
}

export interface PublicQuotaSummary {
  limit: number
  used: number
  remaining: number
  unit: string
}

export interface PublicRateLimitSummary {
  window: RateLimitWindow | string
  limit: number
  used: number
  remaining: number
  reset_at?: string | null
}

export interface PublicSubscriptionSummary {
  daily_usage_usd: number
  weekly_usage_usd: number
  monthly_usage_usd: number
  daily_limit_usd?: number | null
  weekly_limit_usd?: number | null
  monthly_limit_usd?: number | null
  expires_at?: string | null
}

export interface PublicModelUsageRow {
  model?: string
  requests?: number
  input_tokens?: number
  output_tokens?: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
  total_tokens?: number
  actual_cost?: number
  cost?: number
}

export interface PublicDailyUsageRow {
  date: string
  requests: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens?: number
  cost: number
  actual_cost?: number
}

export interface PublicKeyUsageResponse {
  mode: PublicKeyUsageMode
  isValid?: boolean
  status?: PublicKeyStatus | string
  planName?: string
  remaining?: number
  balance?: number
  unit?: string
  quota?: PublicQuotaSummary
  rate_limits?: PublicRateLimitSummary[]
  expires_at?: string | null
  days_until_expiry?: number
  subscription?: PublicSubscriptionSummary
  usage?: PublicUsageSummary
  model_stats?: PublicModelUsageRow[]
  daily_usage?: PublicDailyUsageRow[]
}

export interface PublicKeyUsageQuery {
  range: KeyUsageRange
  customStartDate?: string
  customEndDate?: string
  days: KeyUsageHistoryDays
  timezone?: string
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function startDateForRange(range: KeyUsageRange, now: Date): string {
  const offsets: Partial<Record<KeyUsageRange, number>> = {
    [KeyUsageRange.TODAY]: 0,
    [KeyUsageRange.SEVEN_DAYS]: 7,
    [KeyUsageRange.THIRTY_DAYS]: 30,
    [KeyUsageRange.NINETY_DAYS]: 90,
  }
  const offset = offsets[range] ?? 30
  return localDate(new Date(now.getTime() - offset * 86_400_000))
}

export function buildPublicKeyUsageQuery(query: PublicKeyUsageQuery, now = new Date()): URLSearchParams {
  const params = new URLSearchParams()
  const end = query.range === KeyUsageRange.CUSTOM && query.customEndDate
    ? query.customEndDate
    : localDate(now)
  const start = query.range === KeyUsageRange.CUSTOM && query.customStartDate
    ? query.customStartDate
    : startDateForRange(query.range, now)
  params.set('start_date', start)
  params.set('end_date', end)
  params.set('days', String(query.days))
  params.set('timezone', query.timezone || browserTimezone())
  return params
}

export async function getPublicKeyUsage(
  apiKey: string,
  query: PublicKeyUsageQuery,
  options: { signal?: AbortSignal } = {},
): Promise<PublicKeyUsageResponse> {
  const params = buildPublicKeyUsageQuery(query)
  const response = await fetch(`${buildGatewayUrl('/v1/usage')}?${params.toString()}`, {
    signal: options.signal,
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error?: { message?: string }
      message?: string
    } | null
    throw new Error(payload?.error?.message || payload?.message || `查询失败（HTTP ${response.status}）`)
  }
  return response.json() as Promise<PublicKeyUsageResponse>
}
