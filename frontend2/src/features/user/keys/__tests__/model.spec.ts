import { describe, expect, it } from 'vitest'
import type { ApiKey } from '@/types'
import {
  buildKeyUpdate,
  createEmptyKeyDraft,
  draftFromKey,
  expirationDateForDays,
  expiresInDays,
  parseIpLines,
  validateCustomKey
} from '../model'

function keyFixture(): ApiKey {
  return {
    id: 9,
    user_id: 2,
    key: 'sk-test-1234567890abcdefghijklmnop',
    name: '生产服务',
    group_id: 11,
    status: 'active',
    ip_whitelist: ['203.0.113.10'],
    ip_blacklist: ['198.51.100.20'],
    last_used_at: null,
    last_used_ip: null,
    quota: 100,
    quota_used: 12,
    expires_at: '2026-09-01T00:00:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    current_concurrency: 1,
    rate_limit_5h: 5,
    rate_limit_1d: 12,
    rate_limit_7d: 50,
    usage_5h: 1,
    usage_1d: 2,
    usage_7d: 3,
    window_5h_start: null,
    window_1d_start: null,
    window_7d_start: null,
    reset_5h_at: null,
    reset_1d_at: null,
    reset_7d_at: null
  }
}

describe('API Key view model', () => {
  it('normalizes IP lists without duplicates and validates custom keys', () => {
    expect(parseIpLines('203.0.113.1, 203.0.113.1\n10.0.0.0/8')).toEqual(['203.0.113.1', '10.0.0.0/8'])
    expect(validateCustomKey('short')).toContain('16')
    expect(validateCustomKey('valid_key-1234567890')).toBe('')
    expect(validateCustomKey('invalid key 123456')).toContain('只能包含')
  })

  it('round-trips every editable legacy field into the shared update contract', () => {
    const key = keyFixture()
    const draft = draftFromKey(key)
    draft.name = '  新名称  '
    draft.groupId = 12
    draft.ipWhitelist = '203.0.113.8\n203.0.113.9'
    draft.ipBlacklist = ''
    draft.quota = 250
    draft.rateLimit5h = 10
    draft.rateLimit1d = 20
    draft.rateLimit7d = 80
    draft.status = 'inactive'

    expect(buildKeyUpdate(draft, key)).toEqual({
      name: '新名称',
      group_id: 12,
      ip_whitelist: ['203.0.113.8', '203.0.113.9'],
      ip_blacklist: [],
      quota: 250,
      expires_at: '2026-09-01T00:00:00.000Z',
      rate_limit_5h: 10,
      rate_limit_1d: 20,
      rate_limit_7d: 80,
      status: 'inactive'
    })
  })

  it('clears disabled limits and calculates create-mode expiry days deterministically', () => {
    const key = keyFixture()
    const draft = createEmptyKeyDraft()
    draft.name = '无限 Key'
    draft.groupId = 11
    expect(buildKeyUpdate(draft, key)).toEqual(expect.objectContaining({
      quota: 0,
      expires_at: '',
      rate_limit_5h: 0,
      rate_limit_1d: 0,
      rate_limit_7d: 0,
      ip_whitelist: [],
      ip_blacklist: []
    }))

    const now = new Date('2026-08-18T00:00:00.000Z')
    const date = expirationDateForDays(30, now)
    expect(expiresInDays(date, now)).toBe(30)
  })
})
