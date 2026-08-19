import type { AdminUser, UserAttributeDefinition } from '@/types'
import type { BatchUserUsageStats } from '@shared-api/admin/dashboard'

export enum AdminUserRole {
  USER = 'user',
  ADMIN = 'admin'
}

export enum AdminUserStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled'
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc'
}

export enum UserPanelTab {
  PROFILE = 'profile',
  ACCESS = 'access',
  KEYS = 'keys',
  FINANCE = 'finance',
  QUOTAS = 'quotas'
}

export enum BalanceOperation {
  ADD = 'add',
  SUBTRACT = 'subtract'
}

export enum BalanceHistoryType {
  ALL = '',
  BALANCE = 'balance',
  AFFILIATE_BALANCE = 'affiliate_balance',
  ADMIN_BALANCE = 'admin_balance',
  CONCURRENCY = 'concurrency',
  ADMIN_CONCURRENCY = 'admin_concurrency',
  SUBSCRIPTION = 'subscription'
}

export enum UsagePeriod {
  TODAY = 'today',
  TOTAL = 'total'
}

export enum PlatformQuotaPlatform {
  ANTHROPIC = 'anthropic',
  OPENAI = 'openai',
  GEMINI = 'gemini',
  ANTIGRAVITY = 'antigravity',
  GROK = 'grok'
}

export enum PlatformQuotaWindow {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly'
}

export enum UserAttributeTypeCode {
  TEXT = 'text',
  TEXTAREA = 'textarea',
  NUMBER = 'number',
  EMAIL = 'email',
  URL = 'url',
  DATE = 'date',
  SELECT = 'select',
  MULTI_SELECT = 'multi_select'
}

export enum UserColumnKey {
  ID = 'id',
  USERNAME = 'username',
  NOTES = 'notes',
  ROLE = 'role',
  GROUPS = 'groups',
  SUBSCRIPTIONS = 'subscriptions',
  BALANCE = 'balance',
  PLATFORM_QUOTA = 'balance_platform_quota',
  USAGE = 'usage',
  USAGE_ANTHROPIC = 'usage_anthropic',
  USAGE_OPENAI = 'usage_openai',
  USAGE_GEMINI = 'usage_gemini',
  USAGE_ANTIGRAVITY = 'usage_antigravity',
  CONCURRENCY = 'concurrency',
  STATUS = 'status',
  LAST_ACTIVE_AT = 'last_active_at',
  LAST_USED_AT = 'last_used_at',
  CREATED_AT = 'created_at'
}

export interface UserListFilterState {
  search: string
  role: '' | AdminUserRole
  status: '' | AdminUserStatus
  groupName: string
  apiKeyGroupId: number | null
  attributes: Record<number, string>
}

export interface UserListSortState {
  key: string
  order: SortOrder
}

export const ALL_USER_COLUMNS: Array<{ key: UserColumnKey; label: string; defaultVisible: boolean }> = [
  { key: UserColumnKey.ID, label: 'ID', defaultVisible: false },
  { key: UserColumnKey.USERNAME, label: '用户名', defaultVisible: true },
  { key: UserColumnKey.NOTES, label: '备注', defaultVisible: false },
  { key: UserColumnKey.ROLE, label: '角色', defaultVisible: true },
  { key: UserColumnKey.GROUPS, label: '授权分组', defaultVisible: false },
  { key: UserColumnKey.SUBSCRIPTIONS, label: '订阅', defaultVisible: false },
  { key: UserColumnKey.BALANCE, label: '余额', defaultVisible: true },
  { key: UserColumnKey.PLATFORM_QUOTA, label: '平台限额', defaultVisible: false },
  { key: UserColumnKey.USAGE, label: '用量', defaultVisible: false },
  { key: UserColumnKey.USAGE_ANTHROPIC, label: 'Anthropic 用量', defaultVisible: false },
  { key: UserColumnKey.USAGE_OPENAI, label: 'OpenAI 用量', defaultVisible: false },
  { key: UserColumnKey.USAGE_GEMINI, label: 'Gemini 用量', defaultVisible: false },
  { key: UserColumnKey.USAGE_ANTIGRAVITY, label: 'Antigravity 用量', defaultVisible: false },
  { key: UserColumnKey.CONCURRENCY, label: '并发 / RPM', defaultVisible: true },
  { key: UserColumnKey.STATUS, label: '状态', defaultVisible: true },
  { key: UserColumnKey.LAST_ACTIVE_AT, label: '最近活跃', defaultVisible: true },
  { key: UserColumnKey.LAST_USED_AT, label: '最近调用', defaultVisible: false },
  { key: UserColumnKey.CREATED_AT, label: '创建时间', defaultVisible: true }
]

export const SERVER_SORTABLE_COLUMNS = new Set<string>([
  'email', UserColumnKey.ID, UserColumnKey.USERNAME, UserColumnKey.ROLE,
  UserColumnKey.BALANCE, UserColumnKey.CONCURRENCY, UserColumnKey.STATUS,
  UserColumnKey.LAST_USED_AT, UserColumnKey.LAST_ACTIVE_AT, UserColumnKey.CREATED_AT
])

export function formatMoney(value: number | null | undefined): string {
  return `$${Number(value ?? 0).toFixed(2)}`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatAttributeValue(
  value: string | undefined,
  definition: UserAttributeDefinition
): string {
  if (!value) return '—'
  if (definition.type === 'multi_select') {
    try {
      const values = JSON.parse(value) as unknown
      if (Array.isArray(values)) {
        return values.map((entry) => definition.options?.find((option) => option.value === entry)?.label ?? String(entry)).join(', ')
      }
    } catch {
      return value
    }
  }
  if (definition.type === 'select') {
    return definition.options?.find((option) => option.value === value)?.label ?? value
  }
  return value
}

export function parseNonNegativeInteger(value: string | number): number | null {
  const normalized = String(value).trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function normalizeQuotaLimit(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function sortUsersByUsage(
  users: AdminUser[],
  stats: Record<string, BatchUserUsageStats>,
  platform: PlatformQuotaPlatform | null,
  period: UsagePeriod,
  order: SortOrder
): AdminUser[] {
  const valueOf = (user: AdminUser): number => {
    const value = stats[String(user.id)]
    if (!value) return 0
    if (!platform) return period === UsagePeriod.TODAY ? value.today_actual_cost ?? 0 : value.total_actual_cost ?? 0
    const platformValue = value.by_platform?.find((item) => item.platform === platform)
    return period === UsagePeriod.TODAY ? platformValue?.today_actual_cost ?? 0 : platformValue?.total_actual_cost ?? 0
  }
  return users.map((user, index) => ({ user, index }))
    .sort((left, right) => {
      const delta = valueOf(left.user) - valueOf(right.user)
      if (delta !== 0) return order === SortOrder.ASC ? delta : -delta
      return left.index - right.index
    })
    .map(({ user }) => user)
}
