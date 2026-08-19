export enum SetupWizardStep {
  DATABASE = 'database',
  REDIS = 'redis',
  ADMIN = 'admin',
  REVIEW = 'review',
}

export enum DatabaseSSLMode {
  DISABLE = 'disable',
  REQUIRE = 'require',
  VERIFY_CA = 'verify-ca',
  VERIFY_FULL = 'verify-full',
}

export enum ServerRunMode {
  RELEASE = 'release',
  DEBUG = 'debug',
}

export enum OAuthProvider {
  GITHUB = 'github',
  GOOGLE = 'google',
  LINUXDO = 'linuxdo',
  DINGTALK = 'dingtalk',
  WECHAT = 'wechat',
  OIDC = 'oidc',
}

export enum OAuthPendingAction {
  NONE = 'none',
  INVITATION = 'invitation',
  ADOPTION = 'adoption',
  CHOOSE_ACCOUNT = 'choose_account',
  CREATE_ACCOUNT = 'create_account',
  BIND_LOGIN = 'bind_login',
  TOTP = 'totp',
}

export enum PublicAuthState {
  LOADING = 'loading',
  FORM = 'form',
  SUCCESS = 'success',
  ERROR = 'error',
}

export enum AsyncValidationState {
  IDLE = 'idle',
  CHECKING = 'checking',
  VALID = 'valid',
  INVALID = 'invalid',
}

export enum KeyUsageRange {
  TODAY = 'today',
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
  NINETY_DAYS = '90d',
  CUSTOM = 'custom',
}

export enum PublicKeyUsageMode {
  QUOTA_LIMITED = 'quota_limited',
  UNRESTRICTED = 'unrestricted',
}

export enum PublicKeyStatus {
  ACTIVE = 'active',
  QUOTA_EXHAUSTED = 'quota_exhausted',
  EXPIRED = 'expired',
}

export enum RateLimitWindow {
  FIVE_HOURS = '5h',
  ONE_DAY = '1d',
  SEVEN_DAYS = '7d',
}

export enum KeyUsageHistoryDays {
  SEVEN = 7,
  THIRTY = 30,
  NINETY = 90,
}

export function sanitizeRedirectPath(value: unknown, fallback = '/app/dashboard'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  if (value.includes('://') || value.includes('\n') || value.includes('\r')) return fallback
  return value
}

export function normalizePendingOAuthAction(value: unknown): OAuthPendingAction {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'invitation_required') return OAuthPendingAction.INVITATION
  if (['choice', 'choose_account_action_required', 'choose_account_action', 'choose_account', 'choose'].includes(normalized)) return OAuthPendingAction.CHOOSE_ACCOUNT
  if (['email_required', 'create_account_required', 'create_account', 'registration_completion_required'].includes(normalized)) return OAuthPendingAction.CREATE_ACCOUNT
  if (['bind_login_required', 'bind_login', 'existing_account', 'existing_account_required', 'existing_account_binding_required', 'adopt_existing_user_by_email'].includes(normalized)) return OAuthPendingAction.BIND_LOGIN
  return OAuthPendingAction.NONE
}

export function passwordValidationMessage(password: string, confirmation?: string): string {
  if (!password) return '请输入密码'
  if (password.length < 6) return '密码至少需要 6 位'
  if (confirmation !== undefined && password !== confirmation) return '两次输入的密码不一致'
  return ''
}

export function emailIsValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function localDate(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}
