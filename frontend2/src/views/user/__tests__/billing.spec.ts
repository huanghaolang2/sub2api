import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserSubscription } from '@/types'
import BillingView from '../BillingView.vue'

const api = vi.hoisted(() => ({ getMySubscriptions: vi.fn() }))
vi.mock('@shared-api/subscriptions', () => ({ getMySubscriptions: api.getMySubscriptions }))

const item = {
  id: 901, user_id: 2, group_id: 201, status: 'active', starts_at: '2026-08-01T00:00:00Z',
  expires_at: '2026-09-01T00:00:00Z', daily_usage_usd: 1.2, weekly_usage_usd: 5.6,
  monthly_usage_usd: 17.4, daily_window_start: '2026-08-18T00:00:00Z',
  weekly_window_start: '2026-08-17T00:00:00Z', monthly_window_start: '2026-08-01T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-18T00:00:00Z',
  group: {
    id: 201, name: 'Team 月度订阅', description: '团队生产额度', platform: 'openai', rate_multiplier: 0.9,
    daily_limit_usd: 3, weekly_limit_usd: 15, monthly_limit_usd: 50,
    peak_rate_enabled: true, peak_start: '14:00', peak_end: '18:00', peak_rate_multiplier: 1.2
  }
} as UserSubscription

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app/subscriptions', component: BillingView },
      { path: '/app/purchase', component: { template: '<div />' } },
      { path: '/app/orders', component: { template: '<div />' } }
    ]
  })
  await router.push('/app/subscriptions')
  await router.isReady()
  const wrapper = mount(BillingView, {
    global: {
      plugins: [createPinia(), router],
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: { props: ['loading', 'error'], template: '<section><slot /></section>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('user subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getMySubscriptions.mockResolvedValue([item])
  })

  it('renders status, multiplier, expiry, every quota window, and renewal deep link', async () => {
    const wrapper = await mountView()
    expect(api.getMySubscriptions).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Team 月度订阅')
    expect(wrapper.text()).toContain('生效中')
    expect(wrapper.text()).toContain('×0.9')
    expect(wrapper.text()).toContain('高峰倍率 14:00-18:00 ×1.2')
    expect(wrapper.text()).toContain('每日额度')
    expect(wrapper.text()).toContain('每周额度')
    expect(wrapper.text()).toContain('每月额度')
    expect(wrapper.find('a[href="/app/purchase?tab=subscription&group=201"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('exposes an actionable empty state without inventing a subscription', async () => {
    api.getMySubscriptions.mockResolvedValue([])
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('当前没有订阅记录')
    expect(wrapper.find('a[href="/app/purchase?tab=subscription"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
