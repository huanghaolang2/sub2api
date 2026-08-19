import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentStatusPanel from '../PaymentStatusPanel.vue'

const mocks = vi.hoisted(() => ({
  getOrder: vi.fn(),
  verifyOrder: vi.fn(),
  cancelOrder: vi.fn(),
  toDataURL: vi.fn()
}))

vi.mock('@shared-api/payment', () => ({
  paymentAPI: { getOrder: mocks.getOrder, verifyOrder: mocks.verifyOrder, cancelOrder: mocks.cancelOrder }
}))
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.toDataURL } }))

function order(status = 'PENDING') {
  return {
    id: 701, user_id: 2, amount: 100, pay_amount: 102, currency: 'CNY', fee_rate: 2,
    payment_type: 'alipay', out_trade_no: 'fixture-pay-701', status, order_type: 'balance',
    created_at: '2026-08-18T01:00:00Z', expires_at: '2099-08-18T01:30:00Z', refund_amount: 0
  }
}

function mountPanel() {
  return mount(PaymentStatusPanel, {
    props: {
      orderId: 701,
      amount: 100,
      payAmount: 102,
      qrCode: 'https://pay.example.test/qr/701',
      expiresAt: '2099-08-18T01:30:00Z',
      paymentType: 'alipay_direct',
      currency: 'CNY',
      outTradeNo: 'fixture-pay-701'
    }
  })
}

describe('PaymentStatusPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.toDataURL.mockResolvedValue('data:image/png;base64,fixture')
    mocks.getOrder.mockResolvedValue({ data: order() })
    mocks.verifyOrder.mockResolvedValue({ data: order() })
    mocks.cancelOrder.mockResolvedValue({ data: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders a provider QR and requires a second action before cancelling', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(mocks.toDataURL).toHaveBeenCalledWith('https://pay.example.test/qr/701', expect.any(Object))
    expect(wrapper.get('img[alt="支付二维码"]').attributes('src')).toContain('data:image/png')
    await wrapper.get('.cancel-button').trigger('click')
    expect(mocks.cancelOrder).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('取消后不可恢复')
    const confirm = wrapper.findAll('.cancel-confirm button').find((button) => button.text() === '确认取消')!
    await confirm.trigger('click')
    await flushPromises()
    expect(mocks.cancelOrder).toHaveBeenCalledWith(701)
    expect(wrapper.emitted('settled')?.[0]).toEqual(['cancelled'])
    wrapper.unmount()
  })

  it('polls the shared order API and emits success on a terminal paid state', async () => {
    mocks.getOrder.mockResolvedValue({ data: order('COMPLETED') })
    const wrapper = mountPanel()
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
    expect(mocks.getOrder).toHaveBeenCalledWith(701)
    expect(wrapper.emitted('success')).toHaveLength(1)
    expect(wrapper.text()).toContain('支付成功')
    wrapper.unmount()
  })
})
