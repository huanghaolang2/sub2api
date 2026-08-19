<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PaymentStatusPanel from '@/components/user/payment/PaymentStatusPanel.vue'

const route = useRoute()
const router = useRouter()

function query(key: string): string {
  const value = route.query[key]
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

const orderId = computed(() => Number(query('order_id')) || 0)
const qrCode = computed(() => query('qr') || query('qr_code'))
const expiresAt = computed(() => query('expires_at'))
const paymentType = computed(() => query('payment_type'))
const payUrl = computed(() => query('pay_url'))
const outTradeNo = computed(() => query('out_trade_no'))
const orderType = computed(() => query('order_type') || 'balance')
const currency = computed(() => query('currency') || 'CNY')
const amount = computed(() => Number(query('amount')) || 0)
const payAmount = computed(() => Number(query('pay_amount')) || amount.value)

async function paymentSuccess(): Promise<void> {
  await router.push({
    path: '/payment/result',
    query: { order_id: String(orderId.value), out_trade_no: outTradeNo.value || undefined, status: 'success' }
  })
}
</script>

<template>
  <ConsoleShell>
    <div class="qrcode-page">
      <header><p>账务与权益 / 支付进行中</p><h1>扫码支付</h1><span>关闭页面后仍可从“我的订单”查询结果。</span></header>
      <section v-if="!orderId" class="invalid-state" role="alert"><strong>缺少订单参数</strong><span>请返回购买页面重新创建订单。</span><RouterLink to="/app/purchase">返回购买与充值</RouterLink></section>
      <PaymentStatusPanel v-else :order-id="orderId" :amount="amount" :pay-amount="payAmount" :qr-code="qrCode" :expires-at="expiresAt" :payment-type="paymentType" :pay-url="payUrl" :order-type="orderType" :currency="currency" :out-trade-no="outTradeNo" @done="router.push('/app/purchase')" @success="paymentSuccess" />
    </div>
  </ConsoleShell>
</template>

<style scoped>
.qrcode-page { width: min(1080px, 100%); margin: 0 auto; padding-bottom: 56px; }.qrcode-page > header { margin-bottom: 25px; }.qrcode-page > header p { margin: 0 0 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }.qrcode-page h1 { font-size: clamp(40px, 5vw, 64px); }.qrcode-page header span { margin-top: 10px; display: block; color: var(--text-secondary); font-size: var(--font-meta); }.invalid-state { min-height: 330px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--text-secondary); background: var(--surface-raised); border: 1px dashed var(--border-subtle); border-radius: 15px; }.invalid-state strong { color: var(--text-primary); font-size: 17px; }.invalid-state span, .invalid-state a { font-size: var(--font-meta); }.invalid-state a { color: var(--accent); }
</style>
