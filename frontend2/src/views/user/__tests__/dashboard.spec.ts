import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardView from '../DashboardView.vue'

const api = vi.hoisted(() => ({
  getDashboardStats: vi.fn(),
  getDashboardTrend: vi.fn(),
  getDashboardModels: vi.fn(),
  queryUsage: vi.fn(),
  getMyPlatformQuotas: vi.fn(),
  listKeys: vi.fn()
}))

const auth = vi.hoisted(() => ({
  user: {
    username: 'dashboard-user',
    email: 'user@example.test',
    status: 'active',
    balance: 42.75,
    concurrency: 12
  },
  isAdmin: false,
  isSimpleMode: false,
  refreshUser: vi.fn()
}))

vi.mock('@shared-api/usage', () => ({
  getDashboardStats: api.getDashboardStats,
  getDashboardTrend: api.getDashboardTrend,
  getDashboardModels: api.getDashboardModels,
  query: api.queryUsage
}))
vi.mock('@shared-api/user', () => ({ getMyPlatformQuotas: api.getMyPlatformQuotas }))
vi.mock('@shared-api/keys', () => ({ list: api.listKeys }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))

const stats = {
  total_api_keys: 3,
  active_api_keys: 2,
  total_requests: 120,
  total_input_tokens: 800,
  total_output_tokens: 200,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
  total_tokens: 1000,
  total_cost: 12,
  total_actual_cost: 10,
  today_requests: 24,
  today_input_tokens: 160,
  today_output_tokens: 40,
  today_cache_creation_tokens: 0,
  today_cache_read_tokens: 0,
  today_tokens: 200,
  today_cost: 2.4,
  today_actual_cost: 2,
  average_duration_ms: 420,
  rpm: 5,
  tpm: 600,
  by_platform: [{
    platform: 'openai', total_requests: 100, total_tokens: 900, total_actual_cost: 6,
    today_requests: 20, today_tokens: 180, today_actual_cost: 1.5
  }]
}

const pageStateStub = {
  props: ['loading', 'error'],
  emits: ['retry'],
  template: '<section><slot /></section>'
}
const toolbarStub = {
  emits: ['refresh'],
  template: '<button class="dashboard-refresh" type="button" @click="$emit(\'refresh\')">刷新</button>'
}
const routerLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>'
}

async function mountView() {
  const wrapper = mount(DashboardView, {
    global: {
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: pageStateStub,
        DashboardToolbar: toolbarStub,
        DashboardScopeSwitch: true,
        DashboardMetricGrid: true,
        DashboardTrendPanel: true,
        DashboardModelPanel: true,
        DashboardRecentUsage: true,
        DashboardModelTable: true,
        RouterLink: routerLinkStub
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('user dashboard parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.isAdmin = false
    auth.isSimpleMode = false
    auth.refreshUser.mockResolvedValue(auth.user)
    api.getDashboardStats.mockResolvedValue(stats)
    api.getDashboardTrend.mockResolvedValue({ trend: [], start_date: '2026-08-12', end_date: '2026-08-18', granularity: 'day' })
    api.getDashboardModels.mockResolvedValue({ models: [], start_date: '2026-08-12', end_date: '2026-08-18' })
    api.queryUsage.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 5, pages: 0 })
    api.getMyPlatformQuotas.mockResolvedValue({
      platform_quotas: [
        {
          platform: 'openai', daily_limit_usd: 10, weekly_limit_usd: 50, monthly_limit_usd: 180,
          daily_usage_usd: 1.8, weekly_usage_usd: 9.4, monthly_usage_usd: 28.2,
          daily_window_resets_at: '2026-08-19T00:00:00Z'
        },
        {
          platform: 'gemini', daily_limit_usd: 0, weekly_limit_usd: null, monthly_limit_usd: null,
          daily_usage_usd: 0, weekly_usage_usd: 0, monthly_usage_usd: 0
        }
      ]
    })
    api.listKeys.mockResolvedValue({
      items: [{ id: 702, key: 'sk-gemini', name: 'Gemini', status: 'active', group: { platform: 'gemini', allow_batch_image_generation: true } }],
      total: 1, page: 1, page_size: 100, pages: 1
    })
  })

  it('loads the complete dashboard contract and restores platform quotas and quick actions', async () => {
    const wrapper = await mountView()

    expect(auth.refreshUser).toHaveBeenCalledTimes(1)
    expect(api.getDashboardStats).toHaveBeenCalledTimes(1)
    expect(api.getDashboardTrend).toHaveBeenCalledWith(expect.objectContaining({ granularity: 'day' }))
    expect(api.getDashboardModels).toHaveBeenCalledWith(expect.objectContaining({ start_date: expect.any(String), end_date: expect.any(String) }))
    expect(api.queryUsage).toHaveBeenCalledWith(expect.objectContaining({ page_size: 5, sort_by: 'created_at', sort_order: 'desc' }), expect.anything())
    expect(api.getMyPlatformQuotas).toHaveBeenCalledTimes(1)
    expect(api.listKeys).toHaveBeenCalledWith(1, 100, expect.objectContaining({ status: 'active' }))

    expect(wrapper.text()).toContain('平台用量')
    expect(wrapper.text()).toContain('OpenAI')
    expect(wrapper.text()).toContain('其他 / 未归属')
    expect(wrapper.text()).toContain('已停用')
    expect(wrapper.text()).toContain('$1.80 / $10.00')
    expect(wrapper.text()).toContain('批量图片')
    expect(wrapper.text()).toContain('兑换码')
    expect(wrapper.find('a[href="/app/batch-image"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/app/redeem"]').exists()).toBe(true)

    await wrapper.find('.dashboard-refresh').trigger('click')
    await flushPromises()
    expect(api.getDashboardStats).toHaveBeenCalledTimes(2)
    expect(api.getMyPlatformQuotas).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('keeps simple mode restricted while retaining the API key path', async () => {
    auth.isSimpleMode = true
    const wrapper = await mountView()

    expect(wrapper.text()).not.toContain('平台用量')
    expect(wrapper.text()).not.toContain('可用余额')
    expect(wrapper.text()).not.toContain('查看用量明细')
    expect(wrapper.text()).not.toContain('批量图片')
    expect(wrapper.text()).not.toContain('兑换码')
    expect(wrapper.find('a[href="/app/keys"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
