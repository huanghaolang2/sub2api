import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentView from '../PaymentView.vue'

const storageValues = new Map<string, string>()
const localStorageMock: Storage = {
  get length() { return storageValues.size },
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(key) ?? null,
  key: (index) => [...storageValues.keys()][index] ?? null,
  removeItem: (key) => { storageValues.delete(key) },
  setItem: (key, value) => { storageValues.set(key, String(value)) }
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock })

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  createOrder: vi.fn(),
  subscriptions: vi.fn(),
  refreshUser: vi.fn()
}))

vi.mock('@shared-api/payment', () => ({
  paymentAPI: { getCheckoutInfo: mocks.checkout, createOrder: mocks.createOrder }
}))
vi.mock('@shared-api/subscriptions', () => ({ getActiveSubscriptions: mocks.subscriptions }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 2, username: 'Nova', email: 'nova@example.test', balance: 42.75 },
    refreshUser: mocks.refreshUser
  })
}))

const checkout = {
  methods: {
    alipay_direct: {
      currency: 'CNY', display_name: '支付宝直连', daily_limit: 10000, daily_used: 800,
      daily_remaining: 9200, single_min: 10, single_max: 5000, fee_rate: 1.2, available: true
    },
    stripe: {
      currency: 'USD', display_name: '国际卡 / Stripe', daily_limit: 0, daily_used: 0,
      daily_remaining: 0, single_min: 5, single_max: 1000, fee_rate: 2.9, available: true
    }
  },
  global_min: 5,
  global_max: 5000,
  plans: [{
    id: 301, group_id: 201, group_platform: 'openai', group_name: 'Production', name: 'Team 月度',
    description: '团队生产套餐', price: 49, original_price: 59, currency: 'USD', validity_days: 1,
    validity_unit: 'month', features: ['优先队列', '共享额度'], for_sale: true, sort_order: 1,
    rate_multiplier: 0.9, peak_rate_enabled: true, peak_start: '14:00', peak_end: '18:00',
    peak_rate_multiplier: 1.2, daily_limit_usd: 3, weekly_limit_usd: 15, monthly_limit_usd: 50,
    supported_model_scopes: ['gpt-*', 'claude-*']
  }],
  balance_disabled: false,
  balance_recharge_multiplier: 1.25,
  subscription_usd_to_cny_rate: 7.2,
  recharge_fee_rate: 2,
  help_text: '支付遇到问题请联系客服',
  help_image_url: 'https://assets.example.test/pay-help.png',
  stripe_publishable_key: 'pk_test_fixture'
}

const statusStub = {
  props: ['orderId', 'amount', 'payAmount', 'qrCode', 'expiresAt', 'paymentType', 'currency', 'outTradeNo'],
  template: '<section class="payment-status-stub">#{{ orderId }} {{ paymentType }} {{ outTradeNo }} {{ qrCode }}</section>'
}

async function mountView(path = '/app/purchase') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app/purchase', component: PaymentView },
      { path: '/app/orders', component: { template: '<div />' } },
      { path: '/app/subscriptions', component: { template: '<div />' } },
      { path: '/payment/result', component: { template: '<div />' } },
      { path: '/payment/stripe', component: { template: '<div />' } },
      { path: '/payment/airwallex', component: { template: '<div />' } }
    ]
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(PaymentView, {
    global: {
      plugins: [router],
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: { template: '<section><slot /></section>' },
        PaymentStatusPanel: statusStub,
        SurfaceDialog: { props: ['show'], template: '<dialog v-if="show" open><slot /></dialog>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('purchase and payment checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.checkout.mockResolvedValue({ data: checkout })
    mocks.subscriptions.mockResolvedValue([])
    mocks.refreshUser.mockResolvedValue(undefined)
    mocks.createOrder.mockResolvedValue({
      data: {
        order_id: 701, amount: 100, pay_amount: 102, fee_rate: 2, payment_type: 'alipay',
        out_trade_no: 'fixture-pay-701', currency: 'CNY', qr_code: 'https://pay.example.test/qr/701',
        payment_mode: 'qrcode', expires_at: '2099-08-18T05:00:00Z'
      }
    })
  })

  it('shows server-defined methods, limits, conversion, fees and creates the exact balance order contract', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('当前余额 $42.75')
    expect(wrapper.text()).toContain('支付宝直连')
    expect(wrapper.text()).toContain('今日剩余 ¥9,200.00')
    expect(wrapper.text()).toContain('充值换算')
    expect(wrapper.text()).toContain('预计到账 $0.00')
    expect(wrapper.text()).toContain('手续费（2%）')
    expect(wrapper.text()).toContain('支付遇到问题请联系客服')

    await wrapper.get('#recharge-amount').setValue(100)
    await wrapper.find('.checkout-summary button').trigger('click')
    await flushPromises()

    expect(mocks.createOrder).toHaveBeenCalledWith({
      amount: 100,
      payment_type: 'alipay',
      order_type: 'balance',
      is_mobile: false,
      payment_source: 'hosted_redirect',
      return_url: 'http://localhost:3000/payment/result'
    })
    expect(wrapper.get('.payment-status-stub').text()).toContain('fixture-pay-701')
    expect(localStorage.getItem('payment.recovery.current')).toContain('fixture-pay-701')
    wrapper.unmount()
  })

  it('resolves a subscription renewal deep link and preserves the plan id in order creation', async () => {
    mocks.createOrder.mockResolvedValue({
      data: {
        order_id: 702, amount: 49, pay_amount: 359.86, fee_rate: 2, payment_type: 'alipay',
        out_trade_no: 'fixture-sub-702', currency: 'CNY', qr_code: 'https://pay.example.test/qr/702',
        payment_mode: 'qrcode', expires_at: '2099-08-18T05:00:00Z'
      }
    })
    const wrapper = await mountView('/app/purchase?tab=subscription&group=201')
    expect(wrapper.text()).toContain('Team 月度')
    expect(wrapper.text()).toContain('高峰倍率')
    expect(wrapper.text()).toContain('gpt-*、claude-*')
    expect(wrapper.text()).toContain('每日额度')
    await wrapper.find('.checkout-summary button').trigger('click')
    await flushPromises()
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      amount: 49,
      payment_type: 'alipay',
      order_type: 'subscription',
      plan_id: 301
    }))
    wrapper.unmount()
  })
})
