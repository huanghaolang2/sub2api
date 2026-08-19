<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { paymentAPI } from '@shared-api/payment'
import {
  VisiblePaymentMethod,
  formatPaymentAmount,
  getPaymentPopupFeatures,
  normalizePaymentCurrency,
  normalizeVisibleMethod
} from '@/features/user/payment/model'
import {
  AlipayDeepLinkState,
  createAlipayDeepLinkLauncher,
  type AlipayDeepLinkLauncher
} from '@/features/user/payment/alipay-deep-link'
import type { PaymentOrder } from '@/types/payment'

enum PaymentOutcome {
  SUCCESS = 'success',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired'
}

interface RequestError { response?: { data?: { detail?: string } }; message?: string }

const props = withDefaults(defineProps<{
  orderId: number
  amount?: number
  payAmount?: number
  qrCode: string
  expiresAt: string
  paymentType: string
  payUrl?: string
  orderType?: string
  currency?: string
  outTradeNo?: string
  mobileAlipayDeepLink?: boolean
}>(), {
  amount: 0,
  payAmount: 0,
  payUrl: '',
  orderType: 'balance',
  currency: 'CNY',
  outTradeNo: '',
  mobileAlipayDeepLink: false
})

const emit = defineEmits<{
  done: []
  success: []
  settled: [outcome: PaymentOutcome]
}>()

const outcome = ref<PaymentOutcome | null>(null)
const paidOrder = ref<PaymentOrder | null>(null)
const remainingSeconds = ref(0)
const qrDataUrl = ref('')
const cancelling = ref(false)
const cancelConfirm = ref(false)
const error = ref('')
const deepLinkState = ref(AlipayDeepLinkState.IDLE)
const deepLinkFallbackVisible = ref(false)
let pollTimer: number | null = null
let countdownTimer: number | null = null
let pollInFlight = false
let verifyAttempts = 0
let lastVerifyAt = 0
let alipayLauncher: AlipayDeepLinkLauncher | null = null

const normalizedMethod = computed(() => normalizeVisibleMethod(props.paymentType) || props.paymentType)
const isAlipay = computed(() => normalizedMethod.value === VisiblePaymentMethod.ALIPAY)
const isWechat = computed(() => normalizedMethod.value === VisiblePaymentMethod.WXPAY)
const isMobileAlipay = computed(() => props.mobileAlipayDeepLink && isAlipay.value && Boolean(props.qrCode))
const showQr = computed(() => Boolean(props.qrCode) && (!isMobileAlipay.value || deepLinkFallbackVisible.value))
const countdown = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60).toString().padStart(2, '0')
  const seconds = (remainingSeconds.value % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
})
const scanTitle = computed(() => isAlipay.value ? '请使用支付宝扫码' : isWechat.value ? '请使用微信扫码' : '扫码完成支付')
const amountDisplay = computed(() => formatPaymentAmount(props.payAmount || props.amount, normalizePaymentCurrency(props.currency)))

function requestError(caught: unknown, fallback: string): string {
  const value = caught as RequestError
  return value.response?.data?.detail || value.message || fallback
}

async function renderQr(): Promise<void> {
  if (!showQr.value || !props.qrCode) { qrDataUrl.value = ''; return }
  try {
    qrDataUrl.value = await QRCode.toDataURL(props.qrCode, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
  } catch (caught) {
    error.value = requestError(caught, '二维码生成失败，请使用支付链接。')
  }
}

function setOutcome(next: PaymentOutcome): void {
  if (outcome.value) return
  outcome.value = next
  cleanup()
  emit('settled', next)
  if (next === PaymentOutcome.SUCCESS) emit('success')
}

async function verifyPending(order: PaymentOrder): Promise<PaymentOrder> {
  if ((!isWechat.value && !isMobileAlipay.value) || order.status !== 'PENDING' || !order.out_trade_no) return order
  const now = Date.now()
  if (verifyAttempts >= 6 || now - lastVerifyAt < 15_000) return order
  verifyAttempts += 1
  lastVerifyAt = now
  try {
    return (await paymentAPI.verifyOrder(order.out_trade_no)).data || order
  } catch {
    return order
  }
}

async function pollStatus(): Promise<void> {
  if (!props.orderId || outcome.value || pollInFlight) return
  pollInFlight = true
  try {
    let order = (await paymentAPI.getOrder(props.orderId)).data
    if (outcome.value) return
    order = await verifyPending(order)
    if (['COMPLETED', 'PAID', 'RECHARGING'].includes(order.status)) {
      paidOrder.value = order
      setOutcome(PaymentOutcome.SUCCESS)
    } else if (order.status === 'CANCELLED') {
      setOutcome(PaymentOutcome.CANCELLED)
    } else if (order.status === 'EXPIRED' || order.status === 'FAILED') {
      setOutcome(PaymentOutcome.EXPIRED)
    }
  } catch (caught) {
    error.value = requestError(caught, '支付状态查询失败，系统将继续重试。')
  } finally {
    pollInFlight = false
  }
}

function startTimers(): void {
  const expires = Date.parse(props.expiresAt)
  remainingSeconds.value = Number.isFinite(expires) ? Math.max(0, Math.floor((expires - Date.now()) / 1000)) : 1800
  if (remainingSeconds.value <= 0) { setOutcome(PaymentOutcome.EXPIRED); return }
  countdownTimer = window.setInterval(() => {
    remainingSeconds.value -= 1
    if (remainingSeconds.value <= 0) setOutcome(PaymentOutcome.EXPIRED)
  }, 1000)
  pollTimer = window.setInterval(() => { void pollStatus() }, 3000)
}

function openPayWindow(): void {
  if (!props.payUrl) return
  const opened = window.open(props.payUrl, 'paymentPopup', getPaymentPopupFeatures())
  if (!opened || opened.closed) window.location.assign(props.payUrl)
}

async function cancelOrder(): Promise<void> {
  if (!cancelConfirm.value) { cancelConfirm.value = true; return }
  if (cancelling.value) return
  cancelling.value = true
  error.value = ''
  try {
    await paymentAPI.cancelOrder(props.orderId)
    setOutcome(PaymentOutcome.CANCELLED)
  } catch (caught) {
    error.value = requestError(caught, '订单取消失败')
  } finally {
    cancelling.value = false
    cancelConfirm.value = false
  }
}

function saveQr(): void {
  if (!qrDataUrl.value) return
  const link = document.createElement('a')
  link.href = qrDataUrl.value
  link.download = `payment-${props.outTradeNo || props.orderId}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function updateDeepLinkState(state: AlipayDeepLinkState): void {
  deepLinkState.value = state
  deepLinkFallbackVisible.value = state === AlipayDeepLinkState.FALLBACK
  if (deepLinkFallbackVisible.value) void renderQr()
}

function initializeDeepLink(): void {
  if (!isMobileAlipay.value) return
  alipayLauncher = createAlipayDeepLinkLauncher({
    qrCode: props.qrCode,
    document,
    lifecycleTarget: window,
    userAgent: navigator.userAgent,
    assignLocation: (url) => window.location.assign(url),
    onStateChange: updateDeepLinkState
  })
  alipayLauncher.launch()
}

function cleanup(): void {
  if (pollTimer != null) { window.clearInterval(pollTimer); pollTimer = null }
  if (countdownTimer != null) { window.clearInterval(countdownTimer); countdownTimer = null }
  alipayLauncher?.dispose()
  alipayLauncher = null
}

function done(): void {
  cleanup()
  emit('done')
}

watch(showQr, () => { void renderQr() })
onMounted(() => {
  void renderQr()
  startTimers()
  initializeDeepLink()
})
onUnmounted(cleanup)
</script>

<template>
  <section class="payment-status" :data-method="normalizedMethod">
    <template v-if="outcome === PaymentOutcome.SUCCESS">
      <div class="terminal-state is-success"><span>✓</span><h2>{{ orderType === 'subscription' ? '订阅购买成功' : '支付成功' }}</h2><p>服务端已确认支付并完成后续处理。</p><dl v-if="paidOrder"><div><dt>订单</dt><dd>#{{ paidOrder.id }}</dd></div><div><dt>支付金额</dt><dd>{{ formatPaymentAmount(paidOrder.pay_amount, paidOrder.currency) }}</dd></div><div><dt>到账金额</dt><dd>{{ formatPaymentAmount(paidOrder.amount, 'USD') }}</dd></div></dl><button class="button button--primary" type="button" @click="done">完成</button></div>
    </template>
    <template v-else-if="outcome === PaymentOutcome.CANCELLED">
      <div class="terminal-state"><span>×</span><h2>订单已取消</h2><p>这笔待支付订单已关闭，可以重新选择金额或套餐。</p><button class="button button--primary" type="button" @click="done">返回购买</button></div>
    </template>
    <template v-else-if="outcome === PaymentOutcome.EXPIRED">
      <div class="terminal-state is-warning"><span>!</span><h2>订单已过期或支付失败</h2><p>当前支付入口已经失效，请重新创建订单。</p><button class="button button--primary" type="button" @click="done">重新选择</button></div>
    </template>
    <template v-else>
      <header><div><p>支付进行中</p><h2>{{ showQr ? scanTitle : isMobileAlipay ? '正在打开支付宝' : '请在支付窗口完成付款' }}</h2></div><div><span>剩余时间</span><strong>{{ countdown }}</strong></div></header>
      <p v-if="error" class="payment-error" role="alert">{{ error }}</p>
      <div class="payment-workspace">
        <div class="payment-primary">
          <template v-if="isMobileAlipay && !deepLinkFallbackVisible">
            <div class="handoff-state"><div class="spinner" /><strong>{{ deepLinkState === AlipayDeepLinkState.BACKGROUNDED ? '请在支付宝中继续' : '正在唤起支付宝…' }}</strong><span>返回本页后会继续查询支付结果。</span><button type="button" @click="alipayLauncher?.launch()">重新打开支付宝</button></div>
          </template>
          <template v-else-if="showQr">
            <div class="qr-frame" :data-method="normalizedMethod"><img v-if="qrDataUrl" :src="qrDataUrl" alt="支付二维码"><div class="qr-mark">{{ isAlipay ? '支' : isWechat ? '微' : '付' }}</div></div>
            <p>{{ isAlipay ? '打开支付宝“扫一扫”完成付款。' : isWechat ? '打开微信“扫一扫”完成付款。' : '使用对应支付应用扫码。' }}</p>
            <div class="qr-actions"><button v-if="isMobileAlipay" type="button" @click="alipayLauncher?.launch()">重新打开支付宝</button><button type="button" @click="saveQr">保存二维码</button><button v-if="payUrl" type="button" @click="openPayWindow">打开支付页面</button></div>
          </template>
          <template v-else>
            <div class="handoff-state"><div class="spinner" /><strong>等待支付结果</strong><span>支付窗口没有打开时，可点击下方按钮重试。</span><button v-if="payUrl" type="button" @click="openPayWindow">重新打开支付窗口</button></div>
          </template>
        </div>
        <aside><dl><div><dt>应付金额</dt><dd>{{ amountDisplay }}</dd></div><div><dt>订单号</dt><dd><code>{{ outTradeNo || `#${orderId}` }}</code></dd></div><div><dt>支付方式</dt><dd>{{ isAlipay ? '支付宝' : isWechat ? '微信支付' : paymentType }}</dd></div><div><dt>业务类型</dt><dd>{{ orderType === 'subscription' ? '订阅套餐' : '余额充值' }}</dd></div></dl><p>付款完成后无需手动刷新；页面每 3 秒查询一次服务端状态。</p><button v-if="!cancelConfirm" class="cancel-button" type="button" :disabled="cancelling" @click="cancelOrder">取消订单</button><div v-else class="cancel-confirm"><span>取消后不可恢复。</span><button type="button" @click="cancelConfirm = false">返回</button><button type="button" :disabled="cancelling" @click="cancelOrder">{{ cancelling ? '取消中…' : '确认取消' }}</button></div></aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.payment-status { width: min(980px, 100%); margin: 0 auto; overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 17px; }.payment-status > header { min-height: 86px; padding: 17px 21px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--border-subtle); }.payment-status header p { margin: 0 0 5px; color: var(--accent); font-size: var(--font-meta); font-weight: 740; letter-spacing: .08em; text-transform: uppercase; }.payment-status header h2 { margin: 0; font-size: 19px; }.payment-status header > div:last-child { display: grid; justify-items: end; gap: 4px; }.payment-status header span { color: var(--text-secondary); font-size: var(--font-meta); }.payment-status header strong { font-size: 21px; font-variant-numeric: tabular-nums; }.payment-error { margin: 0; padding: 10px 18px; color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--danger) 20%, transparent); font-size: var(--font-meta); }
.payment-workspace { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, .65fr); }.payment-primary { min-height: 490px; padding: 30px; display: grid; place-content: center; justify-items: center; gap: 16px; border-right: 1px solid var(--border-subtle); text-align: center; }.payment-primary > p { max-width: 430px; margin: 0; color: var(--text-secondary); font-size: var(--font-meta); }.qr-frame { position: relative; width: 276px; height: 276px; padding: 17px; display: grid; place-items: center; background: white; border: 2px solid var(--border-subtle); border-radius: 18px; }.qr-frame[data-method="alipay"] { border-color: #1677ff; }.qr-frame[data-method="wxpay"] { border-color: #07c160; }.qr-frame img { width: 240px; height: 240px; }.qr-mark { position: absolute; width: 37px; height: 37px; display: grid; place-items: center; color: white; background: var(--accent); border: 5px solid white; border-radius: 50%; font-size: var(--font-body-sm); font-weight: 800; }.qr-frame[data-method="alipay"] .qr-mark { background: #1677ff; }.qr-frame[data-method="wxpay"] .qr-mark { background: #07c160; }.qr-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 7px; }.qr-actions button, .handoff-state button { min-height: 35px; padding: 0 10px; color: var(--accent); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.handoff-state { display: grid; justify-items: center; gap: 10px; }.handoff-state strong { font-size: 16px; }.handoff-state span { color: var(--text-secondary); font-size: var(--font-meta); }.spinner { width: 43px; height: 43px; border: 4px solid color-mix(in srgb, var(--accent) 18%, transparent); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
.payment-workspace aside { padding: 23px 20px; display: flex; flex-direction: column; }.payment-workspace aside dl { margin: 0; display: grid; gap: 14px; }.payment-workspace aside dl div { display: grid; gap: 4px; }.payment-workspace aside dt { color: var(--text-secondary); font-size: var(--font-caption); }.payment-workspace aside dd { margin: 0; overflow-wrap: anywhere; font-size: var(--font-body-sm); font-weight: 700; }.payment-workspace aside code { font-size: var(--font-meta); }.payment-workspace aside > p { margin: 22px 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.7; }.cancel-button { margin-top: auto; min-height: 37px; color: var(--danger); background: transparent; border: 1px solid color-mix(in srgb, var(--danger) 24%, var(--border-subtle)); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.cancel-confirm { margin-top: auto; padding: 10px; display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 6px; color: var(--danger); background: color-mix(in srgb, var(--danger) 7%, transparent); border-radius: 8px; }.cancel-confirm span { font-size: var(--font-caption); }.cancel-confirm button { min-height: 29px; padding: 0 7px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 6px; cursor: pointer; font-size: var(--font-caption); }.cancel-confirm button:last-child { color: var(--danger); }
.terminal-state { min-height: 510px; padding: 40px; display: grid; place-content: center; justify-items: center; gap: 9px; text-align: center; }.terminal-state > span { width: 70px; height: 70px; display: grid; place-items: center; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 50%; font-size: 32px; }.terminal-state.is-success > span { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }.terminal-state.is-warning > span { color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, transparent); }.terminal-state h2 { margin: 9px 0 0; font-size: 24px; }.terminal-state p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); }.terminal-state dl { width: min(420px, 100%); margin: 17px 0; display: grid; grid-template-columns: repeat(3, 1fr); border-block: 1px solid var(--border-subtle); }.terminal-state dl div { padding: 12px 7px; display: grid; gap: 4px; border-right: 1px solid var(--border-subtle); }.terminal-state dl div:last-child { border: 0; }.terminal-state dt { color: var(--text-secondary); font-size: var(--font-caption); }.terminal-state dd { margin: 0; font-size: var(--font-meta); font-weight: 700; }.terminal-state .button { margin-top: 10px; min-height: 40px; font-size: var(--font-meta); }
@keyframes spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
@media (max-width: 760px) { .payment-workspace { grid-template-columns: 1fr; }.payment-primary { min-height: 410px; padding: 23px; border-right: 0; border-bottom: 1px solid var(--border-subtle); }.payment-workspace aside { min-height: 260px; }.qr-frame { width: 248px; height: 248px; }.qr-frame img { width: 214px; height: 214px; } }
</style>
