<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { paymentAPI } from '@shared-api/payment'
import * as subscriptionsAPI from '@shared-api/subscriptions'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import PaymentStatusPanel from '@/components/user/payment/PaymentStatusPanel.vue'
import {
  PAYMENT_METHOD_ORDER,
  PAYMENT_RECOVERY_STORAGE_KEY,
  PaymentLaunchKind,
  PaymentPhase,
  PaymentTab,
  VisiblePaymentMethod,
  amountFitsMethod,
  buildCreateOrderPayload,
  buildWechatOAuthAuthorizeUrl,
  clearPaymentRecoverySnapshot,
  decidePaymentLaunch,
  emptyPaymentState,
  feeAndTotal,
  formatPaymentAmount,
  getPaymentPopupFeatures,
  getVisibleMethods,
  hasWechatResumeQuery,
  isMobileDevice,
  isWechatBrowser,
  normalizePaymentCurrency,
  normalizeVisibleMethod,
  parseWechatResumeRoute,
  paymentErrorMessage,
  paymentMethodLabel,
  planValidityLabel,
  readPaymentRecoverySnapshot,
  shouldFallbackToDesktopQr,
  stripWechatResumeQuery,
  subscriptionPaymentAmount,
  writePaymentRecoverySnapshot,
  type PaymentRecoverySnapshot
} from '@/features/user/payment/model'
import { formatDateTime, platformLabel } from '@/features/user/billing/model'
import type { CheckoutInfoResponse, CreateOrderResult, MethodLimit, OrderType, SubscriptionPlan } from '@/types/payment'
import type { UserSubscription } from '@/types'
import { useAuthStore } from '@/stores/auth'

interface RequestError { response?: { data?: { detail?: string } }; message?: string }
interface CreateOptions {
  openid?: string
  wechatResumeToken?: string
  paymentType?: string
  mobileQrFallbackAttempted?: boolean
}
interface WeixinJSBridgeLike {
  invoke(action: string, payload: Record<string, unknown>, callback: (result: Record<string, unknown>) => void): void
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const checkout = ref<CheckoutInfoResponse>({
  methods: {}, global_min: 0, global_max: 0, plans: [], balance_disabled: false,
  balance_recharge_multiplier: 1, subscription_usd_to_cny_rate: 0, recharge_fee_rate: 0,
  help_text: '', help_image_url: '', stripe_publishable_key: ''
})
const activeSubscriptions = ref<UserSubscription[]>([])
const loading = ref(true)
const error = ref('')
const errorHint = ref('')
const submitting = ref(false)
const activeTab = ref(PaymentTab.RECHARGE)
const phase = ref(PaymentPhase.SELECT)
const amount = ref<number | null>(null)
const selectedMethod = ref('')
const selectedPlan = ref<SubscriptionPlan | null>(null)
const paymentState = ref<PaymentRecoverySnapshot>(emptyPaymentState())
const renewalPlans = ref<SubscriptionPlan[]>([])
const renewalDialogOpen = ref(false)
const helpPreviewOpen = ref(false)

const visibleMethods = computed(() => getVisibleMethods(checkout.value.methods))
const enabledMethods = computed(() => Object.keys(visibleMethods.value).sort((left, right) => {
  const leftIndex = PAYMENT_METHOD_ORDER.indexOf(left as typeof PAYMENT_METHOD_ORDER[number])
  const rightIndex = PAYMENT_METHOD_ORDER.indexOf(right as typeof PAYMENT_METHOD_ORDER[number])
  return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
}))
const selectedLimit = computed(() => visibleMethods.value[selectedMethod.value])
const selectedCurrency = computed(() => normalizePaymentCurrency(selectedLimit.value?.currency))
const balanceMultiplier = computed(() => checkout.value.balance_recharge_multiplier > 0 ? checkout.value.balance_recharge_multiplier : 1)
const subscriptionExchangeRate = computed(() => checkout.value.subscription_usd_to_cny_rate > 0 ? checkout.value.subscription_usd_to_cny_rate : 0)
const validAmount = computed(() => Number(amount.value || 0))
const creditedAmount = computed(() => Math.round(validAmount.value * balanceMultiplier.value * 100) / 100)
const selectedPlanBaseAmount = computed(() => selectedPlan.value
  ? subscriptionPaymentAmount(selectedPlan.value.price, selectedCurrency.value, subscriptionExchangeRate.value)
  : 0)
const basePaymentAmount = computed(() => activeTab.value === PaymentTab.SUBSCRIPTION ? selectedPlanBaseAmount.value : validAmount.value)
const paymentTotals = computed(() => feeAndTotal(basePaymentAmount.value, checkout.value.recharge_fee_rate || 0, selectedCurrency.value))
const availableTabs = computed(() => checkout.value.balance_disabled ? [PaymentTab.SUBSCRIPTION] : [PaymentTab.RECHARGE, PaymentTab.SUBSCRIPTION])
const globalMin = computed(() => {
  const limits = Object.values(visibleMethods.value)
  if (!limits.length || limits.some((item) => item.single_min <= 0)) return checkout.value.global_min || 0
  return Math.min(...limits.map((item) => item.single_min))
})
const globalMax = computed(() => {
  const limits = Object.values(visibleMethods.value)
  if (!limits.length || limits.some((item) => item.single_max <= 0)) return checkout.value.global_max || 0
  return Math.max(...limits.map((item) => item.single_max))
})
const amountError = computed(() => {
  if (activeTab.value !== PaymentTab.RECHARGE || validAmount.value <= 0) return ''
  if (!enabledMethods.value.some((method) => amountFitsMethod(validAmount.value, method, visibleMethods.value))) {
    return '当前金额不在任何支付方式的可用限额内。'
  }
  const limit = selectedLimit.value
  if (!limit) return '请选择支付方式。'
  if (limit.single_min > 0 && validAmount.value < limit.single_min) return `当前方式单笔最低 ${formatPaymentAmount(limit.single_min, limit.currency)}`
  if (limit.single_max > 0 && validAmount.value > limit.single_max) return `当前方式单笔最高 ${formatPaymentAmount(limit.single_max, limit.currency)}`
  if (limit.daily_remaining > 0 && validAmount.value > limit.daily_remaining) return `当前方式今日剩余 ${formatPaymentAmount(limit.daily_remaining, limit.currency)}`
  return ''
})
const canSubmit = computed(() => {
  if (!selectedMethod.value || !selectedLimit.value || selectedLimit.value.available === false) return false
  const businessAmount = activeTab.value === PaymentTab.SUBSCRIPTION ? selectedPlan.value?.price || 0 : validAmount.value
  return businessAmount > 0 && amountFitsMethod(paymentTotals.value.total, selectedMethod.value, visibleMethods.value)
})

function requestError(caught: unknown, fallback: string): string {
  const value = caught as RequestError
  return value.response?.data?.detail || value.message || fallback
}

function planFeatures(plan: SubscriptionPlan): string[] {
  const features = plan.features as string[] | string
  return typeof features === 'string' ? features.split('\n').map((item) => item.trim()).filter(Boolean) : features || []
}

function methodAvailable(method: string): boolean {
  const amountToValidate = activeTab.value === PaymentTab.SUBSCRIPTION && selectedPlan.value
    ? feeAndTotal(
      subscriptionPaymentAmount(selectedPlan.value.price, normalizePaymentCurrency(visibleMethods.value[method]?.currency), subscriptionExchangeRate.value),
      checkout.value.recharge_fee_rate || 0,
      normalizePaymentCurrency(visibleMethods.value[method]?.currency)
    ).total
    : validAmount.value
  return amountFitsMethod(amountToValidate, method, visibleMethods.value)
}

function methodLimitText(limit: MethodLimit): string {
  const currency = normalizePaymentCurrency(limit.currency)
  const range = `${limit.single_min > 0 ? formatPaymentAmount(limit.single_min, currency) : '不限'} – ${limit.single_max > 0 ? formatPaymentAmount(limit.single_max, currency) : '不限'}`
  if (limit.available === false) return '当前不可用'
  if (limit.daily_limit > 0) return `${range} · 今日剩余 ${formatPaymentAmount(limit.daily_remaining, currency)}`
  return `${range} · 无日限额`
}

function selectMethod(method: string): void {
  if (!methodAvailable(method)) return
  selectedMethod.value = method
}

function switchTab(tab: PaymentTab): void {
  activeTab.value = tab
  selectedPlan.value = null
  error.value = ''
}

function selectPlan(plan: SubscriptionPlan): void {
  selectedPlan.value = plan
  renewalDialogOpen.value = false
  error.value = ''
  const firstAvailable = enabledMethods.value.find((method) => {
    const currency = normalizePaymentCurrency(visibleMethods.value[method]?.currency)
    const planAmount = subscriptionPaymentAmount(plan.price, currency, subscriptionExchangeRate.value)
    return amountFitsMethod(feeAndTotal(planAmount, checkout.value.recharge_fee_rate || 0, currency).total, method, visibleMethods.value)
  })
  if (firstAvailable && !methodAvailable(selectedMethod.value)) selectedMethod.value = firstAvailable
}

function persistRecovery(snapshot: PaymentRecoverySnapshot): void {
  if (snapshot.orderId) writePaymentRecoverySnapshot(window.localStorage, snapshot)
}

function removeRecovery(): void {
  clearPaymentRecoverySnapshot(window.localStorage)
}

function resetPayment(): void {
  phase.value = PaymentPhase.SELECT
  paymentState.value = emptyPaymentState()
  selectedPlan.value = null
  removeRecovery()
}

function getWeixinBridge(): WeixinJSBridgeLike | undefined {
  return (window as Window & { WeixinJSBridge?: WeixinJSBridgeLike }).WeixinJSBridge
}

function waitForWeixinBridge(timeoutMs: number = 4000): Promise<WeixinJSBridgeLike | null> {
  const existing = getWeixinBridge()
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    let settled = false
    const finish = (bridge: WeixinJSBridgeLike | null) => {
      if (settled) return
      settled = true
      document.removeEventListener('WeixinJSBridgeReady', ready)
      document.removeEventListener('onWeixinJSBridgeReady', ready)
      window.clearTimeout(timer)
      resolve(bridge)
    }
    const ready = () => finish(getWeixinBridge() || null)
    const timer = window.setTimeout(() => finish(getWeixinBridge() || null), timeoutMs)
    document.addEventListener('WeixinJSBridgeReady', ready)
    document.addEventListener('onWeixinJSBridgeReady', ready)
  })
}

async function invokeWechatJsapi(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const bridge = await waitForWeixinBridge()
  if (!bridge) throw new Error('WECHAT_JSAPI_UNAVAILABLE')
  return new Promise((resolve) => bridge.invoke('getBrandWCPayRequest', payload, (result) => resolve(result || {})))
}

function setPaymentError(caught: unknown, method: string): void {
  const descriptor = paymentErrorMessage(caught, method, isMobileDevice(), isWechatBrowser())
  error.value = descriptor.message
  errorHint.value = descriptor.hint || ''
}

async function attemptQrFallback(caught: unknown, context: {
  amount: number
  orderType: OrderType
  planId?: number
  paymentType: string
  attempted: boolean
}): Promise<boolean> {
  if (!shouldFallbackToDesktopQr(caught, context.paymentType, context.attempted, isMobileDevice())) return false
  try {
    const payload = buildCreateOrderPayload({
      amount: context.amount,
      paymentType: context.paymentType,
      orderType: context.orderType,
      planId: context.planId,
      origin: window.location.origin,
      isMobile: false,
      isWechatBrowser: false
    })
    const result = (await paymentAPI.createOrder(payload)).data
    const decision = decidePaymentLaunch(result, {
      visibleMethod: context.paymentType,
      orderType: context.orderType,
      isMobile: false,
      isWechatBrowser: false
    })
    if (decision.kind !== PaymentLaunchKind.QR_WAITING || !decision.paymentState.qrCode) return false
    paymentState.value = decision.paymentState
    phase.value = PaymentPhase.PAYING
    persistRecovery(decision.recovery)
    error.value = ''
    errorHint.value = '移动支付不可用，已自动切换为二维码。'
    return true
  } catch {
    return false
  }
}

async function createOrder(orderAmount: number, orderType: OrderType, planId?: number, options: CreateOptions = {}): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  error.value = ''
  errorHint.value = ''
  const requestMethod = normalizeVisibleMethod(options.paymentType || selectedMethod.value) || options.paymentType || selectedMethod.value
  try {
    const mobile = isMobileDevice()
    const wechat = isWechatBrowser()
    const payload = buildCreateOrderPayload({
      amount: orderAmount,
      paymentType: requestMethod,
      orderType,
      planId,
      origin: window.location.origin,
      isMobile: mobile,
      isWechatBrowser: wechat,
      forceQRCode: checkout.value.alipay_force_qrcode === true && requestMethod === VisiblePaymentMethod.ALIPAY,
      mobilePrecreateDeepLink: checkout.value.alipay_mobile_precreate_deep_link === true
    })
    if (options.openid) payload.openid = options.openid
    if (options.wechatResumeToken) payload.wechat_resume_token = options.wechatResumeToken
    const result = (await paymentAPI.createOrder(payload)).data as CreateOrderResult & { resume_token?: string }
    const stripeMethod = requestMethod === VisiblePaymentMethod.STRIPE ? '' : requestMethod === VisiblePaymentMethod.WXPAY ? 'wechat_pay' : 'alipay'
    const stripeRoute = router.resolve({
      path: '/payment/stripe',
      query: {
        order_id: String(result.order_id),
        client_secret: result.client_secret || undefined,
        method: stripeMethod || undefined,
        resume_token: result.resume_token || undefined
      }
    }).href
    const airwallexRoute = router.resolve({
      path: '/payment/airwallex',
      query: {
        order_id: String(result.order_id),
        out_trade_no: result.out_trade_no || undefined,
        resume_token: result.resume_token || undefined
      }
    }).href
    const decision = decidePaymentLaunch(result, {
      visibleMethod: requestMethod,
      orderType,
      isMobile: mobile,
      isWechatBrowser: wechat,
      forceQRCode: checkout.value.alipay_force_qrcode === true && requestMethod === VisiblePaymentMethod.ALIPAY,
      mobilePrecreateDeepLink: checkout.value.alipay_mobile_precreate_deep_link === true,
      stripePopupUrl: stripeRoute,
      stripeRouteUrl: stripeRoute,
      airwallexRouteUrl: airwallexRoute
    })
    if (decision.kind === PaymentLaunchKind.WECHAT_OAUTH && decision.oauth?.authorize_url) {
      window.location.assign(buildWechatOAuthAuthorizeUrl(decision.oauth.authorize_url, {
        paymentType: requestMethod,
        orderType,
        planId,
        orderAmount
      }, window.location.origin))
      return
    }
    if (decision.kind === PaymentLaunchKind.UNHANDLED) throw { reason: 'UNHANDLED_PAYMENT_SCENARIO' }
    paymentState.value = decision.paymentState
    persistRecovery(decision.recovery)
    phase.value = PaymentPhase.PAYING
    if (decision.kind === PaymentLaunchKind.STRIPE_POPUP) {
      const popup = window.open(decision.paymentState.payUrl, 'paymentPopup', getPaymentPopupFeatures())
      if (!popup || popup.closed) await router.push(decision.paymentState.payUrl)
    } else if ([PaymentLaunchKind.STRIPE_ROUTE, PaymentLaunchKind.AIRWALLEX_ROUTE].includes(decision.kind)) {
      await router.push(decision.paymentState.payUrl)
    } else if (decision.kind === PaymentLaunchKind.REDIRECT_WAITING && decision.paymentState.payUrl) {
      if (mobile) window.location.assign(decision.paymentState.payUrl)
      else window.open(decision.paymentState.payUrl, 'paymentPopup', getPaymentPopupFeatures())
    } else if (decision.kind === PaymentLaunchKind.WECHAT_JSAPI && decision.jsapi) {
      const jsapiResult = await invokeWechatJsapi(decision.jsapi as Record<string, unknown>)
      const message = String(jsapiResult.err_msg || '').toLowerCase()
      if (message.includes('cancel')) resetPayment()
      else if (message && !message.includes('ok')) {
        resetPayment()
        const fallback = await attemptQrFallback({ reason: 'WECHAT_JSAPI_FAILED', message }, {
          amount: orderAmount, orderType, planId, paymentType: requestMethod,
          attempted: options.mobileQrFallbackAttempted === true
        })
        if (!fallback) throw { reason: 'WECHAT_JSAPI_FAILED', message }
      } else {
        await router.push({ path: '/payment/result', query: { order_id: String(result.order_id), out_trade_no: result.out_trade_no, resume_token: result.resume_token } })
      }
    }
  } catch (caught) {
    const fallback = await attemptQrFallback(caught, {
      amount: orderAmount,
      orderType,
      planId,
      paymentType: requestMethod,
      attempted: options.mobileQrFallbackAttempted === true
    })
    if (!fallback) setPaymentError(caught, requestMethod)
  } finally {
    submitting.value = false
  }
}

function submit(): void {
  if (!canSubmit.value) return
  if (activeTab.value === PaymentTab.SUBSCRIPTION && selectedPlan.value) {
    void createOrder(selectedPlan.value.price, 'subscription', selectedPlan.value.id)
  } else {
    void createOrder(validAmount.value, 'balance')
  }
}

async function paymentSuccess(): Promise<void> {
  const completed = { ...paymentState.value }
  removeRecovery()
  await Promise.allSettled([auth.refreshUser(), subscriptionsAPI.getActiveSubscriptions().then((value) => { activeSubscriptions.value = value })])
  await router.push({
    path: '/payment/result',
    query: {
      order_id: String(completed.orderId),
      out_trade_no: completed.outTradeNo || undefined,
      resume_token: completed.resumeToken || undefined
    }
  })
}

async function resumeWechatPayment(): Promise<void> {
  const resume = parseWechatResumeRoute(route.query, checkout.value.plans, validAmount.value)
  if (!resume) return
  selectedMethod.value = resume.paymentType
  activeTab.value = resume.orderType === 'subscription' ? PaymentTab.SUBSCRIPTION : PaymentTab.RECHARGE
  if (resume.orderType === 'balance' && resume.orderAmount > 0) amount.value = resume.orderAmount
  if (resume.orderType === 'subscription' && resume.planId) selectedPlan.value = checkout.value.plans.find((plan) => plan.id === resume.planId) || null
  await router.replace({ path: route.path, query: stripWechatResumeQuery(route.query) })
  if (resume.wechatResumeToken) {
    await createOrder(0, resume.orderType, resume.planId, { wechatResumeToken: resume.wechatResumeToken, paymentType: resume.paymentType })
  } else if (resume.openid && resume.orderAmount > 0) {
    await createOrder(resume.orderAmount, resume.orderType, resume.planId, { openid: resume.openid, paymentType: resume.paymentType })
  }
}

async function initialize(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [checkoutResponse, subscriptionsResult] = await Promise.allSettled([
      paymentAPI.getCheckoutInfo(),
      subscriptionsAPI.getActiveSubscriptions()
    ])
    if (checkoutResponse.status === 'rejected') throw checkoutResponse.reason
    checkout.value = {
      ...checkoutResponse.value.data,
      plans: (checkoutResponse.value.data.plans || []).map((plan) => ({ ...plan, features: planFeatures(plan) }))
    }
    if (subscriptionsResult.status === 'fulfilled') activeSubscriptions.value = subscriptionsResult.value
    const firstMethod = enabledMethods.value.find((method) => visibleMethods.value[method]?.available !== false)
    selectedMethod.value = firstMethod || ''
    if (checkout.value.balance_disabled) activeTab.value = PaymentTab.SUBSCRIPTION
    if (hasWechatResumeQuery(route.query)) removeRecovery()
    const routeResumeToken = typeof route.query.resume_token === 'string'
      ? route.query.resume_token
      : typeof route.query.wechat_resume_token === 'string' ? route.query.wechat_resume_token : undefined
    const restored = readPaymentRecoverySnapshot(localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY), { resumeToken: routeResumeToken })
    if (restored) {
      paymentState.value = restored
      phase.value = PaymentPhase.PAYING
      selectedMethod.value = normalizeVisibleMethod(restored.paymentType) || restored.paymentType
    } else {
      removeRecovery()
    }
    if (route.query.tab === PaymentTab.SUBSCRIPTION) {
      activeTab.value = PaymentTab.SUBSCRIPTION
      const groupId = Number(route.query.group || 0)
      if (groupId) {
        renewalPlans.value = checkout.value.plans.filter((plan) => plan.group_id === groupId)
        if (renewalPlans.value.length === 1) selectPlan(renewalPlans.value[0]!)
        else if (renewalPlans.value.length > 1) renewalDialogOpen.value = true
      }
    }
    await resumeWechatPayment()
  } catch (caught) {
    error.value = requestError(caught, '购买与充值信息加载失败')
  } finally {
    loading.value = false
  }
}

watch([validAmount, selectedMethod], ([currentAmount, method]) => {
  if (currentAmount <= 0 || methodAvailable(method)) return
  const fallback = enabledMethods.value.find(methodAvailable)
  if (fallback) selectedMethod.value = fallback
})

onMounted(() => { void initialize() })
</script>

<template>
  <ConsoleShell>
    <div class="purchase-page">
      <header class="purchase-heading"><div><p>账务与权益 / 购买与充值</p><h1>购买额度</h1><span>选择业务、金额或套餐和支付方式；限额、费率与币种直接来自服务端。</span></div><RouterLink class="button button--secondary" to="/app/orders">我的订单</RouterLink></header>
      <p v-if="error || errorHint" class="purchase-error" role="alert"><strong>{{ error }}</strong><span v-if="errorHint">{{ errorHint }}</span></p>
      <PageState :loading="loading" :error="loading ? '' : error && !enabledMethods.length ? error : ''" @retry="initialize">
        <PaymentStatusPanel v-if="phase === PaymentPhase.PAYING" :order-id="paymentState.orderId" :amount="paymentState.amount" :pay-amount="paymentState.payAmount" :qr-code="paymentState.qrCode" :expires-at="paymentState.expiresAt" :payment-type="paymentState.paymentType" :pay-url="paymentState.payUrl" :order-type="paymentState.orderType" :currency="paymentState.currency" :out-trade-no="paymentState.outTradeNo" :mobile-alipay-deep-link="paymentState.alipayMobilePrecreateDeepLink" @done="resetPayment" @success="paymentSuccess" @settled="removeRecovery" />

        <template v-else>
          <nav v-if="availableTabs.length > 1" class="purchase-tabs" aria-label="购买类型"><button type="button" :class="{ active: activeTab === PaymentTab.RECHARGE }" @click="switchTab(PaymentTab.RECHARGE)">余额充值</button><button type="button" :class="{ active: activeTab === PaymentTab.SUBSCRIPTION }" @click="switchTab(PaymentTab.SUBSCRIPTION)">订阅套餐</button></nav>
          <section class="checkout-layout">
            <div class="checkout-main">
              <section v-if="activeTab === PaymentTab.RECHARGE" class="checkout-section">
                <header><div><span>01 / 充值金额</span><h2>为 {{ auth.user?.username || auth.user?.email }} 充值</h2></div><strong>当前余额 {{ formatPaymentAmount(Number(auth.user?.balance || 0), 'USD') }}</strong></header>
                <div class="amount-presets"><button v-for="preset in [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]" :key="preset" type="button" :class="{ active: amount === preset }" @click="amount = preset">{{ preset }}</button></div>
                <label class="custom-amount" for="recharge-amount"><span>自定义充值金额（{{ selectedCurrency }}）</span><div><strong>{{ selectedCurrency }}</strong><input id="recharge-amount" v-model.number="amount" type="number" min="0" step="0.01" placeholder="输入金额"></div><small v-if="globalMin || globalMax">全渠道范围：{{ globalMin > 0 ? formatPaymentAmount(globalMin, selectedCurrency) : '不限' }} – {{ globalMax > 0 ? formatPaymentAmount(globalMax, selectedCurrency) : '不限' }}</small></label>
                <p v-if="amountError" class="field-error">{{ amountError }}</p>
                <div v-if="balanceMultiplier !== 1" class="rate-notice"><span>充值换算</span><strong>{{ formatPaymentAmount(1, selectedCurrency) }} → {{ formatPaymentAmount(balanceMultiplier, 'USD') }} 余额</strong><small>预计到账 {{ formatPaymentAmount(creditedAmount, 'USD') }}</small></div>
              </section>

              <section v-else class="checkout-section plans-section">
                <header><div><span>01 / 订阅套餐</span><h2>{{ selectedPlan ? '确认套餐权益' : '选择套餐' }}</h2></div><button v-if="selectedPlan" type="button" @click="selectedPlan = null">重新选择</button></header>
                <article v-if="selectedPlan" class="selected-plan"><div class="selected-plan__title"><span>{{ platformLabel(selectedPlan.group_platform || '') }}</span><h3>{{ selectedPlan.name }}</h3><p>{{ selectedPlan.description }}</p></div><div class="selected-plan__price"><small v-if="selectedPlan.original_price">原价 {{ formatPaymentAmount(subscriptionPaymentAmount(selectedPlan.original_price, selectedCurrency, subscriptionExchangeRate), selectedCurrency) }}</small><strong>{{ formatPaymentAmount(selectedPlanBaseAmount, selectedCurrency) }}</strong><span>/ {{ planValidityLabel(selectedPlan) }}</span></div><dl><div><dt>基础倍率</dt><dd>×{{ selectedPlan.rate_multiplier ?? 1 }}</dd></div><div v-if="selectedPlan.peak_rate_enabled"><dt>高峰倍率</dt><dd>{{ selectedPlan.peak_start }}–{{ selectedPlan.peak_end }} ×{{ selectedPlan.peak_rate_multiplier }}</dd></div><div><dt>每日额度</dt><dd>{{ selectedPlan.daily_limit_usd == null ? '不限' : selectedPlan.daily_limit_usd === 0 ? '禁用' : formatPaymentAmount(selectedPlan.daily_limit_usd, 'USD') }}</dd></div><div><dt>每周额度</dt><dd>{{ selectedPlan.weekly_limit_usd == null ? '不限' : selectedPlan.weekly_limit_usd === 0 ? '禁用' : formatPaymentAmount(selectedPlan.weekly_limit_usd, 'USD') }}</dd></div><div><dt>每月额度</dt><dd>{{ selectedPlan.monthly_limit_usd == null ? '不限' : selectedPlan.monthly_limit_usd === 0 ? '禁用' : formatPaymentAmount(selectedPlan.monthly_limit_usd, 'USD') }}</dd></div><div><dt>适用模型</dt><dd>{{ selectedPlan.supported_model_scopes?.join('、') || '分组内全部模型' }}</dd></div></dl><ul v-if="planFeatures(selectedPlan).length"><li v-for="feature in planFeatures(selectedPlan)" :key="feature">{{ feature }}</li></ul></article>
                <div v-else-if="checkout.plans.length" class="plans-grid"><article v-for="plan in checkout.plans" :key="plan.id" class="plan-card"><div><span>{{ platformLabel(plan.group_platform || '') }}</span><strong>{{ plan.name }}</strong><p>{{ plan.description }}</p></div><div class="plan-price"><small v-if="plan.original_price">{{ formatPaymentAmount(plan.original_price, 'USD') }}</small><strong>{{ formatPaymentAmount(plan.price, plan.currency || 'USD') }}</strong><span>/ {{ planValidityLabel(plan) }}</span></div><dl><div><dt>倍率</dt><dd>×{{ plan.rate_multiplier ?? 1 }}</dd></div><div><dt>月额度</dt><dd>{{ plan.monthly_limit_usd == null ? '不限' : plan.monthly_limit_usd === 0 ? '禁用' : formatPaymentAmount(plan.monthly_limit_usd, 'USD') }}</dd></div></dl><ul><li v-for="feature in planFeatures(plan).slice(0, 4)" :key="feature">{{ feature }}</li></ul><button type="button" @click="selectPlan(plan)">选择套餐</button></article></div>
                <div v-else class="inline-empty"><strong>暂无可售套餐</strong><span>管理员上架套餐后会显示在这里。</span></div>
              </section>

              <section class="checkout-section methods-section">
                <header><div><span>02 / 支付方式</span><h2>选择支付渠道</h2></div></header>
                <div v-if="enabledMethods.length" class="method-grid"><button v-for="method in enabledMethods" :key="method" type="button" :class="{ active: selectedMethod === method }" :disabled="!methodAvailable(method)" @click="selectMethod(method)"><i>{{ method === 'alipay' ? '支' : method === 'wxpay' ? '微' : method === 'stripe' ? 'S' : method === 'airwallex' ? 'A' : 'P' }}</i><span><strong>{{ paymentMethodLabel(method, visibleMethods[method]?.display_name) }}</strong><small>{{ methodLimitText(visibleMethods[method]!) }}</small></span><em v-if="visibleMethods[method]?.fee_rate">渠道费率 {{ visibleMethods[method]?.fee_rate }}%</em></button></div><div v-else class="inline-empty"><strong>当前没有可用支付方式</strong><span>请联系管理员检查支付渠道配置。</span></div>
              </section>

              <section v-if="activeSubscriptions.length" class="active-subscriptions"><header><span>当前生效订阅</span><RouterLink to="/app/subscriptions">查看全部</RouterLink></header><div><article v-for="subscription in activeSubscriptions" :key="subscription.id"><strong>{{ subscription.group?.name || `分组 #${subscription.group_id}` }}</strong><span>{{ platformLabel(subscription.group?.platform || '') }} · ×{{ subscription.group?.rate_multiplier ?? 1 }}</span><small>{{ subscription.expires_at ? `${formatDateTime(subscription.expires_at)} 到期` : '长期有效' }}</small></article></div></section>
            </div>

            <aside class="checkout-summary"><span>订单摘要</span><h2>{{ activeTab === PaymentTab.SUBSCRIPTION ? selectedPlan?.name || '尚未选择套餐' : '余额充值' }}</h2><dl><div><dt>业务金额</dt><dd>{{ formatPaymentAmount(basePaymentAmount, selectedCurrency) }}</dd></div><div v-if="checkout.recharge_fee_rate > 0"><dt>手续费（{{ checkout.recharge_fee_rate }}%）</dt><dd>{{ formatPaymentAmount(paymentTotals.fee, selectedCurrency) }}</dd></div><div class="total"><dt>应付金额</dt><dd>{{ formatPaymentAmount(paymentTotals.total, selectedCurrency) }}</dd></div><div v-if="activeTab === PaymentTab.RECHARGE"><dt>预计到账</dt><dd>{{ formatPaymentAmount(creditedAmount, 'USD') }}</dd></div></dl><button class="button button--primary" type="button" :disabled="!canSubmit || submitting" @click="submit">{{ submitting ? '创建订单中…' : `确认支付 ${formatPaymentAmount(paymentTotals.total, selectedCurrency)}` }}</button><p>点击后将创建待支付订单。支付状态以服务端回调和查询结果为准。</p></aside>
          </section>

          <section v-if="checkout.help_text || checkout.help_image_url" class="payment-help"><div><span>支付帮助</span><p>{{ checkout.help_text }}</p></div><button v-if="checkout.help_image_url" type="button" @click="helpPreviewOpen = true">查看帮助图片</button></section>
        </template>
      </PageState>
    </div>

    <SurfaceDialog :show="renewalDialogOpen" title="选择续订套餐" description="同一分组有多个可售周期，请选择本次续订计划。" :width="DialogWidth.STANDARD" @close="renewalDialogOpen = false"><div class="renewal-list"><button v-for="plan in renewalPlans" :key="plan.id" type="button" @click="selectPlan(plan)"><span><strong>{{ plan.name }}</strong><small>{{ planValidityLabel(plan) }} · {{ plan.description }}</small></span><em>{{ formatPaymentAmount(plan.price, plan.currency || 'USD') }}</em></button></div></SurfaceDialog>
    <SurfaceDialog :show="helpPreviewOpen" title="支付帮助" :description="checkout.help_text" :width="DialogWidth.WIDE" @close="helpPreviewOpen = false"><img v-if="checkout.help_image_url" class="help-image" :src="checkout.help_image_url" alt="支付帮助"></SurfaceDialog>
  </ConsoleShell>
</template>

<style scoped>
.purchase-page { width: min(1480px, 100%); margin: 0 auto; padding-bottom: 56px; }.purchase-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }.purchase-heading p { margin: 0 0 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }.purchase-heading h1 { font-size: clamp(40px, 5vw, 64px); }.purchase-heading span { margin-top: 12px; display: block; color: var(--text-secondary); font-size: var(--font-body-sm); }.purchase-heading .button { min-height: 42px; display: inline-flex; align-items: center; font-size: var(--font-meta); }.purchase-error { margin: 16px 0 0; padding: 11px 13px; display: grid; gap: 4px; color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); border-left: 3px solid currentColor; font-size: var(--font-meta); }.purchase-error strong { font-size: var(--font-meta); }
.purchase-tabs { width: fit-content; margin-top: 25px; padding: 4px; display: flex; gap: 3px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; }.purchase-tabs button { min-width: 126px; min-height: 36px; padding: 0 13px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.purchase-tabs button.active { color: white; background: var(--accent); }.checkout-layout { margin-top: 12px; display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 13px; align-items: start; }.checkout-main { min-width: 0; display: grid; gap: 12px; }.checkout-section, .active-subscriptions, .checkout-summary, .payment-help { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 14px; }.checkout-section > header { min-height: 68px; padding: 15px 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border-subtle); }.checkout-section header span, .checkout-summary > span, .payment-help span { color: var(--accent); font-size: var(--font-caption); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }.checkout-section h2 { margin: 5px 0 0; font-size: 16px; }.checkout-section header > strong { color: var(--success); font-size: var(--font-meta); }.checkout-section header > button { color: var(--accent); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }
.amount-presets { padding: 17px 18px 8px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; }.amount-presets button { min-height: 41px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); font-weight: 700; }.amount-presets button.active { color: var(--accent); border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }.custom-amount { padding: 9px 18px 18px; display: grid; gap: 6px; }.custom-amount > span { color: var(--text-secondary); font-size: var(--font-meta); }.custom-amount > div { min-height: 48px; display: grid; grid-template-columns: auto 1fr; align-items: center; overflow: hidden; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.custom-amount > div strong { padding: 0 13px; color: var(--accent); font-size: var(--font-meta); }.custom-amount input { min-width: 0; height: 48px; padding: 0 12px; color: var(--text-primary); background: transparent; border: 0; border-left: 1px solid var(--border-subtle); outline: none; font-size: 16px; }.custom-amount small { color: var(--text-secondary); font-size: var(--font-caption); }.field-error { margin: -9px 18px 14px; color: var(--danger); font-size: var(--font-meta); }.rate-notice { margin: 0 18px 18px; padding: 12px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; background: color-mix(in srgb, var(--accent) 6%, var(--surface-canvas)); border-radius: 9px; }.rate-notice span, .rate-notice small { color: var(--text-secondary); font-size: var(--font-caption); }.rate-notice strong { font-size: var(--font-meta); }
.plans-grid { padding: 14px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }.plan-card { min-width: 0; padding: 15px; display: flex; flex-direction: column; gap: 13px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 11px; }.plan-card > div:first-child span, .selected-plan__title > span { color: var(--accent); font-size: var(--font-caption); font-weight: 740; }.plan-card > div:first-child strong { margin-top: 5px; display: block; font-size: 13px; }.plan-card p, .selected-plan__title p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.6; }.plan-price { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; }.plan-price small { color: var(--text-secondary); text-decoration: line-through; font-size: var(--font-caption); }.plan-price strong { font-size: 19px; }.plan-price span { color: var(--text-secondary); font-size: var(--font-caption); }.plan-card dl { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }.plan-card dl div { display: grid; gap: 3px; }.plan-card dt { color: var(--text-secondary); font-size: var(--font-caption); }.plan-card dd { margin: 0; font-size: var(--font-meta); font-weight: 680; }.plan-card ul, .selected-plan ul { margin: 0; padding-left: 14px; color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.8; }.plan-card button { margin-top: auto; min-height: 37px; color: white; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.selected-plan { padding: 20px; display: grid; grid-template-columns: 1fr auto; gap: 18px; }.selected-plan__title h3 { margin: 6px 0 0; font-size: 20px; }.selected-plan__price { text-align: right; }.selected-plan__price small, .selected-plan__price span { display: block; color: var(--text-secondary); font-size: var(--font-caption); }.selected-plan__price small { text-decoration: line-through; }.selected-plan__price strong { display: block; margin: 5px 0; font-size: 28px; }.selected-plan dl { grid-column: 1 / -1; margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border-subtle); }.selected-plan dl div { padding: 10px; display: grid; gap: 4px; background: var(--surface-canvas); }.selected-plan dt { color: var(--text-secondary); font-size: var(--font-caption); }.selected-plan dd { margin: 0; font-size: var(--font-meta); font-weight: 700; }.selected-plan ul { grid-column: 1 / -1; }.inline-empty { min-height: 170px; padding: 20px; display: grid; place-content: center; justify-items: center; gap: 5px; color: var(--text-secondary); }.inline-empty strong { color: var(--text-primary); font-size: var(--font-body-sm); }.inline-empty span { font-size: var(--font-meta); }
.method-grid { padding: 14px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }.method-grid > button { min-width: 0; min-height: 72px; padding: 10px; display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 9px; color: var(--text-primary); text-align: left; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; }.method-grid > button.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }.method-grid > button:disabled { opacity: .42; cursor: not-allowed; }.method-grid i { width: 34px; height: 34px; display: grid; place-items: center; color: white; background: var(--accent); border-radius: 9px; font-size: var(--font-meta); font-style: normal; font-weight: 800; }.method-grid > button:nth-child(1) i { background: #1677ff; }.method-grid > button:nth-child(2) i { background: #07c160; }.method-grid span { min-width: 0; display: grid; gap: 4px; }.method-grid strong { font-size: var(--font-meta); }.method-grid small { overflow: hidden; color: var(--text-secondary); font-size: var(--font-caption); text-overflow: ellipsis; white-space: nowrap; }.method-grid em { color: var(--warning); font-size: var(--font-caption); font-style: normal; }
.checkout-summary { position: sticky; top: 82px; padding: 19px; }.checkout-summary h2 { margin: 7px 0 19px; font-size: 18px; }.checkout-summary dl { margin: 0; display: grid; gap: 11px; }.checkout-summary dl div { display: flex; justify-content: space-between; gap: 12px; color: var(--text-secondary); font-size: var(--font-meta); }.checkout-summary dd { margin: 0; color: var(--text-primary); font-weight: 700; }.checkout-summary .total { margin-top: 5px; padding-top: 14px; align-items: baseline; border-top: 1px solid var(--border-subtle); }.checkout-summary .total dt { color: var(--text-primary); font-weight: 700; }.checkout-summary .total dd { color: var(--accent); font-size: 20px; }.checkout-summary .button { width: 100%; min-height: 45px; margin-top: 18px; font-size: var(--font-meta); }.checkout-summary > p { margin: 11px 0 0; color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.6; text-align: center; }.active-subscriptions > header { padding: 13px 16px; display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }.active-subscriptions header a { color: var(--accent); }.active-subscriptions > div { padding: 9px 14px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }.active-subscriptions article { padding: 9px; display: grid; gap: 3px; background: var(--surface-canvas); border-radius: 8px; }.active-subscriptions strong { font-size: var(--font-meta); }.active-subscriptions span, .active-subscriptions small { color: var(--text-secondary); font-size: var(--font-caption); }.payment-help { margin-top: 12px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; }.payment-help p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.payment-help button { color: var(--accent); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }.renewal-list { display: grid; gap: 8px; }.renewal-list button { min-height: 60px; padding: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--text-primary); text-align: left; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; cursor: pointer; }.renewal-list button span { display: grid; gap: 4px; }.renewal-list strong { font-size: var(--font-meta); }.renewal-list small { color: var(--text-secondary); font-size: var(--font-caption); }.renewal-list em { color: var(--accent); font-size: 12px; font-style: normal; font-weight: 750; }.help-image { width: 100%; max-height: 65vh; object-fit: contain; }
@media (max-width: 1100px) { .checkout-layout { grid-template-columns: 1fr; }.checkout-summary { position: static; }.plans-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 700px) { .purchase-heading { align-items: stretch; flex-direction: column; }.purchase-heading .button { justify-content: center; }.purchase-tabs { width: 100%; }.purchase-tabs button { min-width: 0; flex: 1; }.amount-presets { grid-template-columns: repeat(3, 1fr); }.plans-grid, .method-grid, .active-subscriptions > div { grid-template-columns: 1fr; }.selected-plan { grid-template-columns: 1fr; }.selected-plan__price { text-align: left; }.selected-plan dl { grid-template-columns: repeat(2, 1fr); }.rate-notice { grid-template-columns: 1fr; } }
</style>
