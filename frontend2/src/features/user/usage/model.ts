import type { UsageLog, UsageQueryParams, UsageRequestType } from '@/types'
import { getDisplayBillingMode } from '@shared-utils/billingMode'
import { resolveUsageRequestType, requestTypeToLegacyStream } from '@shared-utils/usageRequestType'

export enum UsageTab {
  USAGE = 'usage',
  ERRORS = 'errors'
}

export enum UsageGranularity {
  HOUR = 'hour',
  DAY = 'day'
}

export enum UsageSortOrder {
  ASC = 'asc',
  DESC = 'desc'
}

export enum UsageRequestFilter {
  ALL = '',
  SYNC = 'sync',
  STREAM = 'stream',
  WS_V2 = 'ws_v2',
  CYBER = 'cyber',
  LIVE = 'live'
}

export enum BillingTypeFilter {
  ALL = '',
  BALANCE = '0',
  SUBSCRIPTION = '1'
}

export enum BillingModeFilter {
  ALL = '',
  TOKEN = 'token',
  PER_REQUEST = 'per_request',
  IMAGE = 'image',
  VIDEO = 'video'
}

export enum UsageColumnKey {
  API_KEY = 'api_key',
  MODEL = 'model',
  REASONING = 'reasoning_effort',
  ENDPOINT = 'endpoint',
  IP = 'ip_address',
  GROUP = 'group',
  REQUEST_TYPE = 'request_type',
  BILLING = 'billing',
  TOKENS = 'tokens',
  COST = 'cost',
  LATENCY = 'latency',
  CREATED_AT = 'created_at',
  REQUEST_ID = 'request_id',
  USER_AGENT = 'user_agent',
  ACTIONS = 'actions'
}

export enum ErrorColumnKey {
  KEY = 'key_name',
  MODEL = 'model',
  ENDPOINT = 'endpoint',
  IP = 'client_ip',
  GROUP = 'group',
  TYPE = 'type',
  PLATFORM = 'platform',
  CATEGORY = 'category',
  STATUS = 'status',
  MESSAGE = 'message',
  CREATED_AT = 'created_at',
  USER_AGENT = 'user_agent',
  ACTIONS = 'actions'
}

export interface UsageColumnDefinition<T extends string> {
  key: T
  label: string
  sortable?: boolean
  defaultVisible: boolean
  alwaysVisible?: boolean
}

export const usageColumns: UsageColumnDefinition<UsageColumnKey>[] = [
  { key: UsageColumnKey.API_KEY, label: 'API Key', defaultVisible: true },
  { key: UsageColumnKey.MODEL, label: '模型', sortable: true, defaultVisible: true },
  { key: UsageColumnKey.REASONING, label: '推理强度', defaultVisible: false },
  { key: UsageColumnKey.ENDPOINT, label: '入口端点', defaultVisible: true },
  { key: UsageColumnKey.IP, label: '客户端 IP', defaultVisible: true },
  { key: UsageColumnKey.GROUP, label: '分组', defaultVisible: true },
  { key: UsageColumnKey.REQUEST_TYPE, label: '请求类型', defaultVisible: true },
  { key: UsageColumnKey.BILLING, label: '计费方式', defaultVisible: true },
  { key: UsageColumnKey.TOKENS, label: 'Token / 图片', defaultVisible: true },
  { key: UsageColumnKey.COST, label: '费用', defaultVisible: true },
  { key: UsageColumnKey.LATENCY, label: '延迟', defaultVisible: true },
  { key: UsageColumnKey.CREATED_AT, label: '时间', sortable: true, defaultVisible: true, alwaysVisible: true },
  { key: UsageColumnKey.REQUEST_ID, label: '请求 ID', defaultVisible: false },
  { key: UsageColumnKey.USER_AGENT, label: 'User-Agent', defaultVisible: false },
  { key: UsageColumnKey.ACTIONS, label: '详情', defaultVisible: true, alwaysVisible: true }
]

export const errorColumns: UsageColumnDefinition<ErrorColumnKey>[] = [
  { key: ErrorColumnKey.KEY, label: 'API Key', defaultVisible: true },
  { key: ErrorColumnKey.MODEL, label: '模型', sortable: true, defaultVisible: true },
  { key: ErrorColumnKey.ENDPOINT, label: '入口端点', defaultVisible: true },
  { key: ErrorColumnKey.IP, label: '客户端 IP', defaultVisible: true },
  { key: ErrorColumnKey.GROUP, label: '分组', defaultVisible: true },
  { key: ErrorColumnKey.TYPE, label: '请求类型', defaultVisible: true },
  { key: ErrorColumnKey.PLATFORM, label: '平台', defaultVisible: true },
  { key: ErrorColumnKey.CATEGORY, label: '错误分类', defaultVisible: true },
  { key: ErrorColumnKey.STATUS, label: '状态码', sortable: true, defaultVisible: true },
  { key: ErrorColumnKey.MESSAGE, label: '错误消息', defaultVisible: true },
  { key: ErrorColumnKey.CREATED_AT, label: '时间', sortable: true, defaultVisible: true, alwaysVisible: true },
  { key: ErrorColumnKey.USER_AGENT, label: 'User-Agent', defaultVisible: false },
  { key: ErrorColumnKey.ACTIONS, label: '详情', defaultVisible: true, alwaysVisible: true }
]

export interface UsageFilters {
  startDate: string
  endDate: string
  apiKeyId: string
  model: string
  groupId: string
  requestType: UsageRequestFilter
  billingType: BillingTypeFilter
  billingMode: BillingModeFilter
}

export function buildUsageQuery(
  filters: UsageFilters,
  page: number,
  pageSize: number,
  sortBy: string,
  sortOrder: UsageSortOrder,
  timezone: string
): UsageQueryParams {
  const requestType = filters.requestType || undefined
  const stream = requestTypeToLegacyStream(requestType as UsageRequestType | undefined)
  return {
    page,
    page_size: pageSize,
    start_date: filters.startDate || undefined,
    end_date: filters.endDate || undefined,
    api_key_id: filters.apiKeyId ? Number(filters.apiKeyId) : undefined,
    model: filters.model.trim() || undefined,
    group_id: filters.groupId ? Number(filters.groupId) : undefined,
    request_type: requestType as UsageRequestType | undefined,
    stream: stream == null ? undefined : stream,
    billing_type: filters.billingType === BillingTypeFilter.ALL ? null : Number(filters.billingType),
    billing_mode: filters.billingMode || null,
    timezone,
    sort_by: sortBy,
    sort_order: sortOrder
  }
}

export function requestTypeLabel(row: Pick<UsageLog, 'request_type' | 'stream' | 'openai_ws_mode'>): string {
  const kind = resolveUsageRequestType(row)
  if (kind === 'ws_v2') return 'WebSocket'
  if (kind === 'live') return 'Live'
  if (kind === 'stream') return '流式'
  if (kind === 'sync') return '同步'
  if (kind === 'cyber') return 'Cyber'
  return '未知'
}

export function billingModeLabel(row: Pick<UsageLog, 'billing_mode' | 'image_count'>): string {
  const mode = getDisplayBillingMode(row)
  if (mode === BillingModeFilter.PER_REQUEST) return '按次'
  if (mode === BillingModeFilter.IMAGE) return '图片'
  if (mode === BillingModeFilter.VIDEO) return '视频'
  return 'Token'
}

export function billingTypeLabel(value: number): string {
  return value === 1 ? '订阅额度' : '账户余额'
}

export function totalTokens(row: UsageLog): number {
  return Number(row.input_tokens || 0) + Number(row.output_tokens || 0) + Number(row.cache_creation_tokens || 0) + Number(row.cache_read_tokens || 0)
}

export function escapeCsvValue(value: unknown): string {
  if (value == null) return ''
  const original = String(value)
  const protectedValue = /^[=+\-@\t\r]/.test(original) ? `'${original}` : original
  const escaped = protectedValue.replace(/"/g, '""')
  return /[,"\n\r]/.test(escaped) ? `"${escaped}"` : escaped
}

export const usageCsvHeaders = [
  'Time', 'Request ID', 'API Key', 'Model', 'Service Tier', 'Reasoning Effort', 'Inbound Endpoint',
  'Client IP', 'Group', 'Request Type', 'Billing Type', 'Billing Mode', 'Input Tokens', 'Output Tokens',
  'Cache Read Tokens', 'Cache Creation Tokens', 'Cache Write 5m', 'Cache Write 1h', 'Image Count',
  'Image Input Size', 'Image Output Size', 'Image Size Source', 'Image Input Tokens', 'Image Output Tokens',
  'Rate Multiplier', 'Standard Cost', 'Billed Cost', 'Input Cost', 'Output Cost', 'Cache Creation Cost',
  'Cache Read Cost', 'Image Input Cost', 'Image Output Cost', 'First Token ms', 'Duration ms',
  'Long Context Billing', 'Cache TTL Overridden', 'User Agent'
] as const

export function usageCsvRow(log: UsageLog): unknown[] {
  return [
    log.created_at,
    log.request_id,
    log.api_key?.name || '',
    log.model,
    log.service_tier || '',
    log.reasoning_effort || '',
    log.inbound_endpoint || '',
    log.ip_address || '',
    log.group?.name || '',
    requestTypeLabel(log),
    billingTypeLabel(log.billing_type),
    billingModeLabel(log),
    log.input_tokens,
    log.output_tokens,
    log.cache_read_tokens,
    log.cache_creation_tokens,
    log.cache_creation_5m_tokens,
    log.cache_creation_1h_tokens,
    log.image_count,
    log.image_input_size || '',
    log.image_output_size || log.image_size || '',
    log.image_size_source || '',
    log.image_input_tokens,
    log.image_output_tokens,
    log.rate_multiplier,
    log.total_cost,
    log.actual_cost,
    log.input_cost,
    log.output_cost,
    log.cache_creation_cost,
    log.cache_read_cost,
    log.image_input_cost,
    log.image_output_cost,
    log.first_token_ms ?? '',
    log.duration_ms ?? '',
    log.long_context_billing_applied ? 'yes' : 'no',
    log.cache_ttl_overridden ? 'yes' : 'no',
    log.user_agent || ''
  ]
}

export function buildUsageCsv(logs: UsageLog[]): string {
  return [
    usageCsvHeaders.map(escapeCsvValue).join(','),
    ...logs.map((log) => usageCsvRow(log).map(escapeCsvValue).join(','))
  ].join('\r\n')
}

export function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString('zh-CN')
}

export function formatUsd(value: number, digits = 6): string {
  return `$${Number(value || 0).toFixed(digits)}`
}

export function formatLatency(value: number | null): string {
  if (value == null) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${Math.round(value)} ms`
}

export function errorStatusTone(status: number): 'danger' | 'warning' | 'neutral' {
  if (status >= 500) return 'danger'
  if (status === 429 || status >= 400) return 'warning'
  return 'neutral'
}
