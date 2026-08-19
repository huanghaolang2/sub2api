import type { Account, AccountPlatform, AccountType, CreateAccountRequest, UpdateAccountRequest } from '@/types'
import { findModelConflict, parseJsonValue, parseNonNegative } from './model'

export enum AccountEditorTab { BASIC = 'basic', CREDENTIALS = 'credentials', SCHEDULING = 'scheduling' }
export enum AccountOAuthMethod { CODE = 'code', REFRESH_TOKEN = 'refresh_token', SSO_COOKIE = 'sso_cookie', PASSWORD = 'password' }

export interface OAuthCredentialBuildOptions {
  refreshTokenFallback?: string
  geminiOAuthType?: string
  geminiTierId?: string
}

function definedEntries(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''))
}

export function buildOAuthCredentialPayload(platform: AccountPlatform, token: Record<string, unknown>, options: OAuthCredentialBuildOptions = {}): { credentials: Record<string, unknown>; extra: Record<string, unknown> } {
  if (platform === 'openai') return {
    credentials: definedEntries({ access_token: token.access_token, refresh_token: token.refresh_token || options.refreshTokenFallback, client_id: token.client_id, id_token: token.id_token, expires_at: token.expires_at, email: token.email, chatgpt_account_id: token.chatgpt_account_id, chatgpt_user_id: token.chatgpt_user_id, organization_id: token.organization_id, plan_type: token.plan_type, subscription_expires_at: token.subscription_expires_at }),
    extra: definedEntries({ email: token.email, name: token.name, privacy_mode: token.privacy_mode })
  }
  if (platform === 'gemini') return {
    credentials: definedEntries({ access_token: token.access_token, refresh_token: token.refresh_token || options.refreshTokenFallback, token_type: token.token_type, expires_at: typeof token.expires_at === 'number' ? Math.floor(token.expires_at).toString() : token.expires_at, scope: token.scope, project_id: token.project_id, oauth_type: token.oauth_type || options.geminiOAuthType, tier_id: token.tier_id || options.geminiTierId }),
    extra: token.extra && typeof token.extra === 'object' && !Array.isArray(token.extra) ? token.extra as Record<string, unknown> : {}
  }
  if (platform === 'antigravity') return {
    credentials: definedEntries({ access_token: token.access_token, refresh_token: token.refresh_token || options.refreshTokenFallback, token_type: token.token_type, expires_at: typeof token.expires_at === 'number' ? Math.floor(token.expires_at).toString() : token.expires_at, project_id: token.project_id, email: token.email }),
    extra: {}
  }
  if (platform === 'grok') return {
    credentials: definedEntries({ access_token: token.access_token, refresh_token: token.refresh_token || options.refreshTokenFallback, id_token: token.id_token, token_type: token.token_type, expires_at: token.expires_at, client_id: token.client_id, scope: token.scope, email: token.email, sub: token.sub, team_id: token.team_id, subscription_tier: token.subscription_tier, entitlement_status: token.entitlement_status }),
    extra: definedEntries({ email: token.email, subscription_tier: token.subscription_tier, entitlement_status: token.entitlement_status })
  }
  const { extra: tokenExtra, ...tokenCredentials } = token
  const extra = tokenExtra && typeof tokenExtra === 'object' && !Array.isArray(tokenExtra) ? { ...tokenExtra as Record<string, unknown> } : {}
  if (typeof token.org_uuid === 'string') extra.org_uuid = token.org_uuid
  if (typeof token.account_uuid === 'string') extra.account_uuid = token.account_uuid
  if (typeof token.email_address === 'string') extra.email_address = token.email_address
  return { credentials: definedEntries(tokenCredentials), extra }
}

export interface AccountDraft {
  name: string; notes: string; platform: AccountPlatform; type: AccountType; status: 'active' | 'inactive' | 'error'; schedulable: boolean
  credentials_json: string; extra_json: string; proxy_id: number | string; group_ids: number[]; concurrency: number; load_factor: number | string
  priority: number; rate_multiplier: number | string; expires_at: string; auto_pause_on_expired: boolean; upstream_billing_probe_enabled: boolean; upstream_billing_rate_sync_enabled: boolean
  window_cost_limit: number | string; window_cost_sticky_reserve: number | string; max_sessions: number | string; session_idle_timeout_minutes: number | string
  base_rpm: number | string; rpm_strategy: string; rpm_sticky_buffer: number | string; user_msg_queue_mode: string
  enable_tls_fingerprint: boolean; tls_fingerprint_profile_id: number | string; session_id_masking_enabled: boolean
  cache_ttl_override_enabled: boolean; cache_ttl_override_target: string; custom_base_url_enabled: boolean; custom_base_url: string
  quota_limit: number | string; quota_daily_limit: number | string; quota_weekly_limit: number | string
  quota_daily_reset_mode: string; quota_daily_reset_hour: number | string; quota_weekly_reset_mode: string; quota_weekly_reset_day: number | string; quota_weekly_reset_hour: number | string; quota_reset_timezone: string
}

export function emptyAccountDraft(): AccountDraft { return { name: '', notes: '', platform: 'openai', type: 'apikey', status: 'active', schedulable: true, credentials_json: '{}', extra_json: '{}', proxy_id: '', group_ids: [], concurrency: 1, load_factor: '', priority: 0, rate_multiplier: 1, expires_at: '', auto_pause_on_expired: false, upstream_billing_probe_enabled: false, upstream_billing_rate_sync_enabled: false, window_cost_limit: '', window_cost_sticky_reserve: '', max_sessions: '', session_idle_timeout_minutes: '', base_rpm: '', rpm_strategy: '', rpm_sticky_buffer: '', user_msg_queue_mode: '', enable_tls_fingerprint: false, tls_fingerprint_profile_id: '', session_id_masking_enabled: false, cache_ttl_override_enabled: false, cache_ttl_override_target: '', custom_base_url_enabled: false, custom_base_url: '', quota_limit: '', quota_daily_limit: '', quota_weekly_limit: '', quota_daily_reset_mode: '', quota_daily_reset_hour: '', quota_weekly_reset_mode: '', quota_weekly_reset_day: '', quota_weekly_reset_hour: '', quota_reset_timezone: 'UTC' } }

const runtimeKeys = ['window_cost_limit', 'window_cost_sticky_reserve', 'max_sessions', 'session_idle_timeout_minutes', 'base_rpm', 'rpm_strategy', 'rpm_sticky_buffer', 'user_msg_queue_mode', 'enable_tls_fingerprint', 'tls_fingerprint_profile_id', 'session_id_masking_enabled', 'cache_ttl_override_enabled', 'cache_ttl_override_target', 'custom_base_url_enabled', 'custom_base_url', 'quota_limit', 'quota_daily_limit', 'quota_weekly_limit', 'quota_daily_reset_mode', 'quota_daily_reset_hour', 'quota_weekly_reset_mode', 'quota_weekly_reset_day', 'quota_weekly_reset_hour', 'quota_reset_timezone'] as const

export function accountToDraft(account: Account): AccountDraft {
  const draft = emptyAccountDraft(); const extra = { ...(account.extra || {}) }
  for (const key of runtimeKeys) { const value = account[key as keyof Account]; if (value != null) extra[key] = value }
  Object.assign(draft, { name: account.name, notes: account.notes || '', platform: account.platform, type: account.type, status: account.status, schedulable: account.schedulable, credentials_json: JSON.stringify(account.credentials || {}, null, 2), extra_json: JSON.stringify(extra, null, 2), proxy_id: account.proxy_id ?? '', group_ids: [...(account.group_ids || [])], concurrency: account.concurrency, load_factor: account.load_factor ?? '', priority: account.priority, rate_multiplier: account.rate_multiplier ?? 1, expires_at: account.expires_at ? new Date(account.expires_at * 1000).toISOString().slice(0, 16) : '', auto_pause_on_expired: account.auto_pause_on_expired, upstream_billing_probe_enabled: account.extra?.upstream_billing_probe_enabled === true, upstream_billing_rate_sync_enabled: account.extra?.upstream_billing_rate_sync_enabled === true })
  for (const key of runtimeKeys) { const value = extra[key]; if (value != null) (draft as unknown as Record<string, unknown>)[key] = value }
  return draft
}

function optional(value: unknown, field: string): number | null { return parseNonNegative(value, field) }

export function accountDraftToRequest(draft: AccountDraft, editing: boolean): CreateAccountRequest | UpdateAccountRequest {
  if (!draft.name.trim()) throw new Error('账号名称不能为空')
  if (!Number.isInteger(draft.concurrency) || draft.concurrency < 1 || !Number.isInteger(draft.priority)) throw new Error('并发至少为 1，优先级必须是整数')
  const extra = parseJsonValue<Record<string, unknown>>(draft.extra_json, '高级配置', {})
  const credentials = draft.credentials_json.trim()
    ? parseJsonValue<Record<string, unknown>>(draft.credentials_json, '凭据', {})
    : null
  const modelMapping = credentials?.model_mapping
  if (modelMapping && typeof modelMapping === 'object' && !Array.isArray(modelMapping)) {
    const conflict = findModelConflict(Object.keys(modelMapping as Record<string, unknown>))
    if (conflict) throw new Error(`模型映射 ${conflict[0]} 与 ${conflict[1]} 存在精确/通配冲突`)
  }
  const numericExtras: Array<[keyof AccountDraft, string]> = [['window_cost_limit', '窗口费用上限'], ['window_cost_sticky_reserve', '粘性预留'], ['max_sessions', '最大会话数'], ['session_idle_timeout_minutes', '会话空闲分钟'], ['base_rpm', '基础 RPM'], ['rpm_sticky_buffer', 'RPM 粘性缓冲'], ['tls_fingerprint_profile_id', 'TLS 指纹档案'], ['quota_limit', '总配额'], ['quota_daily_limit', '每日配额'], ['quota_weekly_limit', '每周配额'], ['quota_daily_reset_hour', '每日重置小时'], ['quota_weekly_reset_day', '每周重置日'], ['quota_weekly_reset_hour', '每周重置小时']]
  numericExtras.forEach(([key, label]) => { const value = optional(draft[key], label); if (value == null) delete extra[key]; else extra[key] = value })
  Object.assign(extra, { rpm_strategy: draft.rpm_strategy || undefined, user_msg_queue_mode: draft.user_msg_queue_mode || undefined, enable_tls_fingerprint: draft.enable_tls_fingerprint, session_id_masking_enabled: draft.session_id_masking_enabled, cache_ttl_override_enabled: draft.cache_ttl_override_enabled, cache_ttl_override_target: draft.cache_ttl_override_target || undefined, custom_base_url_enabled: draft.custom_base_url_enabled, custom_base_url: draft.custom_base_url || undefined, quota_daily_reset_mode: draft.quota_daily_reset_mode || undefined, quota_weekly_reset_mode: draft.quota_weekly_reset_mode || undefined, quota_reset_timezone: draft.quota_reset_timezone || undefined, upstream_billing_probe_enabled: draft.upstream_billing_probe_enabled, upstream_billing_rate_sync_enabled: draft.upstream_billing_rate_sync_enabled })
  const base = { name: draft.name.trim(), notes: draft.notes.trim() || null, type: draft.type, extra, proxy_id: draft.proxy_id === '' ? null : Number(draft.proxy_id), concurrency: draft.concurrency, load_factor: optional(draft.load_factor, '负载系数'), priority: draft.priority, rate_multiplier: parseNonNegative(draft.rate_multiplier, '计费倍率', false)!, group_ids: [...draft.group_ids], expires_at: draft.expires_at ? Math.floor(new Date(draft.expires_at).getTime() / 1000) : null, auto_pause_on_expired: draft.auto_pause_on_expired, upstream_billing_probe_enabled: draft.upstream_billing_probe_enabled }
  if (!editing) return { ...base, platform: draft.platform, credentials: credentials || {} }
  const payload: UpdateAccountRequest = { ...base, status: draft.status, schedulable: draft.schedulable, upstream_billing_rate_sync_enabled: draft.upstream_billing_rate_sync_enabled }
  if (credentials) payload.credentials = credentials
  return payload
}
