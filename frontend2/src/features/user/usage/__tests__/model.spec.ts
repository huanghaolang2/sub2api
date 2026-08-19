import { describe, expect, it } from 'vitest'
import type { UsageLog } from '@/types'
import {
  BillingModeFilter,
  BillingTypeFilter,
  buildUsageCsv,
  buildUsageQuery,
  escapeCsvValue,
  UsageRequestFilter,
  UsageSortOrder,
  usageCsvHeaders,
  usageCsvRow
} from '../model'

function logFixture(): UsageLog {
  return {
    id: 1,
    user_id: 2,
    api_key_id: 7,
    account_id: null,
    request_id: '=dangerous-request-id',
    model: 'gpt-5.5',
    service_tier: 'priority',
    reasoning_effort: 'high',
    inbound_endpoint: '/v1/responses',
    upstream_endpoint: null,
    group_id: 11,
    subscription_id: null,
    input_tokens: 1200,
    output_tokens: 300,
    cache_creation_tokens: 80,
    cache_read_tokens: 400,
    cache_creation_5m_tokens: 50,
    cache_creation_1h_tokens: 30,
    input_cost: 0.01,
    output_cost: 0.02,
    cache_creation_cost: 0.003,
    cache_read_cost: 0.002,
    total_cost: 0.035,
    actual_cost: 0.028,
    rate_multiplier: 0.8,
    long_context_billing_applied: true,
    billing_type: 0,
    request_type: 'stream',
    stream: true,
    duration_ms: 1800,
    first_token_ms: 240,
    image_count: 0,
    image_size: null,
    image_input_size: null,
    image_output_size: null,
    image_size_source: null,
    image_size_breakdown: null,
    image_input_tokens: 0,
    image_input_cost: 0,
    image_output_tokens: 0,
    image_output_cost: 0,
    user_agent: 'Codex/1.0',
    ip_address: '203.0.113.1',
    cache_ttl_overridden: true,
    billing_mode: 'token',
    created_at: '2026-08-18T00:00:00Z',
    api_key: { name: '生产 Key' } as UsageLog['api_key'],
    group: { name: '企业组' } as UsageLog['group']
  }
}

describe('user usage view model', () => {
  it('builds the complete shared server query and legacy stream compatibility flag', () => {
    expect(buildUsageQuery({
      startDate: '2026-08-01',
      endDate: '2026-08-18',
      apiKeyId: '7',
      model: ' gpt-5.5 ',
      groupId: '11',
      requestType: UsageRequestFilter.STREAM,
      billingType: BillingTypeFilter.SUBSCRIPTION,
      billingMode: BillingModeFilter.TOKEN
    }, 3, 50, 'created_at', UsageSortOrder.DESC, 'Asia/Shanghai')).toEqual({
      page: 3,
      page_size: 50,
      start_date: '2026-08-01',
      end_date: '2026-08-18',
      api_key_id: 7,
      model: 'gpt-5.5',
      group_id: 11,
      request_type: 'stream',
      stream: true,
      billing_type: 1,
      billing_mode: 'token',
      timezone: 'Asia/Shanghai',
      sort_by: 'created_at',
      sort_order: 'desc'
    })
  })

  it('exports every legacy billing field with a stable header-to-value contract', () => {
    const row = usageCsvRow(logFixture())
    expect(row).toHaveLength(usageCsvHeaders.length)
    const csv = buildUsageCsv([logFixture()])
    expect(csv).toContain('Cache Write 1h')
    expect(csv).toContain('Image Output Cost')
    expect(csv).toContain("'=dangerous-request-id")
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('protects spreadsheet formulas before applying CSV quoting', () => {
    expect(escapeCsvValue('=SUM(1,2)')).toBe('"\'=SUM(1,2)"')
    expect(escapeCsvValue('@cmd')).toBe("'@cmd")
    expect(escapeCsvValue('plain')).toBe('plain')
  })
})
