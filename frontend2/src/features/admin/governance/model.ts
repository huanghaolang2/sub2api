export enum GovernanceSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export enum AnnouncementStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum AnnouncementNotifyMode {
  SILENT = 'silent',
  POPUP = 'popup',
}

export enum OpsQueryMode {
  AUTO = 'auto',
  RAW = 'raw',
  PREAGG = 'preagg',
}

export enum OpsTimeRange {
  FIVE_MINUTES = '5m',
  THIRTY_MINUTES = '30m',
  ONE_HOUR = '1h',
  SIX_HOURS = '6h',
  ONE_DAY = '24h',
}

export enum OpsWorkspaceTab {
  OVERVIEW = 'overview',
  REQUESTS = 'requests',
  ERRORS = 'errors',
  ALERTS = 'alerts',
  LOGS = 'logs',
  SETTINGS = 'settings',
}

export enum OpsErrorSourceTab {
  REQUEST = 'request',
  UPSTREAM = 'upstream',
}

export enum AlertSeverity {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info',
}

export enum AlertOperator {
  GREATER = '>',
  GREATER_OR_EQUAL = '>=',
  LESS = '<',
  LESS_OR_EQUAL = '<=',
  EQUAL = '==',
  NOT_EQUAL = '!=',
}

export enum AlertMetric {
  SUCCESS_RATE = 'success_rate',
  ERROR_RATE = 'error_rate',
  UPSTREAM_ERROR_RATE = 'upstream_error_rate',
  CPU_USAGE = 'cpu_usage_percent',
  MEMORY_USAGE = 'memory_usage_percent',
  CONCURRENCY_QUEUE = 'concurrency_queue_depth',
  GROUP_AVAILABLE_ACCOUNTS = 'group_available_accounts',
  GROUP_AVAILABLE_RATIO = 'group_available_ratio',
  GROUP_RATE_LIMIT_RATIO = 'group_rate_limit_ratio',
  ACCOUNT_RATE_LIMITED = 'account_rate_limited_count',
  ACCOUNT_ERROR_COUNT = 'account_error_count',
  ACCOUNT_ERROR_RATIO = 'account_error_ratio',
  ACCOUNT_TEMP_UNSCHEDULED = 'account_temp_unscheduled_count',
  OVERLOAD_ACCOUNT_COUNT = 'overload_account_count',
}

export enum AuditSuccessFilter {
  ALL = '',
  SUCCESS = 'true',
  FAILED = 'false',
}

export enum AdminUsageTab {
  USAGE = 'usage',
  ERRORS = 'errors',
  RANKING = 'ranking',
  CLEANUP = 'cleanup',
}

export enum UsageRequestType {
  UNKNOWN = 'unknown',
  SYNC = 'sync',
  STREAM = 'stream',
  WS_V2 = 'ws_v2',
  CYBER = 'cyber',
  LIVE = 'live',
}

export enum AnnouncementTargetMode {
  ALL = 'all',
  CUSTOM = 'custom',
}

export enum ModerationMode {
  OFF = 'off',
  OBSERVE = 'observe',
  PRE_BLOCK = 'pre_block',
}

export enum KeywordBlockingMode {
  KEYWORD_ONLY = 'keyword_only',
  KEYWORD_AND_API = 'keyword_and_api',
  API_ONLY = 'api_only',
}

export enum ModelFilterType {
  ALL = 'all',
  INCLUDE = 'include',
  EXCLUDE = 'exclude',
}

export enum APIKeysWriteMode {
  APPEND = 'append',
  REPLACE = 'replace',
}

export enum PromptAuditMode {
  OFF = 'off',
  ASYNC_AUDIT = 'async_audit',
  BLOCKING = 'blocking',
}

export enum PromptAuditTab {
  EVENTS = 'events',
  CONFIG = 'config',
}

export enum PromptDeleteRange {
  ONE_DAY = '1d',
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
  NINETY_DAYS = '90d',
  ALL = 'all',
  CUSTOM = 'custom',
}

export enum SettingsSection {
  GENERAL = 'general',
  AGREEMENT = 'agreement',
  FEATURES = 'features',
  SECURITY = 'security',
  USERS = 'users',
  GATEWAY = 'gateway',
  PAYMENT = 'payment',
  EMAIL = 'email',
  ADVANCED = 'advanced',
}

export enum SettingsValidationCode {
  TABLE_PAGE_SIZE = 'table_page_size',
  TABLE_PAGE_SIZE_OPTIONS = 'table_page_size_options',
  LOGIN_AGREEMENT_DOCUMENTS = 'login_agreement_documents',
  DUPLICATE_SUBSCRIPTION_GROUP = 'duplicate_subscription_group',
  WECHAT_MODE_CONFLICT = 'wechat_mode_conflict',
  FORWARDED_HEADER = 'forwarded_header',
  HTTP_URL = 'http_url',
}

export interface SettingsValidationIssue {
  code: SettingsValidationCode
  key: string
  message: string
}

export enum StreamTimeoutAction {
  TEMP_UNSCHEDULE = 'temp_unsched',
  ERROR = 'error',
  NONE = 'none',
}

export enum WebSearchProviderType {
  BRAVE = 'brave',
  TAVILY = 'tavily',
}

export enum BackupWorkspaceTab {
  STORAGE = 'storage',
  CLASSIC = 'classic',
  SOURCES = 'sources',
  JOBS = 'jobs',
}

export enum DataSourceType {
  POSTGRES = 'postgres',
  REDIS = 'redis',
}

export enum BackupType {
  POSTGRES = 'postgres',
  REDIS = 'redis',
  FULL = 'full',
}

export function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function formatGovernanceDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}

export function formatCompactNumber(value: number | null | undefined): string {
  const number = Number(value || 0)
  return new Intl.NumberFormat('zh-CN', { notation: number >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number)
}

export function formatMoney(value: number | null | undefined): string {
  return `$${Number(value || 0).toFixed(4)}`
}

export function formatDuration(milliseconds: number | null | undefined): string {
  const value = Number(milliseconds || 0)
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`
}

export function toDatetimeLocal(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function datetimeLocalToEpoch(value: string): number | undefined {
  if (!value) return undefined
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? undefined : Math.floor(time / 1000)
}

export function splitLines(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))]
}

export function downloadCSV(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  const encode = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value)
    return `"${text.replace(/"/g, '""')}"`
  }
  const csv = [headers, ...rows].map((row) => row.map(encode).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  URL.revokeObjectURL(href)
}

const READ_ONLY_SETTING_KEYS = new Set([
  'totp_encryption_key_configured', 'passkey_configured', 'smtp_password_configured',
  'turnstile_secret_key_configured', 'tencent_captcha_app_secret_key_configured',
  'tencent_captcha_cloud_secret_id_configured', 'tencent_captcha_cloud_secret_key_configured',
  'aliyun_captcha_access_key_secret_configured', 'linuxdo_connect_client_secret_configured',
  'dingtalk_connect_client_secret_configured', 'wechat_connect_app_secret_configured',
  'wechat_connect_open_app_secret_configured', 'wechat_connect_mp_app_secret_configured',
  'wechat_connect_mobile_app_secret_configured', 'oidc_connect_client_secret_configured',
  'github_oauth_client_secret_configured', 'google_oauth_client_secret_configured',
  'openai_codex_client_version_synced',
])

export function isReadonlySetting(key: string): boolean {
  return READ_ONLY_SETTING_KEYS.has(key) || key.startsWith('openai_advanced_scheduler_effective_')
}

export function settingSectionForKey(key: string): SettingsSection {
  if (key.startsWith('login_agreement_')) return SettingsSection.AGREEMENT
  if (/^(registration_|email_verify_|password_reset_|invitation_|totp_|passkey_|session_binding_|step_up_|audit_log_|turnstile_|tencent_captcha_|aliyun_captcha_|api_key_acl_|forwarded_client_ip_)/.test(key)) return SettingsSection.SECURITY
  if (/^(default_|auth_source_|force_email_|affiliate_rebate_|affiliate_admin_)/.test(key)) return SettingsSection.USERS
  if (/^(smtp_|balance_low_|subscription_expiry_|account_quota_)/.test(key)) return SettingsSection.EMAIL
  if (/^(payment_)/.test(key)) return SettingsSection.PAYMENT
  if (/^(site_|api_base_|contact_|doc_|home_|compact_home_|hide_ccs_|table_|backend_mode_|custom_menu_|custom_endpoints)/.test(key)) return SettingsSection.GENERAL
  if (/^(ops_|risk_control_|channel_monitor_|available_channels_|model_plaza_|affiliate_enabled|promo_code_enabled|web_search_)/.test(key)) return SettingsSection.FEATURES
  if (/^(linuxdo_|dingtalk_|wechat_|oidc_|github_|google_|enable_model_|fallback_model_|grok_|account_scheduling_|enable_identity_|allow_ungrouped_|enable_fingerprint_|enable_metadata_|enable_cch_|enable_claude_|claude_oauth_|enable_anthropic_|rewrite_message_|enable_client_|antigravity_|openai_|min_claude_|max_claude_|min_codex_|max_codex_|codex_|cyber_|allow_user_)/.test(key)) return SettingsSection.GATEWAY
  return SettingsSection.ADVANCED
}

const SETTING_LABELS: Record<string, string> = {
  registration_enabled: '开放注册', email_verify_enabled: '注册邮箱验证', registration_email_suffix_whitelist: '邮箱域名白名单',
  site_name: '站点名称', site_logo: '站点 Logo', site_subtitle: '站点副标题', api_base_url: 'API 基础地址',
  frontend_url: '前端地址', contact_info: '联系信息', doc_url: '文档地址', home_content: '首页内容',
  payment_enabled: '支付功能', risk_control_enabled: '风险控制', ops_monitoring_enabled: '运维监控',
  channel_monitor_enabled: '渠道监控', available_channels_enabled: '可用渠道页', model_plaza_enabled: '模型广场',
  affiliate_enabled: '邀请返利', smtp_host: 'SMTP 主机', smtp_port: 'SMTP 端口', smtp_username: 'SMTP 用户名',
  smtp_from_email: '发件邮箱', smtp_from_name: '发件人名称', smtp_use_tls: 'SMTP TLS',
}

export function settingLabel(key: string): string {
  return SETTING_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function serializeSetting(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export function parseSettingDraft(raw: string, original: unknown): unknown {
  if (typeof original === 'boolean') return raw === 'true'
  if (typeof original === 'number') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('请输入有效数字')
    return value
  }
  if (Array.isArray(original) || (typeof original === 'object' && original !== null)) {
    return JSON.parse(raw)
  }
  return raw
}

const TABLE_PAGE_SIZE_MIN = 5
const TABLE_PAGE_SIZE_MAX = 1000
const MAX_FORWARDED_CLIENT_IP_HEADERS = 16
const FORWARDED_CLIENT_IP_HEADER_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const OPTIONAL_HTTP_URL_KEYS = ['frontend_url', 'doc_url'] as const

function normalizeAgreementDocumentID(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

function duplicateSubscriptionGroup(value: unknown): number | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<number>()
  for (const entry of value) {
    const groupID = Number((entry as { group_id?: unknown })?.group_id)
    if (!Number.isFinite(groupID) || groupID <= 0) continue
    if (seen.has(groupID)) return groupID
    seen.add(groupID)
  }
  return null
}

function validHTTPURL(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (typeof value !== 'string') return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function validateSettingsRecord(settings: Record<string, unknown>): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = []
  const defaultPageSize = Number(settings.table_default_page_size)
  if ('table_default_page_size' in settings && (!Number.isInteger(defaultPageSize) || defaultPageSize < TABLE_PAGE_SIZE_MIN || defaultPageSize > TABLE_PAGE_SIZE_MAX)) {
    issues.push({
      code: SettingsValidationCode.TABLE_PAGE_SIZE,
      key: 'table_default_page_size',
      message: `默认分页大小必须是 ${TABLE_PAGE_SIZE_MIN}–${TABLE_PAGE_SIZE_MAX} 的整数`,
    })
  }

  if ('table_page_size_options' in settings) {
    const options = settings.table_page_size_options
    if (!Array.isArray(options) || options.length === 0 || options.some((value) => !Number.isInteger(value) || value < TABLE_PAGE_SIZE_MIN || value > TABLE_PAGE_SIZE_MAX)) {
      issues.push({
        code: SettingsValidationCode.TABLE_PAGE_SIZE_OPTIONS,
        key: 'table_page_size_options',
        message: `分页候选值必须是非空数组，且每项为 ${TABLE_PAGE_SIZE_MIN}–${TABLE_PAGE_SIZE_MAX} 的整数`,
      })
    }
  }

  if (settings.login_agreement_enabled === true) {
    const documents = settings.login_agreement_documents
    if (!Array.isArray(documents) || documents.length === 0) {
      issues.push({
        code: SettingsValidationCode.LOGIN_AGREEMENT_DOCUMENTS,
        key: 'login_agreement_documents',
        message: '启用登录条款确认时，至少需要一份协议文档',
      })
    } else {
      const seen = new Set<string>()
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index] as { id?: unknown; title?: unknown }
        const title = String(document?.title ?? '').trim()
        const id = normalizeAgreementDocumentID(document?.id || title) || `doc-${index + 1}`
        if (!title) {
          issues.push({
            code: SettingsValidationCode.LOGIN_AGREEMENT_DOCUMENTS,
            key: 'login_agreement_documents',
            message: `第 ${index + 1} 份协议文档缺少标题`,
          })
          break
        }
        if (seen.has(id)) {
          issues.push({
            code: SettingsValidationCode.LOGIN_AGREEMENT_DOCUMENTS,
            key: 'login_agreement_documents',
            message: `协议文档路由重复：/legal/${id}`,
          })
          break
        }
        seen.add(id)
      }
    }
  }

  for (const key of Object.keys(settings).filter((candidate) => candidate === 'default_subscriptions' || /^auth_source_default_.+_subscriptions$/.test(candidate))) {
    const duplicate = duplicateSubscriptionGroup(settings[key])
    if (duplicate !== null) {
      issues.push({
        code: SettingsValidationCode.DUPLICATE_SUBSCRIPTION_GROUP,
        key,
        message: `同一默认订阅中不能重复选择分组 ${duplicate}`,
      })
    }
  }

  if (settings.wechat_connect_mp_enabled === true && settings.wechat_connect_mobile_enabled === true) {
    issues.push({
      code: SettingsValidationCode.WECHAT_MODE_CONFLICT,
      key: 'wechat_connect_mp_enabled',
      message: '微信公众号和移动应用不能同时启用',
    })
    issues.push({
      code: SettingsValidationCode.WECHAT_MODE_CONFLICT,
      key: 'wechat_connect_mobile_enabled',
      message: '微信公众号和移动应用不能同时启用',
    })
  }

  if ('forwarded_client_ip_headers' in settings) {
    const headers = settings.forwarded_client_ip_headers
    const normalized = Array.isArray(headers) ? headers.map((value) => String(value).trim()).filter(Boolean) : []
    const unique = new Set(normalized.map((value) => value.toLowerCase()))
    if (!Array.isArray(headers) || normalized.length > MAX_FORWARDED_CLIENT_IP_HEADERS || unique.size !== normalized.length || normalized.some((value) => !FORWARDED_CLIENT_IP_HEADER_PATTERN.test(value))) {
      issues.push({
        code: SettingsValidationCode.FORWARDED_HEADER,
        key: 'forwarded_client_ip_headers',
        message: `可信客户端 IP Header 必须合法、不可重复，且最多 ${MAX_FORWARDED_CLIENT_IP_HEADERS} 个`,
      })
    }
  }

  for (const key of OPTIONAL_HTTP_URL_KEYS) {
    if (key in settings && !validHTTPURL(settings[key])) {
      issues.push({
        code: SettingsValidationCode.HTTP_URL,
        key,
        message: '请输入以 http:// 或 https:// 开头的有效地址，或留空',
      })
    }
  }

  return issues
}
