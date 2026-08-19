import { describe, expect, it } from 'vitest'
import type { User } from '@/types'
import {
  ProfileAuthProvider,
  bindingSummary,
  displayableProfileEmail,
  profileBindingDetails,
  profileBindingStatus,
  profileSourceHints,
  providerCapabilities,
  validateEmail
} from '../model'

const user = {
  id: 2, username: 'Nova', email: 'placeholder.invalid', role: 'user', balance: 10, concurrency: 2,
  status: 'active', allowed_groups: null, balance_notify_enabled: false, balance_notify_threshold: null,
  balance_notify_extra_emails: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  email_bound: false,
  auth_bindings: {
    linuxdo: { bound: true, display_name: 'nova-linux', subject_hint: 'ID 42', bound_count: 2, can_unbind: true }
  },
  profile_sources: { avatar: { provider: 'linuxdo', provider_label: 'LinuxDo' }, username: 'oidc:corp' }
} as User

describe('profile model', () => {
  it('normalizes direct and nested identity bindings without exposing placeholder email', () => {
    expect(profileBindingStatus(user, ProfileAuthProvider.EMAIL)).toBe(false)
    expect(profileBindingStatus(user, ProfileAuthProvider.LINUXDO)).toBe(true)
    expect(displayableProfileEmail(user)).toBe('')
    expect(profileBindingDetails(user, ProfileAuthProvider.LINUXDO)?.can_unbind).toBe(true)
    expect(bindingSummary(profileBindingDetails(user, ProfileAuthProvider.LINUXDO))).toEqual([
      'nova-linux', 'ID 42', '已连接 2 个身份'
    ])
  })

  it('reports profile field sources and configured provider availability', () => {
    const labels = {
      [ProfileAuthProvider.EMAIL]: '邮箱', [ProfileAuthProvider.LINUXDO]: 'LinuxDo',
      [ProfileAuthProvider.DINGTALK]: '钉钉', [ProfileAuthProvider.OIDC]: '企业统一身份',
      [ProfileAuthProvider.WECHAT]: '微信', [ProfileAuthProvider.GITHUB]: 'GitHub', [ProfileAuthProvider.GOOGLE]: 'Google'
    }
    expect(profileSourceHints(user, labels).map((item) => item.text)).toEqual([
      '头像来自 LinuxDo', '用户名来自 企业统一身份'
    ])
    const enabledLabels = providerCapabilities({
      linuxdo: true, dingtalk: false, oidc: true, oidcName: '企业 SSO', wechat: true
    }).filter((item) => item.enabled).map((item) => item.label)
    expect(enabledLabels).toEqual(['邮箱与密码', 'LinuxDo', '企业 SSO', '微信'])
    expect(validateEmail('nova@example.test')).toBe(true)
    expect(validateEmail('broken')).toBe(false)
  })
})
