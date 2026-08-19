import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildPublicKeyUsageQuery,
  getPublicKeyUsage,
} from '../keyUsage'
import {
  KeyUsageHistoryDays,
  KeyUsageRange,
  OAuthPendingAction,
  emailIsValid,
  normalizePendingOAuthAction,
  passwordValidationMessage,
  sanitizeRedirectPath,
} from '../model'

describe('public authentication and usage contracts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps only local redirect paths', () => {
    expect(sanitizeRedirectPath('/app/usage?range=7d')).toBe('/app/usage?range=7d')
    expect(sanitizeRedirectPath('//evil.example')).toBe('/app/dashboard')
    expect(sanitizeRedirectPath('https://evil.example')).toBe('/app/dashboard')
    expect(sanitizeRedirectPath('/safe\nLocation: evil')).toBe('/app/dashboard')
  })

  it('normalizes every pending OAuth account decision', () => {
    expect(normalizePendingOAuthAction('choose_account_action_required')).toBe(OAuthPendingAction.CHOOSE_ACCOUNT)
    expect(normalizePendingOAuthAction('email_required')).toBe(OAuthPendingAction.CREATE_ACCOUNT)
    expect(normalizePendingOAuthAction('existing_account_binding_required')).toBe(OAuthPendingAction.BIND_LOGIN)
    expect(normalizePendingOAuthAction('unknown')).toBe(OAuthPendingAction.NONE)
  })

  it('validates account credentials without hiding the specific correction', () => {
    expect(emailIsValid('person@example.test')).toBe(true)
    expect(emailIsValid('invalid')).toBe(false)
    expect(passwordValidationMessage('123')).toContain('至少')
    expect(passwordValidationMessage('123456', '654321')).toContain('不一致')
    expect(passwordValidationMessage('123456', '123456')).toBe('')
  })

  it('builds local calendar usage ranges and keeps daily detail depth separate', () => {
    const params = buildPublicKeyUsageQuery({
      range: KeyUsageRange.SEVEN_DAYS,
      days: KeyUsageHistoryDays.NINETY,
      timezone: 'Asia/Shanghai',
    }, new Date(2026, 6, 13, 0, 30))
    expect(params.get('start_date')).toBe('2026-07-06')
    expect(params.get('end_date')).toBe('2026-07-13')
    expect(params.get('days')).toBe('90')
    expect(params.get('timezone')).toBe('Asia/Shanghai')
  })

  it('queries the gateway with the API key only in the authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: 'quota_limited' }) })
    vi.stubGlobal('fetch', fetchMock)
    await getPublicKeyUsage('sk-private', {
      range: KeyUsageRange.THIRTY_DAYS,
      days: KeyUsageHistoryDays.THIRTY,
      timezone: 'UTC',
    })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/usage?'), expect.objectContaining({
      headers: { Authorization: 'Bearer sk-private' },
    }))
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('sk-private')
  })

  it('surfaces the gateway error message for an invalid key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API key' } }),
    }))
    await expect(getPublicKeyUsage('invalid', {
      range: KeyUsageRange.TODAY,
      days: KeyUsageHistoryDays.SEVEN,
    })).rejects.toThrow('Invalid API key')
  })
})
