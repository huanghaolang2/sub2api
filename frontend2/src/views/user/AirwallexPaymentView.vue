<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  PAYMENT_RECOVERY_STORAGE_KEY,
  VisiblePaymentMethod,
  formatPaymentAmount,
  readPaymentRecoverySnapshot,
  type PaymentRecoverySnapshot
} from '@/features/user/payment/model'

enum AirwallexScreen {
  RESTORING = 'restoring',
  REDIRECTING = 'redirecting',
  ERROR = 'error'
}

const route = useRoute()
const screen = ref(AirwallexScreen.RESTORING)
const error = ref('')
const snapshot = ref<PaymentRecoverySnapshot | null>(null)

function query(key: string): string {
  const value = route.query[key]
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function restore(): PaymentRecoverySnapshot | null {
  const resumeToken = query('resume_token')
  const orderId = Number(query('order_id')) || 0
  const outTradeNo = query('out_trade_no')
  const value = readPaymentRecoverySnapshot(
    localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY),
    resumeToken ? { resumeToken } : {}
  )
  if (!value || value.paymentType !== VisiblePaymentMethod.AIRWALLEX) return null
  if (orderId && value.orderId !== orderId) return null
  if (outTradeNo && value.outTradeNo !== outTradeNo) return null
  if (!value.intentId || !value.clientSecret) return null
  return value
}

function successUrl(value: PaymentRecoverySnapshot): string {
  const url = new URL('/payment/result', window.location.origin)
  url.searchParams.set('order_id', query('order_id') || String(value.orderId))
  if (query('out_trade_no') || value.outTradeNo) url.searchParams.set('out_trade_no', query('out_trade_no') || value.outTradeNo)
  if (query('resume_token') || value.resumeToken) url.searchParams.set('resume_token', query('resume_token') || value.resumeToken)
  return url.toString()
}

async function initialize(): Promise<void> {
  snapshot.value = restore()
  if (!snapshot.value) {
    error.value = '支付恢复信息缺失、已过期或与当前订单不匹配。'
    screen.value = AirwallexScreen.ERROR
    return
  }
  try {
    const airwallex = await import('@airwallex/components-sdk')
    const initialized = await airwallex.init({
      env: snapshot.value.paymentEnv === 'prod' ? 'prod' : 'demo',
      enabledElements: ['payments'],
      locale: document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    })
    if (!initialized.payments) throw new Error('Airwallex Payments 模块不可用。')
    screen.value = AirwallexScreen.REDIRECTING
    const redirect = initialized.payments.redirectToCheckout({
      intent_id: snapshot.value.intentId,
      client_secret: snapshot.value.clientSecret,
      currency: snapshot.value.currency || 'CNY',
      country_code: snapshot.value.countryCode || 'CN',
      successUrl: successUrl(snapshot.value)
    })
    if (typeof redirect === 'string' && redirect) window.location.assign(redirect)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Airwallex 支付初始化失败。'
    screen.value = AirwallexScreen.ERROR
  }
}

onMounted(() => { void initialize() })
</script>

<template>
  <main class="airwallex-page">
    <section class="airwallex-card">
      <header><p>Hosted checkout</p><h1>Airwallex 支付</h1><span v-if="snapshot">订单 #{{ snapshot.orderId }} · {{ formatPaymentAmount(snapshot.payAmount, snapshot.currency) }}</span></header>
      <div v-if="screen !== AirwallexScreen.ERROR" class="airwallex-state"><span /><strong>{{ screen === AirwallexScreen.RESTORING ? '正在恢复安全支付…' : '正在前往 Airwallex 收银台…' }}</strong><p>支付信息由 Airwallex 托管处理，请勿关闭当前页面。</p></div>
      <div v-else class="airwallex-state is-error"><i>×</i><strong>无法打开支付页面</strong><p>{{ error }}</p><RouterLink to="/app/purchase">返回购买与充值</RouterLink><RouterLink to="/app/orders">查看我的订单</RouterLink></div>
      <footer><span>恢复信息只保存在当前浏览器</span><span>订单状态由服务端确认</span></footer>
    </section>
  </main>
</template>

<style scoped>
.airwallex-page { min-height: 100vh; padding: 30px 20px; display: grid; place-items: center; color: var(--text-primary); background: #eef8f6; }.airwallex-card { width: min(590px, 100%); overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 20px; box-shadow: 0 28px 75px rgb(0 92 75 / 12%); }.airwallex-card > header { padding: 26px; color: white; background: #065f55; }.airwallex-card header p { margin: 0 0 6px; opacity: .7; font-size: var(--font-caption); font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }.airwallex-card h1 { margin: 0; font-size: 23px; }.airwallex-card header span { margin-top: 9px; display: block; opacity: .75; font-size: var(--font-meta); }.airwallex-state { min-height: 370px; padding: 35px; display: grid; place-content: center; justify-items: center; gap: 10px; text-align: center; }.airwallex-state > span { width: 44px; height: 44px; margin-bottom: 6px; border: 4px solid rgb(6 95 85 / 18%); border-top-color: #067a6c; border-radius: 50%; animation: spin 1s linear infinite; }.airwallex-state > i { width: 65px; height: 65px; display: grid; place-items: center; color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); border-radius: 50%; font-size: 30px; font-style: normal; }.airwallex-state strong { font-size: 15px; }.airwallex-state p { max-width: 380px; margin: 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.65; }.airwallex-state a { min-width: 180px; min-height: 38px; margin-top: 5px; display: grid; place-items: center; color: white; background: #067a6c; border-radius: 8px; font-size: var(--font-meta); text-decoration: none; }.airwallex-state a:last-child { margin-top: -4px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); }.airwallex-card > footer { padding: 12px 18px; display: flex; justify-content: space-between; gap: 12px; color: var(--text-secondary); background: var(--surface-canvas); border-top: 1px solid var(--border-subtle); font-size: var(--font-caption); } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 500px) { .airwallex-page { padding: 0; align-items: stretch; }.airwallex-card { min-height: 100vh; border: 0; border-radius: 0; box-shadow: none; }.airwallex-card > footer { flex-direction: column; } }
</style>
