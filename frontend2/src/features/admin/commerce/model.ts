import type { PaymentOrder } from '@/types/payment'

export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  SUSPENDED = 'suspended'
}

export enum PaymentOrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  RECHARGING = 'RECHARGING',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  REFUNDING = 'REFUNDING',
  REFUND_PENDING = 'REFUND_PENDING',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
  REFUND_FAILED = 'REFUND_FAILED'
}

export enum PaymentMethod {
  ALIPAY = 'alipay',
  WXPAY = 'wxpay',
  ALIPAY_DIRECT = 'alipay_direct',
  WXPAY_DIRECT = 'wxpay_direct',
  STRIPE = 'stripe',
  EASYPAY = 'easypay',
  AIRWALLEX = 'airwallex'
}

export enum PaymentOrderType {
  BALANCE = 'balance',
  SUBSCRIPTION = 'subscription'
}

export enum PaymentSetupTab {
  CONFIG = 'config',
  CHANNELS = 'channels',
  PROVIDERS = 'providers',
  PLANS = 'plans'
}

export enum PaymentLoadBalanceStrategy {
  ROUND_ROBIN = 'round-robin',
  LEAST_AMOUNT = 'least-amount'
}

export enum PlanValidityUnit {
  DAYS = 'days',
  WEEKS = 'weeks',
  MONTHS = 'months'
}

export function normalizePlanValidityUnit(value: string | null | undefined): PlanValidityUnit {
  const normalized = String(value || PlanValidityUnit.DAYS).trim().toLowerCase().replace(/s$/, '')
  if (normalized === 'month') return PlanValidityUnit.MONTHS
  if (normalized === 'week') return PlanValidityUnit.WEEKS
  return PlanValidityUnit.DAYS
}

export enum PaymentRangeDays {
  WEEK = 7,
  MONTH = 30,
  QUARTER = 90
}

export enum RedeemCodeTypeOption {
  BALANCE = 'balance',
  CONCURRENCY = 'concurrency',
  SUBSCRIPTION = 'subscription',
  INVITATION = 'invitation'
}

export enum RedeemCodeStatus {
  ACTIVE = 'active',
  UNUSED = 'unused',
  USED = 'used',
  EXPIRED = 'expired',
  DISABLED = 'disabled'
}

export enum PromoCodeStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled'
}

export enum AffiliateRecordKind {
  INVITES = 'invites',
  REBATES = 'rebates',
  TRANSFERS = 'transfers'
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc'
}

export const subscriptionStatusLabels: Record<SubscriptionStatus, string> = {
  [SubscriptionStatus.ACTIVE]: '生效中',
  [SubscriptionStatus.EXPIRED]: '已过期',
  [SubscriptionStatus.REVOKED]: '已撤销',
  [SubscriptionStatus.SUSPENDED]: '已暂停'
}

export const paymentStatusLabels: Record<PaymentOrderStatus, string> = {
  [PaymentOrderStatus.PENDING]: '待支付',
  [PaymentOrderStatus.PAID]: '已支付',
  [PaymentOrderStatus.RECHARGING]: '充值中',
  [PaymentOrderStatus.COMPLETED]: '已完成',
  [PaymentOrderStatus.EXPIRED]: '已过期',
  [PaymentOrderStatus.CANCELLED]: '已取消',
  [PaymentOrderStatus.FAILED]: '失败',
  [PaymentOrderStatus.REFUND_REQUESTED]: '退款待审核',
  [PaymentOrderStatus.REFUNDING]: '退款中',
  [PaymentOrderStatus.REFUND_PENDING]: '退款待确认',
  [PaymentOrderStatus.PARTIALLY_REFUNDED]: '部分退款',
  [PaymentOrderStatus.REFUNDED]: '已退款',
  [PaymentOrderStatus.REFUND_FAILED]: '退款失败'
}

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  [PaymentMethod.ALIPAY]: '支付宝',
  [PaymentMethod.WXPAY]: '微信支付',
  [PaymentMethod.ALIPAY_DIRECT]: '支付宝直连',
  [PaymentMethod.WXPAY_DIRECT]: '微信直连',
  [PaymentMethod.STRIPE]: 'Stripe',
  [PaymentMethod.EASYPAY]: '易支付',
  [PaymentMethod.AIRWALLEX]: 'Airwallex'
}

export const configurablePaymentMethods: PaymentMethod[] = [
  PaymentMethod.EASYPAY,
  PaymentMethod.ALIPAY,
  PaymentMethod.WXPAY,
  PaymentMethod.STRIPE,
  PaymentMethod.AIRWALLEX
]

export const redeemTypeLabels: Record<RedeemCodeTypeOption, string> = {
  [RedeemCodeTypeOption.BALANCE]: '余额',
  [RedeemCodeTypeOption.CONCURRENCY]: '并发额度',
  [RedeemCodeTypeOption.SUBSCRIPTION]: '订阅',
  [RedeemCodeTypeOption.INVITATION]: '邀请码'
}

export const redeemStatusLabels: Record<RedeemCodeStatus, string> = {
  [RedeemCodeStatus.ACTIVE]: '可用',
  [RedeemCodeStatus.UNUSED]: '未使用',
  [RedeemCodeStatus.USED]: '已使用',
  [RedeemCodeStatus.EXPIRED]: '已过期',
  [RedeemCodeStatus.DISABLED]: '已停用'
}

export function formatCommerceDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

export function formatCurrency(amount: number | null | undefined, currency = 'USD'): string {
  const value = Number(amount || 0)
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function paymentStatusClass(status: string): string {
  if ([PaymentOrderStatus.COMPLETED, PaymentOrderStatus.PAID, PaymentOrderStatus.REFUNDED].includes(status as PaymentOrderStatus)) return 'resource-status--active'
  if ([PaymentOrderStatus.FAILED, PaymentOrderStatus.REFUND_FAILED, PaymentOrderStatus.EXPIRED, PaymentOrderStatus.CANCELLED].includes(status as PaymentOrderStatus)) return 'resource-status--error'
  if ([PaymentOrderStatus.RECHARGING, PaymentOrderStatus.REFUNDING, PaymentOrderStatus.REFUND_PENDING, PaymentOrderStatus.REFUND_REQUESTED, PaymentOrderStatus.PARTIALLY_REFUNDED].includes(status as PaymentOrderStatus)) return 'resource-status--degraded'
  return ''
}

export function refundableAmount(order: PaymentOrder): number {
  const alreadyRefunded = [PaymentOrderStatus.PARTIALLY_REFUNDED, PaymentOrderStatus.REFUNDED].includes(order.status as PaymentOrderStatus)
    ? Number(order.refund_amount || 0)
    : 0
  return Math.max(0, Number((Number(order.amount || 0) - alreadyRefunded).toFixed(2)))
}

export function canRefundOrder(status: string): boolean {
  return [
    PaymentOrderStatus.COMPLETED,
    PaymentOrderStatus.PARTIALLY_REFUNDED,
    PaymentOrderStatus.REFUND_REQUESTED,
    PaymentOrderStatus.REFUND_FAILED
  ].includes(status as PaymentOrderStatus)
}

export function splitNumericIds(value: string): number[] {
  const invalid = value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean).find((item) => !/^\d+$/.test(item) || Number(item) <= 0)
  if (invalid) throw new Error(`用户 ID “${invalid}” 无效`)
  return [...new Set(value.split(/[\s,，;；]+/).map(Number).filter((item) => Number.isInteger(item) && item > 0))]
}

export function parseLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))]
}

export function safeJsonObject(value: string, field: string): Record<string, string> {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not object')
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
  } catch {
    throw new Error(`${field}必须是 JSON 对象`)
  }
}

export function nextSort(currentBy: string, currentOrder: SortOrder, by: string): { by: string; order: SortOrder } {
  return currentBy === by
    ? { by, order: currentOrder === SortOrder.ASC ? SortOrder.DESC : SortOrder.ASC }
    : { by, order: SortOrder.ASC }
}
