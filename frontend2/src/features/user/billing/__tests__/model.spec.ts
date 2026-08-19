import { describe, expect, it } from 'vitest'
import type { PaymentOrder } from '@/types/payment'
import type { UserSubscription } from '@/types'
import {
  UserOrderStatus,
  canCancelOrder,
  canRequestOrderRefund,
  orderStatusLabel,
  subscriptionQuotaWindows
} from '../model'

function subscription(): UserSubscription {
  return {
    id: 1, user_id: 2, group_id: 10, status: 'active', starts_at: '2026-08-18T00:00:00Z',
    expires_at: '2026-08-18T20:00:00Z', daily_usage_usd: 0, weekly_usage_usd: 7.5,
    monthly_usage_usd: 0, daily_window_start: '2026-08-18T00:00:00Z',
    weekly_window_start: '2026-08-17T00:00:00Z', monthly_window_start: null,
    created_at: '2026-08-18T00:00:00Z', updated_at: '2026-08-18T00:00:00Z',
    group: { daily_limit_usd: 0, weekly_limit_usd: 10, monthly_limit_usd: null } as UserSubscription['group']
  }
}

describe('user billing model', () => {
  it('preserves disabled, limited, and unconfigured subscription quota semantics', () => {
    const windows = subscriptionQuotaWindows(subscription())
    expect(windows).toHaveLength(2)
    expect(windows[0]).toMatchObject({ key: 'daily', disabled: true, percentage: 100 })
    expect(windows[0]?.resetsAt?.toISOString()).toBe('2026-08-18T20:00:00.000Z')
    expect(windows[1]).toMatchObject({ key: 'weekly', used: 7.5, limit: 10, percentage: 75 })
  })

  it('maps every user-visible order state and restricts cancel/refund actions', () => {
    expect(orderStatusLabel(UserOrderStatus.REFUND_PENDING)).toBe('退款待处理')
    const pending = { status: 'PENDING' } as PaymentOrder
    const completed = { status: 'COMPLETED', provider_instance_id: 'stripe-main' } as PaymentOrder
    expect(canCancelOrder(pending)).toBe(true)
    expect(canCancelOrder(completed)).toBe(false)
    expect(canRequestOrderRefund(completed, new Set(['stripe-main']))).toBe(true)
    expect(canRequestOrderRefund(completed, new Set())).toBe(false)
  })
})
