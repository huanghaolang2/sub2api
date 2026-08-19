<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { paymentAPI } from '@shared-api/payment'
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  formatPaymentAmount,
  normalizePaymentCurrency,
  readPaymentRecoverySnapshot
} from '@/features/user/payment/model'
import type { PaymentOrder } from '@/types/payment'
import type { Stripe, StripeElements } from '@stripe/stripe-js'

interface StripeWithWechatPay {
  confirmWechatPayPayment(clientSecret: string, options: Record<string, unknown>): Promise<{
    paymentIntent?: { status: string; next_action?: { wechat_pay_display_qr_code?: { image_data_url?: string } } }
    error?: { message?: string }
  }>
}

enum StripeScreen {
  LOADING = 'loading',
  ERROR = 'error',
  REDIRECTING = 'redirecting',
  WECHAT_QR = 'wechat_qr',
  ELEMENT = 'element',
  SUCCESS = 'success'
}

const route = useRoute()
const router = useRouter()
const screen = ref(StripeScreen.LOADING)
const error = ref('')
const submitting = ref(false)
const ready = ref(false)
const order = ref<PaymentOrder | null>(null)
const currency = ref('CNY')
const wechatQrUrl = ref('')
let stripe: Stripe | null = null
let elements: StripeElements | null = null
let pollTimer: number | null = null
let redirectTimer: number | null = null

const method = computed(() => String(route.query.method || ''))
const isPopup = computed(() => Boolean(method.value))

function query(key: string): string {
  const value = route.query[key]
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function fail(message: string): void {
  error.value = message
  screen.value = StripeScreen.ERROR
}

function resultUrl(orderId: number): string {
  return `${window.location.origin}/payment/result?order_id=${orderId}&status=success`
}

function scheduleSuccessNavigation(): void {
  screen.value = StripeScreen.SUCCESS
  redirectTimer = window.setTimeout(() => {
    if (window.opener) window.close()
    else void router.push({ path: '/payment/result', query: { order_id: query('order_id'), status: 'success' } })
  }, 1800)
}

async function confirmAlipay(clientSecret: string, orderId: number): Promise<void> {
  if (!stripe) return
  screen.value = StripeScreen.REDIRECTING
  const result = await stripe.confirmAlipayPayment(clientSecret, { return_url: resultUrl(orderId) })
  if (result.error) fail(result.error.message || '支付宝确认失败')
}

async function confirmWechat(clientSecret: string): Promise<void> {
  if (!stripe) return
  const result = await (stripe as unknown as StripeWithWechatPay).confirmWechatPayPayment(clientSecret, {
    payment_method_options: { wechat_pay: { client: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile_web' : 'web' } }
  })
  if (result.error) { fail(result.error.message || '微信支付确认失败'); return }
  const qr = result.paymentIntent?.next_action?.wechat_pay_display_qr_code?.image_data_url
  if (qr) {
    wechatQrUrl.value = qr
    screen.value = StripeScreen.WECHAT_QR
    startPolling()
  } else if (result.paymentIntent?.status === 'succeeded') {
    scheduleSuccessNavigation()
  } else {
    fail('Stripe 未返回可用的微信支付二维码。')
  }
}

function mountPaymentElement(clientSecret: string): void {
  if (!stripe) return
  const dark = document.documentElement.dataset.theme === 'dark' || document.documentElement.classList.contains('dark')
  elements = stripe.elements({
    clientSecret,
    appearance: { theme: dark ? 'night' : 'stripe', variables: { borderRadius: '10px' } }
  })
  const element = elements.create('payment', {
    layout: 'tabs',
    paymentMethodOrder: ['alipay', 'wechat_pay', 'card', 'link']
  } as Record<string, unknown>)
  element.mount('#stripe-payment-element')
  element.on('ready', () => { ready.value = true })
}

async function pay(): Promise<void> {
  if (!stripe || !elements || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: resultUrl(Number(query('order_id'))) },
      redirect: 'if_required'
    })
    if (result.error) error.value = result.error.message || '支付确认失败'
    else scheduleSuccessNavigation()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '支付确认失败'
  } finally {
    submitting.value = false
  }
}

function startPolling(): void {
  const orderId = Number(query('order_id'))
  if (!orderId || pollTimer != null) return
  let inFlight = false
  pollTimer = window.setInterval(async () => {
    if (inFlight) return
    inFlight = true
    try {
      const current = (await paymentAPI.getOrder(orderId)).data
      if (['COMPLETED', 'PAID', 'RECHARGING'].includes(current.status)) {
        if (pollTimer != null) { window.clearInterval(pollTimer); pollTimer = null }
        scheduleSuccessNavigation()
      }
    } catch {
      // Keep polling; transient errors are expected while the external provider redirects.
    } finally {
      inFlight = false
    }
  }, 3000)
}

async function initialize(): Promise<void> {
  const orderId = Number(query('order_id'))
  const clientSecret = query('client_secret')
  const resumeToken = query('resume_token')
  if (!orderId || !clientSecret) { fail('缺少 order_id 或 client_secret，无法恢复 Stripe 支付。'); return }
  try {
    const snapshot = readPaymentRecoverySnapshot(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY), resumeToken ? { resumeToken } : {})
    if (snapshot?.orderId === orderId && snapshot.currency) currency.value = normalizePaymentCurrency(snapshot.currency)
    const [orderResponse, configResponse] = await Promise.all([paymentAPI.getOrder(orderId), paymentAPI.getConfig()])
    order.value = orderResponse.data
    if (order.value.currency) currency.value = normalizePaymentCurrency(order.value.currency)
    const publishableKey = configResponse.data.stripe_publishable_key
    if (!publishableKey) { fail('Stripe 公钥未配置。'); return }
    const { loadStripe } = await import('@stripe/stripe-js/pure')
    stripe = await loadStripe(publishableKey)
    if (!stripe) { fail('Stripe SDK 加载失败。'); return }
    if (method.value === 'alipay') await confirmAlipay(clientSecret, orderId)
    else if (method.value === 'wechat_pay') await confirmWechat(clientSecret)
    else {
      screen.value = StripeScreen.ELEMENT
      await nextTick()
      mountPaymentElement(clientSecret)
    }
  } catch (caught) {
    fail(caught instanceof Error ? caught.message : 'Stripe 支付初始化失败。')
  }
}

onMounted(() => { void initialize() })
onUnmounted(() => {
  if (pollTimer != null) window.clearInterval(pollTimer)
  if (redirectTimer != null) window.clearTimeout(redirectTimer)
})
</script>

<template>
  <main class="stripe-page" :class="{ popup: isPopup }">
    <section class="stripe-card">
      <header><div><p>Secure checkout</p><h1>Stripe 支付</h1></div><div v-if="order"><span>应付金额</span><strong>{{ formatPaymentAmount(order.pay_amount, currency) }}</strong><small>订单 #{{ order.id }}</small></div></header>
      <div v-if="screen === StripeScreen.LOADING" class="stripe-state"><span class="spinner" /><strong>正在加载 Stripe 安全支付…</strong></div>
      <div v-else-if="screen === StripeScreen.ERROR" class="stripe-state is-error"><span>×</span><strong>支付页面加载失败</strong><p>{{ error }}</p><RouterLink to="/app/purchase">返回购买与充值</RouterLink></div>
      <div v-else-if="screen === StripeScreen.REDIRECTING" class="stripe-state"><span class="spinner" /><strong>正在跳转支付宝</strong><p>请在新页面完成付款，完成后会返回支付结果。</p></div>
      <div v-else-if="screen === StripeScreen.WECHAT_QR" class="stripe-state"><strong>使用微信扫码支付</strong><div class="wechat-qr"><img :src="wechatQrUrl" alt="微信支付二维码"><i>微</i></div><p>扫码后请保留此页，系统会自动确认支付结果。</p></div>
      <div v-else-if="screen === StripeScreen.SUCCESS" class="stripe-state is-success"><span>✓</span><strong>支付已确认</strong><p>正在返回支付结果页面…</p></div>
      <div v-else class="stripe-element-panel"><div id="stripe-payment-element" /><p v-if="error" role="alert">{{ error }}</p><button type="button" :disabled="submitting || !ready" @click="pay">{{ submitting ? '确认中…' : `确认支付 ${order ? formatPaymentAmount(order.pay_amount, currency) : ''}` }}</button><RouterLink to="/app/purchase">取消并返回</RouterLink></div>
      <footer><span>由 Stripe 加密处理支付信息</span><span>请勿刷新或关闭正在确认的页面</span></footer>
    </section>
  </main>
</template>

<style scoped>
.stripe-page { min-height: 100vh; padding: 34px 20px; display: grid; place-items: center; color: var(--text-primary); background: #f4f3fa; }.stripe-page.popup { padding: 18px; }.stripe-card { width: min(650px, 100%); overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 20px; box-shadow: 0 28px 75px rgb(42 35 100 / 13%); }.stripe-card > header { min-height: 102px; padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; color: white; background: #635bff; }.stripe-card header p { margin: 0 0 5px; opacity: .7; font-size: var(--font-caption); font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }.stripe-card h1 { margin: 0; font-size: 21px; }.stripe-card header > div:last-child { display: grid; justify-items: end; gap: 3px; }.stripe-card header span, .stripe-card header small { opacity: .72; font-size: var(--font-caption); }.stripe-card header strong { font-size: 24px; }.stripe-state { min-height: 390px; padding: 35px; display: grid; place-content: center; justify-items: center; gap: 10px; text-align: center; }.stripe-state > span:not(.spinner) { width: 65px; height: 65px; display: grid; place-items: center; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 50%; font-size: 29px; }.stripe-state strong { font-size: 15px; }.stripe-state p { max-width: 390px; margin: 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.6; }.stripe-state a { margin-top: 8px; color: #635bff; font-size: var(--font-meta); }.stripe-state.is-error > span { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }.stripe-state.is-success > span { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }.spinner { width: 43px; height: 43px; border: 4px solid rgb(99 91 255 / 18%); border-top-color: #635bff; border-radius: 50%; animation: spin 1s linear infinite; }.wechat-qr { position: relative; width: 260px; height: 260px; padding: 10px; display: grid; place-items: center; background: white; border: 2px solid #07c160; border-radius: 16px; }.wechat-qr img { width: 236px; height: 236px; }.wechat-qr i { position: absolute; width: 36px; height: 36px; display: grid; place-items: center; color: white; background: #07c160; border: 4px solid white; border-radius: 50%; font-size: var(--font-meta); font-style: normal; font-weight: 800; }.stripe-element-panel { padding: 26px; }.stripe-element-panel #stripe-payment-element { min-height: 205px; }.stripe-element-panel > p { color: var(--danger); font-size: var(--font-meta); }.stripe-element-panel button { width: 100%; min-height: 46px; margin-top: 20px; color: white; background: #635bff; border: 0; border-radius: 9px; cursor: pointer; font-size: var(--font-meta); font-weight: 720; }.stripe-element-panel button:disabled { opacity: .45; cursor: not-allowed; }.stripe-element-panel > a { margin-top: 13px; display: block; color: var(--text-secondary); font-size: var(--font-meta); text-align: center; }.stripe-card > footer { padding: 12px 20px; display: flex; justify-content: space-between; gap: 12px; color: var(--text-secondary); background: var(--surface-canvas); border-top: 1px solid var(--border-subtle); font-size: var(--font-caption); } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 520px) { .stripe-page { padding: 0; align-items: stretch; }.stripe-card { min-height: 100vh; border: 0; border-radius: 0; box-shadow: none; }.stripe-card > header { align-items: flex-start; flex-direction: column; }.stripe-card header > div:last-child { justify-items: start; }.stripe-card > footer { flex-direction: column; } }
</style>
