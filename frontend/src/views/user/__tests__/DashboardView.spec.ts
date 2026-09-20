import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity } from '@/api/usageBoard'
import DashboardView from '../DashboardView.vue'

const api = vi.hoisted(() => ({
  getDashboardStats: vi.fn(),
  getUsageBoard: vi.fn()
}))
const auth = vi.hoisted(() => ({ refreshUser: vi.fn() }))

vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/api/usage', () => ({ usageAPI: { getDashboardStats: api.getDashboardStats } }))
vi.mock('@/api/usageBoard', async () => ({
  ...(await vi.importActual<typeof import('@/api/usageBoard')>('@/api/usageBoard')),
  getUsageBoard: api.getUsageBoard
}))

function board(granularity: UsageBoardGranularity) {
  const monthly = granularity === UsageBoardGranularity.MONTH
  const start = monthly ? '2026-09-01' : '2026-09-14'
  const end = monthly ? '2026-09-30' : '2026-09-19'
  return {
    granularity,
    timezone: 'Asia/Taipei',
    start_date: start,
    end_date: end,
    periods: [{ start, end: monthly ? end : '2026-09-20', label: start, coverage: monthly ? UsageBoardCoverage.FULL : UsageBoardCoverage.PARTIAL }],
    series: [{
      api_key_id: 1,
      api_key_name: '文案 A',
      points: [{ period_start: start, total_tokens: 120, record_count: 1, data_state: UsageBoardDataState.OBSERVED }]
    }],
    rows: [],
    pagination: { page: 1, page_size: 1000, total: 1, pages: 1 }
  }
}

describe('user dashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 19, 15, 0))
    vi.clearAllMocks()
    auth.refreshUser.mockResolvedValue(undefined)
    api.getDashboardStats.mockResolvedValue({
      total_api_keys: 1,
      usage_board: { users: 1, total_tokens: 120, ranking: [{ api_key_id: 1, api_key_name: '文案 A', total_tokens: 120 }] },
    })
    api.getUsageBoard.mockImplementation((_scope, query) => Promise.resolve(board(query.granularity)))
  })

  afterEach(() => { vi.useRealTimers() })

  it('loads week and month trends plus the cumulative summary without a today query', async () => {
    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          AppLayout: { template: '<main><slot /></main>' },
          LoadingSpinner: true,
          UserDashboardStats: {
            props: ['periodStats', 'stats'],
            template: '<section class="stats">{{ periodStats.week.rangeLabel }} {{ periodStats.month.rangeLabel }} 累计 {{ stats.usage_board.users }}</section>',
          },
          UserDashboardTrends: {
            props: ['trends'],
            template: '<section class="trends">周看板趋势 {{ trends.week.points.length }} 月看板趋势 {{ trends.month.points.length }}</section>'
          }
        }
      }
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('快捷操作')
    expect(wrapper.text()).toContain('周看板趋势 1')
    expect(wrapper.text()).toContain('月看板趋势 1')
    expect(wrapper.text()).toContain('第38周（2026-09-14 到 2026-09-19）')
    expect(wrapper.text()).toContain('九月（2026-09-01 到 2026-09-30）')
    expect(wrapper.text()).toContain('累计 1')
    expect(api.getUsageBoard).toHaveBeenCalledTimes(2)
    expect(api.getUsageBoard).toHaveBeenCalledWith('self', expect.objectContaining({
      granularity: 'week', start_date: '2026-08-24', end_date: '2026-09-19'
    }))
    expect(api.getUsageBoard).toHaveBeenCalledWith('self', expect.objectContaining({
      granularity: 'month', start_month: '2026-07', end_month: '2026-09'
    }))
    expect(api.getUsageBoard).not.toHaveBeenCalledWith('self', expect.objectContaining({ granularity: 'day' }))
    wrapper.unmount()
  })
})
