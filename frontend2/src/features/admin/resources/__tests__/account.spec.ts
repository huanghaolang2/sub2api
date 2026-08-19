import { describe, expect, it } from 'vitest'
import type { Account } from '@/types'
import { accountDraftToRequest, accountToDraft, buildOAuthCredentialPayload, emptyAccountDraft } from '../account'

describe('admin upstream account request model', () => {
  it('keeps credentials, bindings, scheduling, runtime, and quota fields', () => {
    const draft = emptyAccountDraft()
    Object.assign(draft, {
      name: 'Codex 主账号',
      platform: 'openai',
      type: 'apikey',
      credentials_json: '{"api_key":"sk-test","model_mapping":{"gpt-5":"gpt-5.5"}}',
      extra_json: '{"existing_flag":"keep"}',
      proxy_id: 4,
      group_ids: [8, 9],
      concurrency: 12,
      load_factor: 0.8,
      priority: 2,
      rate_multiplier: 0.9,
      window_cost_limit: 30,
      max_sessions: 6,
      base_rpm: 120,
      rpm_strategy: 'tiered',
      enable_tls_fingerprint: true,
      tls_fingerprint_profile_id: 3,
      custom_base_url_enabled: true,
      custom_base_url: 'https://upstream.example.test',
      quota_daily_limit: 50,
      quota_daily_reset_mode: 'fixed',
      quota_daily_reset_hour: 4,
      quota_reset_timezone: 'Asia/Shanghai',
      upstream_billing_probe_enabled: true
    })

    const request = accountDraftToRequest(draft, false)

    expect(request).toMatchObject({
      name: 'Codex 主账号',
      platform: 'openai',
      type: 'apikey',
      credentials: { api_key: 'sk-test', model_mapping: { 'gpt-5': 'gpt-5.5' } },
      proxy_id: 4,
      group_ids: [8, 9],
      concurrency: 12,
      load_factor: 0.8,
      priority: 2,
      rate_multiplier: 0.9,
      upstream_billing_probe_enabled: true,
      extra: {
        existing_flag: 'keep',
        window_cost_limit: 30,
        max_sessions: 6,
        base_rpm: 120,
        rpm_strategy: 'tiered',
        enable_tls_fingerprint: true,
        tls_fingerprint_profile_id: 3,
        custom_base_url_enabled: true,
        custom_base_url: 'https://upstream.example.test',
        quota_daily_limit: 50,
        quota_daily_reset_mode: 'fixed',
        quota_daily_reset_hour: 4,
        quota_reset_timezone: 'Asia/Shanghai'
      }
    })
  })

  it('does not replace credentials during edit when the credential field is blank', () => {
    const draft = emptyAccountDraft()
    draft.name = '保留凭据'
    draft.credentials_json = ''

    expect(accountDraftToRequest(draft, true)).not.toHaveProperty('credentials')
  })

  it('prefills editable non-sensitive credentials and rejects exact/wildcard model conflicts', () => {
    const account = {
      id: 9,
      name: '保留平台配置',
      platform: 'openai',
      type: 'oauth',
      status: 'active',
      schedulable: true,
      credentials: { email: 'codex@example.test', model_mapping: { 'gpt-*': 'gpt-5.5' }, header_overrides: { 'x-fixture': 'kept' } },
      extra: { openai_passthrough: true },
      proxy_id: null,
      group_ids: [],
      groups: [],
      concurrency: 1,
      priority: 0,
      rate_multiplier: 1,
      notes: '',
      expires_at: null,
      auto_pause_on_expired: false
    } as unknown as Account

    const draft = accountToDraft(account)
    expect(JSON.parse(draft.credentials_json)).toMatchObject({ email: 'codex@example.test', model_mapping: { 'gpt-*': 'gpt-5.5' }, header_overrides: { 'x-fixture': 'kept' } })
    expect(JSON.parse(draft.extra_json)).toMatchObject({ openai_passthrough: true })

    draft.credentials_json = JSON.stringify({ model_mapping: { 'gpt-*': 'gpt-5.5', 'gpt-5': 'gpt-5.6-sol' } })
    expect(() => accountDraftToRequest(draft, true)).toThrow('精确/通配冲突')
  })

  it('normalizes OAuth token responses without persisting one-shot secrets', () => {
    const openai = buildOAuthCredentialPayload('openai', { access_token: 'access', refresh_token: 'refresh', email: 'oauth@example.test', name: 'OAuth User', sso_token: 'must-not-copy' })
    expect(openai).toEqual({ credentials: { access_token: 'access', refresh_token: 'refresh', email: 'oauth@example.test' }, extra: { email: 'oauth@example.test', name: 'OAuth User' } })

    const grok = buildOAuthCredentialPayload('grok', { access_token: 'access', refresh_token: '', email: 'grok@example.test', password: 'must-not-copy' }, { refreshTokenFallback: 'fallback-refresh' })
    expect(grok.credentials).toMatchObject({ access_token: 'access', refresh_token: 'fallback-refresh', email: 'grok@example.test' })
    expect(grok.credentials).not.toHaveProperty('password')
  })
})
