export interface PaginatedResponse<T> { items: T[]; total: number; page: number; page_size: number; pages: number }

export enum ApiKeyStatus { ACTIVE = 'active', INACTIVE = 'inactive', QUOTA_EXHAUSTED = 'quota_exhausted', EXPIRED = 'expired' }

export interface ApiKey {
  id: number; key: string; name: string; group_id: number | null; status: ApiKeyStatus
  quota: number; quota_used: number; last_used_at: string | null; expires_at: string | null; created_at: string
}

export interface DashboardStats {
  total_api_keys: number; active_api_keys: number; total_requests: number; total_tokens: number
  total_actual_cost: number; today_requests: number; today_tokens: number; today_actual_cost: number
  average_duration_ms: number; rpm: number; tpm: number
  total_input_tokens?: number; total_output_tokens?: number; total_cache_creation_tokens?: number; total_cache_read_tokens?: number
  total_cost?: number; today_input_tokens?: number; today_output_tokens?: number
  today_cache_creation_tokens?: number; today_cache_read_tokens?: number; today_cost?: number
  by_platform?: DashboardPlatformStats[]
}

export interface DashboardPlatformStats {
  platform: string; total_requests: number; total_tokens: number; total_actual_cost: number
  today_requests: number; today_tokens: number; today_actual_cost: number
}

export enum DashboardGranularity { DAY = 'day', HOUR = 'hour' }

export interface DashboardQueryParams {
  start_date: string
  end_date: string
  granularity?: DashboardGranularity
}

export type DashboardDateQueryParams = Pick<DashboardQueryParams, 'start_date' | 'end_date'>

export interface DashboardTrendPoint {
  date: string; requests: number; input_tokens: number; output_tokens: number
  cache_creation_tokens: number; cache_read_tokens: number; total_tokens: number
  cost: number; actual_cost: number
}

export interface DashboardTrendResponse {
  trend: DashboardTrendPoint[]
  start_date: string
  end_date: string
  granularity: DashboardGranularity | string
}

export interface DashboardModelStat {
  model: string; requests: number; input_tokens: number; output_tokens: number
  cache_creation_tokens: number; cache_read_tokens: number; total_tokens: number
  cost: number; actual_cost: number
}

export interface DashboardModelStatsResponse {
  models: DashboardModelStat[]
  start_date: string
  end_date: string
}

export interface UsageLog {
  id: number; request_id: string; model: string; input_tokens: number; output_tokens: number
  cache_creation_tokens?: number; cache_read_tokens: number; total_cost?: number; actual_cost: number
  duration_ms: number | null; stream: boolean; created_at: string
}

export interface SubscriptionPlan {
  id: number; group_name?: string; name: string; description: string; price: number; original_price?: number
  currency?: string; validity_days: number; validity_unit: string; features: string[]; for_sale: boolean
}

export interface UserSubscription {
  id: number; status: string; starts_at: string; expires_at: string | null
  daily_usage_usd: number; weekly_usage_usd: number; monthly_usage_usd: number; group?: { name: string }
}
