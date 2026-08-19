import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardView from '../DashboardView.vue'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getStats: vi.fn(),
  getRealtimeMetrics: vi.fn(),
  getSnapshotV2: vi.fn(),
  getUserSpendingRanking: vi.fn(),
  getUserBreakdown: vi.fn(),
  getApiKeyUsageTrend: vi.fn(),
  getUserUsageTrend: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@shared-api/admin/dashboard', () => {
  const dashboard = {
    getStats: mocks.getStats,
    getRealtimeMetrics: mocks.getRealtimeMetrics,
    getSnapshotV2: mocks.getSnapshotV2,
    getUserSpendingRanking: mocks.getUserSpendingRanking,
    getUserBreakdown: mocks.getUserBreakdown,
    getApiKeyUsageTrend: mocks.getApiKeyUsageTrend,
    getUserUsageTrend: mocks.getUserUsageTrend,
  }
  return { ...dashboard, default: dashboard }
})

describe('admin dashboard parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStats.mockResolvedValue({
      total_users: 20,
      today_new_users: 2,
      today_requests: 300,
      total_requests: 9000,
      today_actual_cost: 12.5,
      normal_accounts: 8,
      total_accounts: 10,
      rpm: 12,
      tpm: 4200,
      average_duration_ms: 340,
      stats_stale: false,
    })
    mocks.getRealtimeMetrics.mockResolvedValue({ active_requests: 3, requests_per_minute: 18, average_response_time: 320, error_rate: 0.01 })
    mocks.getSnapshotV2.mockResolvedValue({ trend: [], models: [], groups: [] })
    mocks.getUserSpendingRanking.mockResolvedValue({ ranking: [] })
    mocks.getUserBreakdown.mockResolvedValue({ users: [] })
    mocks.getApiKeyUsageTrend.mockResolvedValue({ trend: [] })
    mocks.getUserUsageTrend.mockResolvedValue({
      trend: [
        { date: '2026-08-17', user_id: 7, email: 'user@example.test', username: 'Lin', requests: 4, tokens: 120, cost: 0.3, actual_cost: 0.2 },
        { date: '2026-08-18', user_id: 7, email: 'user@example.test', username: 'Lin', requests: 6, tokens: 240, cost: 0.5, actual_cost: 0.4 },
      ],
    })
  })

  it('loads and renders the legacy top-user time trend with usage drill-down', async () => {
    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          ConsoleShell: { template: '<div><slot /></div>' },
          PageState: { template: '<section><slot /></section>' },
        },
      },
    })
    await flushPromises()

    expect(mocks.getUserUsageTrend).toHaveBeenCalledWith(expect.objectContaining({ granularity: 'day', limit: 12 }))
    expect(wrapper.text()).toContain('近期用户趋势 · Top 12')
    expect(wrapper.text()).toContain('Lin')
    expect(wrapper.findAll('.admin-user-trend__bars i')).toHaveLength(2)

    await wrapper.find('.admin-user-trend .resource-link').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({
      path: '/admin/usage',
      query: expect.objectContaining({ user_id: '7' }),
    }))
    wrapper.unmount()
  })
})
