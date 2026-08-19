import type { ApiKey, UpdateApiKeyRequest } from '@/types'

export enum KeyColumnKey {
  NAME = 'name',
  ID = 'id',
  KEY = 'key',
  GROUP = 'group',
  CONCURRENCY = 'current_concurrency',
  USAGE = 'usage',
  RATE_LIMIT = 'rate_limit',
  EXPIRES_AT = 'expires_at',
  STATUS = 'status',
  LAST_USED_AT = 'last_used_at',
  LAST_USED_IP = 'last_used_ip',
  CREATED_AT = 'created_at',
  ACTIONS = 'actions'
}

export enum KeySortOrder {
  ASC = 'asc',
  DESC = 'desc'
}

export enum KeyStatusFilter {
  ALL = '',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  QUOTA_EXHAUSTED = 'quota_exhausted',
  EXPIRED = 'expired'
}

export enum KeyEditorMode {
  CREATE = 'create',
  EDIT = 'edit'
}

export enum ExpirationPreset {
  SEVEN_DAYS = '7',
  THIRTY_DAYS = '30',
  NINETY_DAYS = '90',
  CUSTOM = 'custom'
}

export enum CcSwitchClient {
  CLAUDE = 'claude',
  GEMINI = 'gemini'
}

export enum KeyClient {
  CLAUDE_CODE = 'claude_code',
  CODEX = 'codex',
  CODEX_WS = 'codex_ws',
  GEMINI_CLI = 'gemini_cli',
  GROK_CLI = 'grok_cli',
  OPENCODE = 'opencode'
}

export enum ShellMode {
  UNIX = 'unix',
  WINDOWS = 'windows',
  CMD = 'cmd',
  POWERSHELL = 'powershell'
}

export enum CodexAuthMode {
  LEGACY = 'legacy',
  API_KEY = 'api_key'
}

export interface KeyColumnDefinition {
  key: KeyColumnKey
  label: string
  sortable: boolean
  defaultVisible: boolean
  alwaysVisible?: boolean
}

export const keyColumns: KeyColumnDefinition[] = [
  { key: KeyColumnKey.NAME, label: '名称', sortable: true, defaultVisible: true, alwaysVisible: true },
  { key: KeyColumnKey.ID, label: 'ID', sortable: true, defaultVisible: false },
  { key: KeyColumnKey.KEY, label: 'API Key', sortable: false, defaultVisible: true },
  { key: KeyColumnKey.GROUP, label: '分组', sortable: false, defaultVisible: true },
  { key: KeyColumnKey.CONCURRENCY, label: '当前并发', sortable: true, defaultVisible: true },
  { key: KeyColumnKey.USAGE, label: '用量 / 配额', sortable: false, defaultVisible: true },
  { key: KeyColumnKey.RATE_LIMIT, label: '周期限额', sortable: false, defaultVisible: false },
  { key: KeyColumnKey.EXPIRES_AT, label: '到期时间', sortable: true, defaultVisible: true },
  { key: KeyColumnKey.STATUS, label: '状态', sortable: true, defaultVisible: true },
  { key: KeyColumnKey.LAST_USED_AT, label: '最后使用', sortable: true, defaultVisible: false },
  { key: KeyColumnKey.LAST_USED_IP, label: '最后 IP', sortable: false, defaultVisible: false },
  { key: KeyColumnKey.CREATED_AT, label: '创建时间', sortable: true, defaultVisible: true },
  { key: KeyColumnKey.ACTIONS, label: '操作', sortable: false, defaultVisible: true, alwaysVisible: true }
]

export interface KeyEditorDraft {
  name: string
  groupId: number | null
  status: 'active' | 'inactive'
  useCustomKey: boolean
  customKey: string
  enableIpRestriction: boolean
  ipWhitelist: string
  ipBlacklist: string
  quota: number | null
  enableRateLimit: boolean
  rateLimit5h: number | null
  rateLimit1d: number | null
  rateLimit7d: number | null
  enableExpiration: boolean
  expirationPreset: ExpirationPreset
  expirationDate: string
}

export function createEmptyKeyDraft(): KeyEditorDraft {
  return {
    name: '',
    groupId: null,
    status: 'active',
    useCustomKey: false,
    customKey: '',
    enableIpRestriction: false,
    ipWhitelist: '',
    ipBlacklist: '',
    quota: null,
    enableRateLimit: false,
    rateLimit5h: null,
    rateLimit1d: null,
    rateLimit7d: null,
    enableExpiration: false,
    expirationPreset: ExpirationPreset.THIRTY_DAYS,
    expirationDate: ''
  }
}

export function draftFromKey(key: ApiKey): KeyEditorDraft {
  const whitelist = key.ip_whitelist ?? []
  const blacklist = key.ip_blacklist ?? []
  return {
    name: key.name,
    groupId: key.group_id,
    status: key.status === 'active' ? 'active' : 'inactive',
    useCustomKey: false,
    customKey: '',
    enableIpRestriction: whitelist.length > 0 || blacklist.length > 0,
    ipWhitelist: whitelist.join('\n'),
    ipBlacklist: blacklist.join('\n'),
    quota: key.quota > 0 ? key.quota : null,
    enableRateLimit: key.rate_limit_5h > 0 || key.rate_limit_1d > 0 || key.rate_limit_7d > 0,
    rateLimit5h: key.rate_limit_5h || null,
    rateLimit1d: key.rate_limit_1d || null,
    rateLimit7d: key.rate_limit_7d || null,
    enableExpiration: Boolean(key.expires_at),
    expirationPreset: ExpirationPreset.CUSTOM,
    expirationDate: key.expires_at ? toDateTimeLocal(key.expires_at) : ''
  }
}

export function parseIpLines(value: string): string[] {
  return Array.from(new Set(value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean)))
}

export function validateCustomKey(value: string): string {
  if (!value) return '请输入自定义 Key'
  if (value.length < 16) return '自定义 Key 至少需要 16 个字符'
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return '自定义 Key 只能包含字母、数字、下划线和连字符'
  return ''
}

export function positiveOrZero(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function expiresInDays(dateValue: string, now: Date = new Date()): number | undefined {
  if (!dateValue) return undefined
  const target = new Date(dateValue)
  if (Number.isNaN(target.getTime())) return undefined
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 86_400_000))
}

export function buildKeyUpdate(draft: KeyEditorDraft, key: ApiKey): UpdateApiKeyRequest {
  const updates: UpdateApiKeyRequest = {
    name: draft.name.trim(),
    group_id: draft.groupId,
    ip_whitelist: draft.enableIpRestriction ? parseIpLines(draft.ipWhitelist) : [],
    ip_blacklist: draft.enableIpRestriction ? parseIpLines(draft.ipBlacklist) : [],
    quota: positiveOrZero(draft.quota),
    expires_at: draft.enableExpiration && draft.expirationDate
      ? new Date(draft.expirationDate).toISOString()
      : '',
    rate_limit_5h: draft.enableRateLimit ? positiveOrZero(draft.rateLimit5h) : 0,
    rate_limit_1d: draft.enableRateLimit ? positiveOrZero(draft.rateLimit1d) : 0,
    rate_limit_7d: draft.enableRateLimit ? positiveOrZero(draft.rateLimit7d) : 0
  }
  if (key.status !== 'quota_exhausted' && key.status !== 'expired') updates.status = draft.status
  if ((key.status === 'quota_exhausted' || key.status === 'expired') && draft.status === 'active') updates.status = 'active'
  return updates
}

export function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function expirationDateForDays(days: number, now: Date = new Date()): string {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  return toDateTimeLocal(date.toISOString())
}

export function maskApiKey(value: string): string {
  if (value.length <= 20) return value
  return `${value.slice(0, 12)}••••${value.slice(-6)}`
}

export function formatMoney(value: number, digits = 4): string {
  return `$${Number(value || 0).toFixed(digits)}`
}

export function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, Math.max(0, used / limit * 100))
}

export function formatResetCountdown(value: string | null, now: Date = new Date()): string {
  if (!value) return ''
  const difference = new Date(value).getTime() - now.getTime()
  if (difference <= 0) return '即将重置'
  const days = Math.floor(difference / 86_400_000)
  const hours = Math.floor((difference % 86_400_000) / 3_600_000)
  const minutes = Math.floor((difference % 3_600_000) / 60_000)
  if (days > 0) return `${days}天 ${hours}小时`
  if (hours > 0) return `${hours}小时 ${minutes}分`
  return `${minutes}分`
}
