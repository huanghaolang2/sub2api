<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { paymentAPI, type PublicOrderVerifyResult } from '@shared-api/payment'
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  clearPaymentRecoverySnapshot,
  formatPaymentAmount,
  normalizePaymentCurrency,
  paymentMethodLabel,
  readPaymentRecoverySnapshot
} from '@/features/user/payment/model'
import { formatDateTime, orderStatusLabel, orderStatusTone } from '@/features/user/billing/model'
import type { PaymentOrder } from '@/types/payment'

type ResolvedOrder = PaymentOrder | PublicOrderVerifyResult

enum ResultState {
  LOADING = 'loading',
  SUCCESS = 'success',
  PENDING = 'pending',
  FAILED = 'failed',
  UNKNOWN = 'unknown'
}

interface LegacyReturnInfo { outTradeNo: string; money: string; type: string; tradeStatus: string }

const route = useRoute()
const order = ref<ResolvedOrder | null>(null)
const legacyInfo = ref<LegacyReturnInfo | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const error = ref('')
const currency = ref('CNY')
const attempts = ref(0)
let refreshTimer: number | null = null
let refreshOrder: (() => Promise<ResolvedOrder | null>) | null = null

const normalizedStatus = computed(() => String(order.value?.status || legacyInfo.value?.tradeStatus || '').trim().toUpperCase())
const state = computed(() => {
  if (loading.value) return ResultState.LOADING
  if (['COMPLETED', 'PAID', 'RECHARGING', 'TRADE_SUCCESS', 'SUCCESS'].includes(normalizedStatus.value)) return ResultState.SUCCESS
  if (['PENDING', 'CREATED', 'WAITING', 'PROCESSING'].includes(normalizedStatus.value)) return ResultState.PENDING
  if (normalizedStatus.value) return ResultState.FAILED
  return ResultState.UNKNOWN
})
const detailedOrder = computed((): PaymentOrder | null => order.value && 'id' in order.value ? order.value : null)
const title = computed(() => state.value === ResultState.SUCCESS ? '支付成功' : state.value === ResultState.PENDING ? '支付处理中' : state.value === ResultState.FAILED ? '支付未完成' : '暂未查到订单')
const description = computed(() => state.value === ResultState.SUCCESS
  ? '服务端已确认支付；余额或订阅权益会按订单结果发放。'
  : state.value === ResultState.PENDING
    ? '支付渠道仍在处理，页面会自动查询最新状态。'
    : state.value === ResultState.FAILED
      ? '订单已结束但未成功入账，可在订单页查看具体状态。'
      : '请检查回调链接，或登录后从我的订单继续查询。')

function query(key: string): string {
  const value = route.query[key]
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function isPending(status: string): boolean {
  return ['PENDING', 'CREATED', 'WAITING', 'PROCESSING'].includes(status.trim().toUpperCase())
}

function clearRecoveryIfTerminal(status: string): void {
  if (!status || isPending(status)) return
  clearPaymentRecoverySnapshot(localStorage)
}

function setOrder(value: ResolvedOrder | null): void {
  order.value = value
  if (value && 'currency' in value && value.currency) currency.value = normalizePaymentCurrency(value.currency)
  if (value) clearRecoveryIfTerminal(value.status)
}

async function byResumeToken(token: string): Promise<ResolvedOrder | null> {
  try { return (await paymentAPI.resolveOrderPublicByResumeToken(token)).data } catch { return null }
}

async function byOutTradeNo(outTradeNo: string): Promise<ResolvedOrder | null> {
  try { return (await paymentAPI.verifyOrder(outTradeNo)).data } catch {
    try { return (await paymentAPI.verifyOrderPublic(outTradeNo)).data } catch { return null }
  }
}

async function byOrderId(orderId: number): Promise<ResolvedOrder | null> {
  try { return (await paymentAPI.getOrder(orderId)).data } catch { return null }
}

function scheduleRefresh(): void {
  if (refreshTimer != null) window.clearTimeout(refreshTimer)
  if (!refreshOrder || state.value !== ResultState.PENDING || attempts.value >= 15) return
  refreshTimer = window.setTimeout(async () => {
    attempts.value += 1
    const value = await refreshOrder?.()
    if (value) setOrder(value)
    scheduleRefresh()
  }, 2000)
}

async function refreshNow(): Promise<void> {
  if (!refreshOrder || refreshing.value) return
  refreshing.value = true
  error.value = ''
  try {
    const value = await refreshOrder()
    if (value) setOrder(value)
    else error.value = '暂时无法获取最新订单状态。'
  } finally {
    refreshing.value = false
    scheduleRefresh()
  }
}

async function initialize(): Promise<void> {
  loading.value = true
  const resumeToken = query('resume_token')
  const routeOrderId = Number(query('order_id')) || 0
  let outTradeNo = query('out_trade_no')
  const snapshot = readPaymentRecoverySnapshot(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY), resumeToken ? { resumeToken } : {})
  const orderId = routeOrderId || snapshot?.orderId || 0
  if (!outTradeNo) outTradeNo = snapshot?.outTradeNo || ''
  if (snapshot?.currency) currency.value = normalizePaymentCurrency(snapshot.currency)

  let resolved: ResolvedOrder | null = null
  if (resumeToken) resolved = await byResumeToken(resumeToken)
  if (!resolved && orderId) resolved = await byOrderId(orderId)
  const hasLegacyContext = Boolean(query('trade_status'))
  if (!resolved && outTradeNo && (hasLegacyContext || orderId > 0 || resumeToken)) resolved = await byOutTradeNo(outTradeNo)
  if (resolved) setOrder(resolved)
  else if (outTradeNo && hasLegacyContext) {
    legacyInfo.value = { outTradeNo, money: query('money'), type: query('type'), tradeStatus: query('trade_status') }
    clearRecoveryIfTerminal(legacyInfo.value.tradeStatus)
  }

  refreshOrder = async () => {
    if (resumeToken) {
      const value = await byResumeToken(resumeToken)
      if (value) return value
    }
    if (orderId) {
      const value = await byOrderId(orderId)
      if (value) return value
    }
    return outTradeNo ? byOutTradeNo(outTradeNo) : null
  }
  loading.value = false
  scheduleRefresh()
}

onMounted(() => { void initialize() })
onBeforeUnmount(() => { if (refreshTimer != null) window.clearTimeout(refreshTimer) })
</script>

<template>
  <main class="payment-result-page">
    <section class="result-card" :data-state="state">
      <div v-if="loading" class="result-loading"><span /><strong>正在确认支付结果…</strong><small>正在从服务端恢复订单。</small></div>
      <template v-else>
        <header><div class="result-icon">{{ state === ResultState.SUCCESS ? '✓' : state === ResultState.PENDING ? '…' : state === ResultState.FAILED ? '×' : '?' }}</div><p>Payment Result</p><h1>{{ title }}</h1><span>{{ description }}</span></header>
        <p v-if="error" class="result-error" role="alert">{{ error }}</p>
        <dl v-if="detailedOrder" class="result-details"><div><dt>订单编号</dt><dd>#{{ detailedOrder.id }}</dd></div><div><dt>商户订单号</dt><dd><code>{{ detailedOrder.out_trade_no }}</code></dd></div><div><dt>订单状态</dt><dd><span class="status-chip" :data-tone="orderStatusTone(detailedOrder.status)">{{ orderStatusLabel(detailedOrder.status) }}</span></dd></div><div><dt>业务类型</dt><dd>{{ detailedOrder.order_type === 'subscription' ? '订阅套餐' : '余额充值' }}</dd></div><div><dt>基础金额</dt><dd>{{ formatPaymentAmount(detailedOrder.amount, detailedOrder.order_type === 'balance' ? 'USD' : currency) }}</dd></div><div><dt>手续费</dt><dd>{{ detailedOrder.fee_rate }}%</dd></div><div><dt>支付金额</dt><dd>{{ formatPaymentAmount(detailedOrder.pay_amount, currency) }}</dd></div><div><dt>支付方式</dt><dd>{{ paymentMethodLabel(detailedOrder.payment_type) }}</dd></div><div><dt>创建时间</dt><dd>{{ formatDateTime(detailedOrder.created_at) }}</dd></div><div><dt>过期时间</dt><dd>{{ formatDateTime(detailedOrder.expires_at) }}</dd></div></dl>
        <dl v-else-if="order" class="result-details"><div><dt>商户订单号</dt><dd><code>{{ order.out_trade_no }}</code></dd></div><div><dt>订单状态</dt><dd>{{ orderStatusLabel(order.status) }}</dd></div><div><dt>创建时间</dt><dd>{{ formatDateTime(order.created_at) }}</dd></div><div><dt>过期时间</dt><dd>{{ formatDateTime(order.expires_at) }}</dd></div></dl>
        <dl v-else-if="legacyInfo" class="result-details"><div><dt>商户订单号</dt><dd><code>{{ legacyInfo.outTradeNo }}</code></dd></div><div><dt>回调状态</dt><dd>{{ legacyInfo.tradeStatus }}</dd></div><div v-if="legacyInfo.money"><dt>支付金额</dt><dd>{{ formatPaymentAmount(Number(legacyInfo.money), currency) }}</dd></div><div v-if="legacyInfo.type"><dt>支付方式</dt><dd>{{ paymentMethodLabel(legacyInfo.type) }}</dd></div></dl>
        <div class="result-actions"><button v-if="state === ResultState.PENDING || state === ResultState.UNKNOWN" type="button" :disabled="refreshing" @click="refreshNow">{{ refreshing ? '查询中…' : '立即查询状态' }}</button><RouterLink to="/app/orders">查看我的订单</RouterLink><RouterLink to="/app/purchase">返回购买与充值</RouterLink></div>
        <small v-if="state === ResultState.PENDING" class="polling-note">自动查询 {{ attempts }} / 15</small>
      </template>
    </section>
  </main>
</template>

<style scoped>
.payment-result-page { min-height: 100vh; padding: 36px 20px; display: grid; place-items: center; color: var(--text-primary); background: var(--surface-canvas); }.result-card { width: min(660px, 100%); overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 20px; box-shadow: 0 30px 80px rgb(20 18 30 / 10%); }.result-card > header { padding: 40px 38px 28px; display: grid; justify-items: center; text-align: center; }.result-icon { width: 72px; height: 72px; margin-bottom: 18px; display: grid; place-items: center; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 50%; font-size: 31px; }.result-card[data-state="success"] .result-icon { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }.result-card[data-state="pending"] .result-icon { color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, transparent); }.result-card[data-state="failed"] .result-icon { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }.result-card header p { margin: 0; color: var(--accent); font-size: var(--font-meta); font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }.result-card h1 { margin: 8px 0; font-size: 30px; }.result-card header > span { max-width: 440px; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.65; }.result-error { margin: 0; padding: 10px 18px; color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); font-size: var(--font-meta); text-align: center; }.result-details { margin: 0 28px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--border-subtle); border: 1px solid var(--border-subtle); }.result-details div { min-width: 0; padding: 12px; display: grid; gap: 5px; background: var(--surface-raised); }.result-details dt { color: var(--text-secondary); font-size: var(--font-caption); }.result-details dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-size: var(--font-meta); font-weight: 700; }.result-details code { font-size: var(--font-caption); }.status-chip { width: fit-content; padding: 4px 7px; border-radius: 999px; font-size: var(--font-caption); }.status-chip[data-tone="success"] { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }.status-chip[data-tone="warning"] { color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); }.status-chip[data-tone="danger"] { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }.status-chip[data-tone="muted"] { color: var(--text-secondary); background: var(--surface-canvas); }.result-actions { padding: 24px 28px 10px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }.result-actions a, .result-actions button { min-height: 39px; display: grid; place-items: center; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); text-decoration: none; }.result-actions a:first-of-type { color: white; background: var(--accent); border-color: var(--accent); }.polling-note { padding: 0 28px 22px; display: block; color: var(--text-secondary); font-size: var(--font-caption); text-align: center; }.result-loading { min-height: 430px; display: grid; place-content: center; justify-items: center; gap: 8px; }.result-loading > span { width: 42px; height: 42px; border: 4px solid color-mix(in srgb, var(--accent) 18%, transparent); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }.result-loading strong { margin-top: 9px; font-size: 13px; }.result-loading small { color: var(--text-secondary); font-size: var(--font-meta); } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 580px) { .payment-result-page { padding: 0; align-items: stretch; }.result-card { min-height: 100vh; border: 0; border-radius: 0; box-shadow: none; }.result-card > header { padding-inline: 24px; }.result-details { grid-template-columns: 1fr; margin-inline: 18px; }.result-actions { grid-template-columns: 1fr; padding-inline: 18px; } }
</style>
