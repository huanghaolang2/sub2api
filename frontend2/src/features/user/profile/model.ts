import type { User, UserAuthBindingStatus, UserProfileSourceContext } from '@/types'

export enum ProfileAuthProvider {
  EMAIL = 'email',
  LINUXDO = 'linuxdo',
  DINGTALK = 'dingtalk',
  OIDC = 'oidc',
  WECHAT = 'wechat',
  GITHUB = 'github',
  GOOGLE = 'google'
}

export enum IdentityVerificationMethod {
  EMAIL = 'email',
  PASSWORD = 'password'
}

export enum TotpSetupStep {
  VERIFY_IDENTITY = 'verify_identity',
  SCAN_SECRET = 'scan_secret',
  VERIFY_CODE = 'verify_code'
}

export interface ProviderCapability {
  provider: ProfileAuthProvider
  label: string
  enabled: boolean
}

export interface ProfileSourceHint {
  key: 'avatar' | 'username'
  provider: ProfileAuthProvider
  text: string
}

function normalizeBinding(binding: boolean | UserAuthBindingStatus | undefined): boolean | null {
  if (typeof binding === 'boolean') return binding
  if (!binding) return null
  if (typeof binding.bound === 'boolean') return binding.bound
  return Boolean(binding.provider_subject || binding.issuer || binding.provider_key)
}

export function profileBindingDetails(
  user: User | null | undefined,
  provider: ProfileAuthProvider
): UserAuthBindingStatus | null {
  const binding = user?.auth_bindings?.[provider] ?? user?.identity_bindings?.[provider]
  return binding && typeof binding !== 'boolean' ? binding : null
}

export function profileBindingStatus(
  user: User | null | undefined,
  provider: ProfileAuthProvider
): boolean {
  const direct = (user as unknown as Record<string, unknown> | null | undefined)?.[`${provider}_bound`]
  if (typeof direct === 'boolean') return direct
  const nested = user?.auth_bindings?.[provider] ?? user?.identity_bindings?.[provider]
  return normalizeBinding(nested) ?? false
}

export function displayableProfileEmail(user: User | null | undefined): string {
  const email = user?.email?.trim() || ''
  return email.endsWith('.invalid') && !profileBindingStatus(user, ProfileAuthProvider.EMAIL) ? '' : email
}

export function bindingSummary(details: UserAuthBindingStatus | null): string[] {
  if (!details) return []
  const values = [details.display_name, details.subject_hint]
    .map((value) => value?.trim() || '')
    .filter(Boolean)
  if (typeof details.bound_count === 'number' && details.bound_count > 1) {
    values.push(`已连接 ${details.bound_count} 个身份`)
  }
  if (details.note?.trim()) values.push(details.note.trim())
  return values
}

function normalizeSourceProvider(source: string | UserProfileSourceContext | null | undefined): ProfileAuthProvider | null {
  const raw = typeof source === 'string'
    ? source
    : source?.provider || source?.source || ''
  const normalized = String(raw).trim().toLowerCase().replace(/^oidc[:/].*$/, 'oidc')
  return Object.values(ProfileAuthProvider).includes(normalized as ProfileAuthProvider)
    ? normalized as ProfileAuthProvider
    : null
}

function explicitSourceLabel(source: string | UserProfileSourceContext | null | undefined): string {
  if (!source || typeof source === 'string') return ''
  return source.provider_label?.trim() || source.label?.trim() || ''
}

export function profileSourceHints(
  user: User | null | undefined,
  labels: Record<ProfileAuthProvider, string>
): ProfileSourceHint[] {
  if (!user) return []
  const inputs: Array<{ key: ProfileSourceHint['key']; source: string | UserProfileSourceContext | null | undefined }> = [
    { key: 'avatar', source: user.profile_sources?.avatar ?? user.avatar_source },
    {
      key: 'username',
      source: user.profile_sources?.username
        ?? user.profile_sources?.display_name
        ?? user.profile_sources?.nickname
        ?? user.username_source
        ?? user.display_name_source
        ?? user.nickname_source
    }
  ]
  return inputs.flatMap(({ key, source }) => {
    const provider = normalizeSourceProvider(source)
    if (!provider || provider === ProfileAuthProvider.EMAIL) return []
    const label = explicitSourceLabel(source) || labels[provider]
    return [{ key, provider, text: `${key === 'avatar' ? '头像' : '用户名'}来自 ${label}` }]
  })
}

export function providerCapabilities(input: {
  linuxdo: boolean
  dingtalk: boolean
  oidc: boolean
  oidcName: string
  wechat: boolean
}): ProviderCapability[] {
  return [
    { provider: ProfileAuthProvider.EMAIL, label: '邮箱与密码', enabled: true },
    { provider: ProfileAuthProvider.LINUXDO, label: 'LinuxDo', enabled: input.linuxdo },
    { provider: ProfileAuthProvider.DINGTALK, label: '钉钉', enabled: input.dingtalk },
    { provider: ProfileAuthProvider.OIDC, label: input.oidcName.trim() || 'OIDC', enabled: input.oidc },
    { provider: ProfileAuthProvider.WECHAT, label: '微信', enabled: input.wechat }
  ]
}

export function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function formatProfileDate(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

export type BindableProfileProvider =
  | ProfileAuthProvider.LINUXDO
  | ProfileAuthProvider.DINGTALK
  | ProfileAuthProvider.OIDC
  | ProfileAuthProvider.WECHAT
