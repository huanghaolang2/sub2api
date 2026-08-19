import { describe, expect, it } from 'vitest'
import type { PaymentOrder } from '@/types/payment'
import {
  PaymentOrderStatus,
  PlanValidityUnit,
  SortOrder,
  canRefundOrder,
  nextSort,
  normalizePlanValidityUnit,
  parseLines,
  refundableAmount,
  safeJsonObject,
  splitNumericIds
} from '../model'

function order(status: PaymentOrderStatus, amount: number, refundAmount = 0): PaymentOrder {
  return {
    id: 1,
    user_id: 2,
    amount,
    pay_amount: amount,
    fee_rate: 0,
    payment_type: 'stripe',
    out_trade_no: 'fixture-order',
    status,
    order_type: 'balance',
    created_at: '2026-08-18T00:00:00Z',
    expires_at: '2026-08-18T00:30:00Z',
    refund_amount: refundAmount
  }
}

describe('admin commerce model', () => {
  it('normalizes legacy singular and current plural plan validity units', () => {
    expect(normalizePlanValidityUnit('day')).toBe(PlanValidityUnit.DAYS)
    expect(normalizePlanValidityUnit('weeks')).toBe(PlanValidityUnit.WEEKS)
    expect(normalizePlanValidityUnit('month')).toBe(PlanValidityUnit.MONTHS)
    expect(normalizePlanValidityUnit(undefined)).toBe(PlanValidityUnit.DAYS)
  })

  it('calculates remaining refundable amount only for already-refunded states', () => {
    expect(refundableAmount(order(PaymentOrderStatus.COMPLETED, 49, 9))).toBe(49)
    expect(refundableAmount(order(PaymentOrderStatus.PARTIALLY_REFUNDED, 49, 9))).toBe(40)
    expect(refundableAmount(order(PaymentOrderStatus.REFUNDED, 49, 60))).toBe(0)
    expect(canRefundOrder(PaymentOrderStatus.REFUND_REQUESTED)).toBe(true)
    expect(canRefundOrder(PaymentOrderStatus.PENDING)).toBe(false)
  })

  it('parses bulk identifiers and line lists without duplicates', () => {
    expect(splitNumericIds('1, 2；2\n3')).toEqual([1, 2, 3])
    expect(() => splitNumericIds('1, no')).toThrow('用户 ID')
    expect(parseLines('stripe\nalipay\nstripe\n')).toEqual(['stripe', 'alipay'])
  })

  it('validates provider JSON objects and toggles server sort order', () => {
    expect(safeJsonObject('{"mode":"sandbox","attempts":2}', 'Provider 配置')).toEqual({ mode: 'sandbox', attempts: '2' })
    expect(() => safeJsonObject('[]', 'Provider 配置')).toThrow('Provider 配置必须是 JSON 对象')
    expect(nextSort('created_at', SortOrder.DESC, 'created_at')).toEqual({ by: 'created_at', order: SortOrder.ASC })
    expect(nextSort('created_at', SortOrder.DESC, 'status')).toEqual({ by: 'status', order: SortOrder.ASC })
  })
})
