import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RedeemView from '../RedeemView.vue'

const api = vi.hoisted(() => ({
  redeem: vi.fn(),
  getHistory: vi.fn(),
  getPublicSettings: vi.fn(),
  refreshUser: vi.fn(),
  fetchActiveSubscriptions: vi.fn()
}))

vi.mock('@shared-api/redeem', () => ({ redeem: api.redeem, getHistory: api.getHistory }))
vi.mock('@shared-api/auth', () => ({ getPublicSettings: api.getPublicSettings }))
vi.mock('@shared-stores/subscriptions', () => ({
  useSubscriptionStore: () => ({ fetchActiveSubscriptions: api.fetchActiveSubscriptions })
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { balance: 16.5, concurrency: 8 },
    refreshUser: api.refreshUser
  })
}))

const history = [
  {
    id: 1,
    code: 'FIXTURE-BALANCE-001',
    type: 'balance',
    value: 12.5,
    status: 'used',
    used_at: '2026-08-18T02:00:00Z',
    created_at: '2026-08-18T02:00:00Z'
  },
  {
    id: 2,
    code: 'ADMIN-BALANCE-001',
    type: 'admin_balance',
    value: -2,
    status: 'used',
    used_at: '2026-08-18T03:00:00Z',
    created_at: '2026-08-18T03:00:00Z',
    notes: '异常账务冲正'
  },
  {
    id: 3,
    code: 'FIXTURE-SUBSCRIPTION-001',
    type: 'subscription',
    value: 30,
    status: 'used',
    used_at: '2026-08-18T04:00:00Z',
    created_at: '2026-08-18T04:00:00Z',
    validity_days: 30,
    group: { id: 201, name: 'Team 月度订阅' }
  }
]

async function mountView() {
  const wrapper = mount(RedeemView, {
    global: {
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('user redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getHistory.mockResolvedValue(history)
    api.getPublicSettings.mockResolvedValue({ contact_info: 'support@example.test' })
    api.refreshUser.mockResolvedValue(undefined)
    api.fetchActiveSubscriptions.mockResolvedValue([])
  })

  it('shows balance, every history type, admin notes, and contact information', async () => {
    const wrapper = await mountView()
    expect(api.getHistory).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('16.50')
    expect(wrapper.text()).toContain('兑换余额')
    expect(wrapper.text()).toContain('管理员扣减余额')
    expect(wrapper.text()).toContain('异常账务冲正')
    expect(wrapper.text()).toContain('Team 月度订阅')
    expect(wrapper.text()).toContain('support@example.test')
    wrapper.unmount()
  })

  it('redeems a subscription once and refreshes account, history, and active subscriptions', async () => {
    api.redeem.mockResolvedValue({
      message: '订阅已发放',
      type: 'subscription',
      value: 30,
      group_name: 'Team 月度订阅',
      validity_days: 30
    })
    const wrapper = await mountView()
    await wrapper.get('#redeem-code').setValue('  FIXTURE-SUB  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.redeem).toHaveBeenCalledTimes(1)
    expect(api.redeem).toHaveBeenCalledWith('FIXTURE-SUB')
    expect(api.refreshUser).toHaveBeenCalledTimes(1)
    expect(api.getHistory).toHaveBeenCalledTimes(2)
    expect(api.fetchActiveSubscriptions).toHaveBeenCalledWith(true)
    expect(wrapper.text()).toContain('订阅已发放')
    expect(wrapper.text()).toContain('Team 月度订阅 · 30 天')
    wrapper.unmount()
  })
})
