import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaymentOrder } from '@/types/payment'
import UserOrdersView from '../UserOrdersView.vue'

const api = vi.hoisted(() => ({
  getMyOrders: vi.fn(),
  getRefundEligibleProviders: vi.fn(),
  cancelOrder: vi.fn(),
  requestRefund: vi.fn(),
  getPublicSettings: vi.fn()
}))

vi.mock('@shared-api/payment', () => ({
  paymentAPI: {
    getMyOrders: api.getMyOrders,
    getRefundEligibleProviders: api.getRefundEligibleProviders,
    cancelOrder: api.cancelOrder,
    requestRefund: api.requestRefund
  }
}))
vi.mock('@shared-api/auth', () => ({ getPublicSettings: api.getPublicSettings }))

const pendingOrder = {
  id: 501,
  user_id: 2,
  amount: 20,
  pay_amount: 144,
  currency: 'CNY',
  fee_rate: 2,
  payment_type: 'alipay',
  out_trade_no: 'fixture-pending-501',
  status: 'PENDING',
  order_type: 'balance',
  created_at: '2026-08-18T01:00:00Z',
  expires_at: '2026-08-18T01:30:00Z',
  refund_amount: 0,
  provider_instance_id: 'ali-primary'
} as PaymentOrder

const completedOrder = {
  ...pendingOrder,
  id: 502,
  amount: 49,
  pay_amount: 49,
  currency: 'USD',
  fee_rate: 0,
  payment_type: 'stripe',
  out_trade_no: 'fixture-completed-502',
  status: 'COMPLETED',
  order_type: 'subscription',
  plan_id: 301,
  completed_at: '2026-08-17T02:00:00Z',
  provider_instance_id: 'stripe-primary'
} as PaymentOrder

const dialogStub = {
  props: ['show', 'title', 'description', 'width'],
  emits: ['close'],
  template: '<section v-if="show" class="dialog-stub" :data-title="title"><slot /><footer><slot name="footer" /></footer></section>'
}

async function mountView() {
  const wrapper = mount(UserOrdersView, {
    global: {
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: { props: ['loading', 'error'], template: '<section><slot /></section>' },
        SurfaceDialog: dialogStub,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('user orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getPublicSettings.mockResolvedValue({ table_default_page_size: 20, table_page_size_options: [10, 20, 50] })
    api.getRefundEligibleProviders.mockResolvedValue({ data: { provider_instance_ids: ['stripe-primary'] } })
    api.getMyOrders.mockResolvedValue({ data: { items: [pendingOrder, completedOrder], total: 41, page: 1, page_size: 20, pages: 3 } })
    api.cancelOrder.mockResolvedValue({ data: {} })
    api.requestRefund.mockResolvedValue({ data: {} })
  })

  it('renders complete order fields, details, refund eligibility, and a pending payment recovery link', async () => {
    const wrapper = await mountView()
    expect(api.getMyOrders).toHaveBeenCalledWith({ page: 1, page_size: 20, status: undefined })
    expect(wrapper.text()).toContain('fixture-pending-501')
    expect(wrapper.text()).toContain('余额充值')
    expect(wrapper.text()).toContain('订阅套餐')
    expect(wrapper.text()).toContain('支付宝')
    expect(wrapper.text()).toContain('Stripe')
    expect(wrapper.find('a[href="/payment/result?order_id=501&status=pending"]').exists()).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === '申请退款')).toBe(true)
    await wrapper.findAll('.order-link')[1]!.trigger('click')
    expect(wrapper.find('[data-title="订单详情"]').text()).toContain('计划 #301')
    wrapper.unmount()
  })

  it('uses service-side status/pagination and executes confirmed cancel and reasoned refund flows', async () => {
    const wrapper = await mountView()
    await wrapper.get('select[aria-label="订单状态"]').setValue('COMPLETED')
    await flushPromises()
    expect(api.getMyOrders).toHaveBeenLastCalledWith({ page: 1, page_size: 20, status: 'COMPLETED' })

    await wrapper.findAll('.row-actions button').find((button) => button.text() === '取消')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '确认取消')!.trigger('click')
    await flushPromises()
    expect(api.cancelOrder).toHaveBeenCalledWith(501)

    await wrapper.findAll('.row-actions button').find((button) => button.text() === '申请退款')!.trigger('click')
    await wrapper.get('#refund-reason').setValue('未使用套餐，申请原路退回')
    await wrapper.findAll('button').find((button) => button.text() === '提交退款申请')!.trigger('click')
    await flushPromises()
    expect(api.requestRefund).toHaveBeenCalledWith(502, { reason: '未使用套餐，申请原路退回' })

    await wrapper.findAll('button').find((button) => button.text() === '下一页')!.trigger('click')
    await flushPromises()
    expect(api.getMyOrders).toHaveBeenLastCalledWith({ page: 2, page_size: 20, status: 'COMPLETED' })
    wrapper.unmount()
  })
})
