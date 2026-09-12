import { apiClient } from './client'

export enum UsageBoardGranularity { DAY = 'day', WEEK = 'week', MONTH = 'month' }
export enum UsageBoardScope { SELF = 'self', ADMIN = 'admin' }
export enum UsageBoardDataState { OBSERVED = 'observed', MISSING = 'missing' }
export enum UsageBoardSortOrder { ASC = 'asc', DESC = 'desc' }
export enum UsageBoardCoverage { FULL = 'full', PARTIAL = 'partial' }

export interface UsageBoardQuery {
  granularity: UsageBoardGranularity
  start_date?: string
  end_date?: string
  start_month?: string
  end_month?: string
  timezone: string
  api_key_ids: number[]
  group_ids: number[]
  sort_order: UsageBoardSortOrder
  page: number
  page_size: number
}
export interface UsageBoardPeriod {
  start: string
  end: string
  label: string
  coverage: UsageBoardCoverage
}
export interface UsageBoardPoint {
  period_start: string
  total_tokens: number
  record_count: number
  data_state: UsageBoardDataState
}
export interface UsageBoardSeries {
  api_key_id: number | null
  api_key_name: string
  points: UsageBoardPoint[]
}
export interface UsageBoardRow extends UsageBoardPoint {
  api_key_id: number | null
  api_key_name: string
  period_label: string
  coverage: UsageBoardCoverage
}
export interface UsageBoardResponse {
  granularity: UsageBoardGranularity
  timezone: string
  start_date: string
  end_date: string
  periods: UsageBoardPeriod[]
  series: UsageBoardSeries[]
  rows: UsageBoardRow[]
  pagination: { page: number; page_size: number; total: number; pages: number }
}

export async function getUsageBoard(scope: UsageBoardScope, query: UsageBoardQuery, signal?: AbortSignal): Promise<UsageBoardResponse> {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((id) => params.append(key, String(id)))
    else if (value !== undefined) params.set(key, String(value))
  })
  const path = scope === UsageBoardScope.ADMIN ? '/admin/usage/board' : '/usage/board'
  // Use a query string so the shared client's timezone injection cannot rewrite repeated ID parameters.
  const { data } = await apiClient.get<UsageBoardResponse>(`${path}?${params.toString()}`, { signal })
  return data
}
