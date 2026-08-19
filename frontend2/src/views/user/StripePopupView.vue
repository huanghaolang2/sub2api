<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { paymentAPI } from '@shared-api/payment'
import { formatPaymentAmount, isMobileDevice } from '@/features/user/payment/model'

interface StripePopupInitMessage {
  type: 'STRIPE_POPUP_INIT'
  clientSecret: string
  publishableKey: string
}

interface StripeWithWechatPay {
  confirmWechatPayPayment(clientSecret: string, options: Record<string, unknown>): Promise<{
    error?: { message?: string }
    paymentIntent?: { status: string }
  }>
}

enum PopupState {
  WAITING = 'waiting',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  ERROR = 'error'
}

const route = useRoute()
const state = ref(PopupState.WAITING)
const error = ref('')
const hint = ref('等待主窗口发送加密支付信息…')
const orderId = computed(() => Number(route.query.order_id) || 0)
const method = computed(() => String(route.query.method || 'alipay'))
const amount = computed(() => Number(route.query.amount) || 0)
let initTimer: number | null = null
let pollTimer: number | null = null
let closeTimer: number | null = null
let messageHandler: ((event: MessageEvent) => void) | null = null

function sendResult(status: 'success' | 'error', message?: string): void {
  window.opener?.postMessage({
    type: 'STRIPE_POPUP_RESULT',
    status,
    order_id: orderId.value,
    message: message || ''
  }, window.location.origin)
}

function closeWindow(): void {
  window.close()
}

function succeed(): void {
  state.value = PopupState.SUCCESS
  sendResult('success')
  closeTimer = window.setTimeout(() => window.close(), 1800)
}

function fail(message: string): void {
  error.value = message
  state.value = PopupState.ERROR
  sendResult('error', message)
}

function startPolling(): void {
  if (!orderId.value || pollTimer != null) return
  let inFlight = false
  pollTimer = window.setInterval(async () => {
    if (inFlight) return
    inFlight = true
    try {
      const order = (await paymentAPI.getOrder(orderId.value)).data
      if (['COMPLETED', 'PAID', 'RECHARGING'].includes(order.status)) {
        if (pollTimer != null) { window.clearInterval(pollTimer); pollTimer = null }
        succeed()
      } else if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(order.status)) {
        if (pollTimer != null) { window.clearInterval(pollTimer); pollTimer = null }
        fail(`订单状态：${order.status}`)
      }
    } catch {
      // Retain the popup and retry on transient auth or network failures.
    } finally {
      inFlight = false
    }
  }, 3000)
}

async function initializeStripe(payload: StripePopupInitMessage): Promise<void> {
  if (!payload.clientSecret || !payload.publishableKey || !orderId.value) {
    fail('支付参数不完整。')
    return
  }
  state.value = PopupState.PROCESSING
  try {
    const { loadStripe } = await import('@stripe/stripe-js/pure')
    const stripe = await loadStripe(payload.publishableKey)
    if (!stripe) { fail('Stripe SDK 加载失败。'); return }
    const returnUrl = `${window.location.origin}/payment/result?order_id=${orderId.value}&status=success`
    if (method.value === 'alipay') {
      hint.value = '正在跳转支付宝…'
      const result = await stripe.confirmAlipayPayment(payload.clientSecret, { return_url: returnUrl })
      if (result.error) fail(result.error.message || '支付宝支付失败。')
    } else if (method.value === 'wechat_pay') {
      hint.value = '正在生成微信支付二维码…'
      const result = await (stripe as unknown as StripeWithWechatPay).confirmWechatPayPayment(payload.clientSecret, {
        payment_method_options: { wechat_pay: { client: isMobileDevice() ? 'mobile_web' : 'web' } }
      })
      if (result.error) fail(result.error.message || '微信支付失败。')
      else if (result.paymentIntent?.status === 'succeeded') succeed()
      else { hint.value = '等待扫码支付结果…'; startPolling() }
    } else {
      fail(`不支持的弹窗支付方式：${method.value}`)
    }
  } catch (caught) {
    fail(caught instanceof Error ? caught.message : 'Stripe 支付初始化失败。')
  }
}

onMounted(() => {
  messageHandler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    const data = event.data as Partial<StripePopupInitMessage>
    if (data.type !== 'STRIPE_POPUP_INIT') return
    if (initTimer != null) { window.clearTimeout(initTimer); initTimer = null }
    if (messageHandler) window.removeEventListener('message', messageHandler)
    messageHandler = null
    void initializeStripe(data as StripePopupInitMessage)
  }
  window.addEventListener('message', messageHandler)
  window.opener?.postMessage({ type: 'STRIPE_POPUP_READY', order_id: orderId.value }, window.location.origin)
  initTimer = window.setTimeout(() => {
    if (state.value === PopupState.WAITING) fail('等待主窗口初始化超时。')
  }, 15_000)
})

onUnmounted(() => {
  if (initTimer != null) window.clearTimeout(initTimer)
  if (pollTimer != null) window.clearInterval(pollTimer)
  if (closeTimer != null) window.clearTimeout(closeTimer)
  if (messageHandler) window.removeEventListener('message', messageHandler)
})
</script>

<template>
  <main class="popup-page" :data-method="method">
    <section>
      <header><span>{{ method === 'wechat_pay' ? '微信支付' : '支付宝' }}</span><strong v-if="amount">{{ formatPaymentAmount(amount, 'CNY') }}</strong><small>订单 #{{ orderId || '—' }}</small></header>
      <div v-if="state === PopupState.ERROR" class="popup-state is-error"><i>×</i><strong>支付未完成</strong><p>{{ error }}</p><button type="button" @click="closeWindow">关闭窗口</button></div>
      <div v-else-if="state === PopupState.SUCCESS" class="popup-state is-success"><i>✓</i><strong>支付成功</strong><p>结果已通知主窗口，本窗口即将关闭。</p><button type="button" @click="closeWindow">立即关闭</button></div>
      <div v-else class="popup-state"><i class="spinner" /><strong>{{ state === PopupState.WAITING ? '正在建立安全连接' : '支付处理中' }}</strong><p>{{ hint }}</p></div>
      <footer>请保留主窗口以接收支付结果</footer>
    </section>
  </main>
</template>

<style scoped>
.popup-page { min-height: 100vh; padding: 18px; display: grid; place-items: center; color: var(--text-primary); background: #f6f8fb; }.popup-page > section { width: min(430px, 100%); overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 18px; box-shadow: 0 25px 65px rgb(20 40 70 / 13%); }.popup-page header { padding: 21px; display: grid; justify-items: center; gap: 5px; color: white; background: #1677ff; }.popup-page[data-method="wechat_pay"] header { background: #07a94f; }.popup-page header span { opacity: .75; font-size: var(--font-meta); }.popup-page header strong { font-size: 27px; }.popup-page header small { opacity: .72; font-size: var(--font-caption); }.popup-state { min-height: 270px; padding: 30px; display: grid; place-content: center; justify-items: center; gap: 9px; text-align: center; }.popup-state > i:not(.spinner) { width: 62px; height: 62px; display: grid; place-items: center; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 50%; font-size: 28px; font-style: normal; }.popup-state.is-error > i { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }.popup-state.is-success > i { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }.popup-state strong { font-size: 14px; }.popup-state p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.6; }.popup-state button { min-width: 140px; min-height: 36px; margin-top: 7px; color: white; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.spinner { width: 42px; height: 42px; border: 4px solid rgb(22 119 255 / 18%); border-top-color: #1677ff; border-radius: 50%; animation: spin 1s linear infinite; }.popup-page[data-method="wechat_pay"] .spinner { border-color: rgb(7 169 79 / 18%); border-top-color: #07a94f; }.popup-page footer { padding: 11px; color: var(--text-secondary); background: var(--surface-canvas); border-top: 1px solid var(--border-subtle); font-size: var(--font-caption); text-align: center; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 460px) { .popup-page { padding: 0; align-items: stretch; }.popup-page > section { min-height: 100vh; border: 0; border-radius: 0; box-shadow: none; } }
</style>
