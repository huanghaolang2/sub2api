import { describe, expect, it } from 'vitest'
import type { AdminUser, UserAttributeDefinition } from '@/types'
import type { BatchUserUsageStats } from '@shared-api/admin/dashboard'
import {
  formatAttributeValue,
  normalizeQuotaLimit,
  parseNonNegativeInteger,
  PlatformQuotaPlatform,
  SortOrder,
  sortUsersByUsage,
  UsagePeriod
} from '../model'

function user(id: number): AdminUser {
  return { id } as AdminUser
}

describe('admin user view model', () => {
  it('validates integer limits without accepting empty, fractional, or negative values', () => {
    expect(parseNonNegativeInteger(0)).toBe(0)
    expect(parseNonNegativeInteger('12')).toBe(12)
    expect(parseNonNegativeInteger('')).toBeNull()
    expect(parseNonNegativeInteger('1.5')).toBeNull()
    expect(parseNonNegativeInteger(-1)).toBeNull()
  })

  it('normalizes platform quota limits and rejects non-finite or negative values', () => {
    expect(normalizeQuotaLimit(0)).toBe(0)
    expect(normalizeQuotaLimit(12.5)).toBe(12.5)
    expect(normalizeQuotaLimit(null)).toBeNull()
    expect(normalizeQuotaLimit(Number.NaN)).toBeNull()
    expect(normalizeQuotaLimit(-1)).toBeNull()
  })

  it('formats select and multi-select attributes with their configured labels', () => {
    const definition = {
      type: 'multi_select',
      options: [{ value: 'pro', label: '专业版' }, { value: 'team', label: '团队版' }]
    } as UserAttributeDefinition
    expect(formatAttributeValue('["pro","team"]', definition)).toBe('专业版, 团队版')
    expect(formatAttributeValue('not-json', definition)).toBe('not-json')
  })

  it('sorts the current page by platform usage and keeps equal values stable', () => {
    const stats: Record<string, BatchUserUsageStats> = {
      '1': { user_id: 1, today_actual_cost: 3, total_actual_cost: 8, by_platform: [{ platform: 'openai', today_actual_cost: 1, total_actual_cost: 6 }] },
      '2': { user_id: 2, today_actual_cost: 2, total_actual_cost: 9, by_platform: [{ platform: 'openai', today_actual_cost: 4, total_actual_cost: 5 }] },
      '3': { user_id: 3, today_actual_cost: 2, total_actual_cost: 9, by_platform: [{ platform: 'openai', today_actual_cost: 4, total_actual_cost: 5 }] }
    }
    expect(sortUsersByUsage(
      [user(1), user(2), user(3)],
      stats,
      PlatformQuotaPlatform.OPENAI,
      UsagePeriod.TODAY,
      SortOrder.DESC
    ).map((entry) => entry.id)).toEqual([2, 3, 1])
  })
})
