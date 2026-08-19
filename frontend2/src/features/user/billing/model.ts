import type { PaymentOrder } from '@/types/payment'
import type { UserSubscription } from '@/types'

export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  SUSPENDED = 'suspended'
}

export enum QuotaWindow {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly'
}

export enum UserOrderStatus {
  ALL = '',
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

export interface SubscriptionQuotaWindow {
  key: QuotaWindow
  label: string
  used: number
  limit: number
  percentage: number
  disabled: boolean
  resetsAt: Date | null
}

const quotaMeta: Record<QuotaWindow, { label: string; hours: number }> = {
  [QuotaWindow.DAILY]: { label: '每日额度', hours: 24 },
  [QuotaWindow.WEEKLY]: { label: '每周额度', hours: 24 * 7 },
  [QuotaWindow.MONTHLY]: { label: '每月额度', hours: 24 * 30 }
}

const subscriptionStatusLabels: Record<string, string> = {
  [SubscriptionStatus.ACTIVE]: '生效中',
  [SubscriptionStatus.EXPIRED]: '已到期',
  [SubscriptionStatus.REVOKED]: '已撤销',
  [SubscriptionStatus.SUSPENDED]: '已暂停'
}

const orderStatusLabels: Record<string, string> = {
  [UserOrderStatus.PENDING]: '待支付',
  [UserOrderStatus.PAID]: '已支付',
  [UserOrderStatus.RECHARGING]: '入账中',
  [UserOrderStatus.COMPLETED]: '已完成',
  [UserOrderStatus.EXPIRED]: '已过期',
  [UserOrderStatus.CANCELLED]: '已取消',
  [UserOrderStatus.FAILED]: '失败',
  [UserOrderStatus.REFUND_REQUESTED]: '已申请退款',
  [UserOrderStatus.REFUNDING]: '退款中',
  [UserOrderStatus.REFUND_PENDING]: '退款待处理',
  [UserOrderStatus.PARTIALLY_REFUNDED]: '部分退款',
  [UserOrderStatus.REFUNDED]: '已退款',
  [UserOrderStatus.REFUND_FAILED]: '退款失败'
}

const platformLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
  composite: '复合路由'
}

export function subscriptionStatusLabel(status: string): string {
  return subscriptionStatusLabels[status] || status
}

export function subscriptionStatusTone(status: string): string {
  if (status === SubscriptionStatus.ACTIVE) return 'success'
  if (status === SubscriptionStatus.SUSPENDED) return 'warning'
  if (status === SubscriptionStatus.REVOKED) return 'danger'
  return 'muted'
}

export function orderStatusLabel(status: string): string {
  return orderStatusLabels[status] || status
}

export function orderStatusTone(status: string): string {
  if ([UserOrderStatus.COMPLETED, UserOrderStatus.PAID].includes(status as UserOrderStatus)) return 'success'
  if ([UserOrderStatus.PENDING, UserOrderStatus.RECHARGING, UserOrderStatus.REFUND_REQUESTED, UserOrderStatus.REFUNDING, UserOrderStatus.REFUND_PENDING].includes(status as UserOrderStatus)) return 'warning'
  if ([UserOrderStatus.FAILED, UserOrderStatus.REFUND_FAILED].includes(status as UserOrderStatus)) return 'danger'
  return 'muted'
}

export function platformLabel(platform: string): string {
  return platformLabels[platform] || platform || '未指定平台'
}

export function formatMoney(value: number, currency: string = 'USD', digits: number = 2): string {
  const safe = Number.isFinite(value) ? value : 0
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency', currency: currency || 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits
    }).format(safe)
  } catch {
    return `${currency || 'USD'} ${safe.toFixed(digits)}`
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

function windowResetAt(subscription: UserSubscription, window: QuotaWindow): Date | null {
  if (window === QuotaWindow.DAILY && subscription.starts_at && subscription.expires_at) {
    const startsAt = new Date(subscription.starts_at).getTime()
    const expiresAt = new Date(subscription.expires_at).getTime()
    if (Number.isFinite(startsAt) && Number.isFinite(expiresAt) && expiresAt <= startsAt + 24 * 60 * 60 * 1000) {
      return new Date(expiresAt)
    }
  }
  const startValue = subscription[`${window}_window_start`]
  if (!startValue) return null
  const start = new Date(startValue)
  if (Number.isNaN(start.getTime())) return null
  return new Date(start.getTime() + quotaMeta[window].hours * 60 * 60 * 1000)
}

export function subscriptionQuotaWindows(subscription: UserSubscription): SubscriptionQuotaWindow[] {
  const group = subscription.group
  if (!group) return []
  return Object.values(QuotaWindow).flatMap((window) => {
    const limit = group[`${window}_limit_usd`]
    if (limit == null) return []
    const used = Number(subscription[`${window}_usage_usd`] || 0)
    return [{
      key: window,
      label: quotaMeta[window].label,
      used,
      limit,
      percentage: limit > 0 ? Math.min(100, Math.max(0, used / limit * 100)) : 100,
      disabled: limit === 0,
      resetsAt: windowResetAt(subscription, window)
    }]
  })
}

export function quotaTone(window: SubscriptionQuotaWindow): string {
  if (window.disabled || window.percentage >= 90) return 'danger'
  if (window.percentage >= 70) return 'warning'
  return 'success'
}

export function expirationSummary(expiresAt: string | null): string {
  if (!expiresAt) return '长期有效'
  const expires = new Date(expiresAt)
  if (Number.isNaN(expires.getTime())) return expiresAt
  const remainingMs = expires.getTime() - Date.now()
  if (remainingMs <= 0) return `已于 ${formatDateTime(expiresAt)} 到期`
  const days = Math.ceil(remainingMs / 86_400_000)
  if (days <= 1) return `不足 1 天 · ${formatDateTime(expiresAt)}`
  return `剩余 ${days} 天 · ${formatDateTime(expiresAt)}`
}

export function canCancelOrder(order: PaymentOrder): boolean {
  return order.status === UserOrderStatus.PENDING
}

export function canRequestOrderRefund(order: PaymentOrder, eligibleProviderIds: Set<string>): boolean {
  return order.status === UserOrderStatus.COMPLETED && Boolean(order.provider_instance_id) && eligibleProviderIds.has(String(order.provider_instance_id))
}
