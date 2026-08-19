import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AffiliateView from '../AffiliateView.vue'

const api = vi.hoisted(() => ({
  getAffiliateDetail: vi.fn(),
  transferAffiliateQuota: vi.fn(),
  refreshUser: vi.fn(),
  writeText: vi.fn()
}))

vi.mock('@shared-api/user', () => ({
  getAffiliateDetail: api.getAffiliateDetail,
  transferAffiliateQuota: api.transferAffiliateQuota
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ refreshUser: api.refreshUser })
}))

const detail = {
  user_id: 2,
  aff_code: 'YOUTH88',
  inviter_id: null,
  aff_count: 2,
  aff_quota: 8.25,
  aff_frozen_quota: 1.2,
  aff_history_quota: 28.5,
  effective_rebate_rate_percent: 12.5,
  invitees: [{
    user_id: 31,
    email: 'invitee@example.test',
    username: '被邀请用户',
    created_at: '2026-08-10T06:00:00Z',
    total_rebate: 4.75
  }]
}

async function mountView() {
  const wrapper = mount(AffiliateView, {
    global: {
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: { props: ['loading', 'error'], template: '<section><slot /></section>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('user affiliate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getAffiliateDetail.mockResolvedValue(detail)
    api.transferAffiliateQuota.mockResolvedValue({ transferred_quota: 8.25, balance: 50 })
    api.refreshUser.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: api.writeText }
    })
    api.writeText.mockResolvedValue(undefined)
  })

  it('renders the effective rate, all balance states, invitation assets, and invitees', async () => {
    const wrapper = await mountView()
    expect(api.getAffiliateDetail).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('12.5%')
    expect(wrapper.text()).toContain('YOUTH88')
    expect(wrapper.text()).toContain('冻结')
    expect(wrapper.text()).toContain('被邀请用户')
    expect(wrapper.text()).toContain('invitee@example.test')
    const copyButtons = wrapper.findAll('.invite-values button')
    await copyButtons[1]!.trigger('click')
    await flushPromises()
    expect(api.writeText).toHaveBeenCalledWith(expect.stringContaining('/register?aff=YOUTH88'))
    expect(wrapper.text()).toContain('邀请链接已复制')
    wrapper.unmount()
  })

  it('transfers the complete available rebate and refreshes both detail and account', async () => {
    const wrapper = await mountView()
    await wrapper.get('.invite-card > header button').trigger('click')
    await flushPromises()
    expect(api.transferAffiliateQuota).toHaveBeenCalledTimes(1)
    expect(api.getAffiliateDetail).toHaveBeenCalledTimes(2)
    expect(api.refreshUser).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('返利转入账户余额')
    wrapper.unmount()
  })
})
