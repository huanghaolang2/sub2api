import { describe, expect, it } from 'vitest'
import {
  SettingsSection,
  datetimeLocalToEpoch,
  isReadonlySetting,
  parseSettingDraft,
  serializeSetting,
  settingLabel,
  settingSectionForKey,
  splitLines,
  toDatetimeLocal,
  validateSettingsRecord,
} from '../model'

describe('admin governance model', () => {
  it.each([
    ['site_name', SettingsSection.GENERAL],
    ['login_agreement_enabled', SettingsSection.AGREEMENT],
    ['risk_control_enabled', SettingsSection.FEATURES],
    ['registration_enabled', SettingsSection.SECURITY],
    ['default_user_balance', SettingsSection.USERS],
    ['openai_advanced_scheduler_enabled', SettingsSection.GATEWAY],
    ['payment_enabled', SettingsSection.PAYMENT],
    ['smtp_host', SettingsSection.EMAIL],
    ['unknown_runtime_setting', SettingsSection.ADVANCED],
  ])('maps %s to its editable settings workspace', (key, expected) => {
    expect(settingSectionForKey(key)).toBe(expected)
  })

  it('keeps secret status and effective values read-only', () => {
    expect(isReadonlySetting('smtp_password_configured')).toBe(true)
    expect(isReadonlySetting('openai_advanced_scheduler_effective_lb_top_k')).toBe(true)
    expect(isReadonlySetting('smtp_host')).toBe(false)
  })

  it('round-trips scalar and structured setting drafts without changing their business type', () => {
    expect(parseSettingDraft('true', false)).toBe(true)
    expect(parseSettingDraft('false', true)).toBe(false)
    expect(parseSettingDraft('42.5', 1)).toBe(42.5)
    expect(parseSettingDraft('["a", "b"]', [])).toEqual(['a', 'b'])
    expect(parseSettingDraft('{"enabled":true}', {})).toEqual({ enabled: true })
    expect(parseSettingDraft('plain text', 'old')).toBe('plain text')
    expect(serializeSetting({ enabled: true })).toBe('{\n  "enabled": true\n}')
    expect(() => parseSettingDraft('not-a-number', 1)).toThrow('请输入有效数字')
  })

  it('normalizes multi-line values and preserves a local datetime round trip', () => {
    expect(splitLines('alpha, beta\nalpha\n gamma ')).toEqual(['alpha', 'beta', 'gamma'])
    const local = '2026-08-18T14:30'
    const epoch = datetimeLocalToEpoch(local)
    expect(epoch).toBeTypeOf('number')
    expect(toDatetimeLocal(new Date(epoch! * 1000).toISOString())).toBe(local)
  })

  it('uses a business label when one exists and a readable fallback otherwise', () => {
    expect(settingLabel('registration_enabled')).toBe('开放注册')
    expect(settingLabel('custom_runtime_window')).toBe('Custom Runtime Window')
  })

  it('restores the legacy settings dependency checks before a bulk save', () => {
    const issues = validateSettingsRecord({
      table_default_page_size: 2,
      table_page_size_options: [10, 10.5],
      login_agreement_enabled: true,
      login_agreement_documents: [
        { id: 'terms', title: '服务条款', content_md: '' },
        { id: 'terms', title: '重复条款', content_md: '' },
      ],
      default_subscriptions: [
        { group_id: 7, validity_days: 30 },
        { group_id: 7, validity_days: 90 },
      ],
      wechat_connect_mp_enabled: true,
      wechat_connect_mobile_enabled: true,
      forwarded_client_ip_headers: ['X-Forwarded-For', 'x-forwarded-for'],
      frontend_url: 'javascript:alert(1)',
      doc_url: 'https://docs.example.test',
    })

    expect(issues.map((issue) => issue.key)).toEqual(expect.arrayContaining([
      'table_default_page_size',
      'table_page_size_options',
      'login_agreement_documents',
      'default_subscriptions',
      'wechat_connect_mp_enabled',
      'wechat_connect_mobile_enabled',
      'forwarded_client_ip_headers',
      'frontend_url',
    ]))
    expect(issues.some((issue) => issue.key === 'doc_url')).toBe(false)
  })

  it('accepts a valid settings dependency snapshot', () => {
    expect(validateSettingsRecord({
      table_default_page_size: 20,
      table_page_size_options: [20, 50, 100],
      login_agreement_enabled: true,
      login_agreement_documents: [{ id: 'terms-of-service', title: '服务条款', content_md: '# 条款' }],
      auth_source_default_email_subscriptions: [{ group_id: 7, validity_days: 30 }],
      wechat_connect_mp_enabled: true,
      wechat_connect_mobile_enabled: false,
      forwarded_client_ip_headers: ['X-Forwarded-For', 'CF-Connecting-IP'],
      frontend_url: 'https://console.example.test',
      doc_url: '',
    })).toEqual([])
  })
})
