import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentResultView from '../PaymentResultView.vue'

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
  resolve: vi.fn(),
  getOrder: vi.fn(),
  verify: vi.fn(),
  verifyPublic: vi.fn()
}))

vi.mock('@shared-api/payment', () => ({
  paymentAPI: {
    resolveOrderPublicByResumeToken: mocks.resolve,
    getOrder: mocks.getOrder,
    verifyOrder: mocks.verify,
    verifyOrderPublic: mocks.verifyPublic
  }
}))

async function mountView(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payment/result', component: PaymentResultView },
      { path: '/app/orders', component: { template: '<div />' } },
      { path: '/app/purchase', component: { template: '<div />' } }
    ]
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(PaymentResultView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('PaymentResultView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.resolve.mockRejectedValue(new Error('not found'))
    mocks.getOrder.mockRejectedValue(new Error('not found'))
    mocks.verify.mockRejectedValue(new Error('not found'))
    mocks.verifyPublic.mockRejectedValue(new Error('not found'))
  })

  it('resolves a public signed token without requiring an authenticated order lookup', async () => {
    mocks.resolve.mockResolvedValue({ data: {
      out_trade_no: 'public-801', status: 'COMPLETED', paid: true,
      created_at: '2026-08-18T01:00:00Z', expires_at: '2026-08-18T01:30:00Z'
    } })
    const wrapper = await mountView('/payment/result?resume_token=signed-token')
    expect(mocks.resolve).toHaveBeenCalledWith('signed-token')
    expect(wrapper.text()).toContain('支付成功')
    expect(wrapper.text()).toContain('public-801')
    wrapper.unmount()
  })

  it('restores an authenticated detailed order and offers immediate refresh while pending', async () => {
    const pending = {
      id: 802, user_id: 2, amount: 49, pay_amount: 49, currency: 'USD', fee_rate: 0,
      payment_type: 'stripe', out_trade_no: 'detail-802', status: 'PENDING', order_type: 'subscription',
      plan_id: 301, created_at: '2026-08-18T01:00:00Z', expires_at: '2099-08-18T01:30:00Z', refund_amount: 0
    }
    mocks.getOrder.mockResolvedValue({ data: pending })
    const wrapper = await mountView('/payment/result?order_id=802')
    expect(wrapper.text()).toContain('支付处理中')
    expect(wrapper.text()).toContain('detail-802')
    await wrapper.findAll('button').find((button) => button.text() === '立即查询状态')!.trigger('click')
    await flushPromises()
    expect(mocks.getOrder).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
