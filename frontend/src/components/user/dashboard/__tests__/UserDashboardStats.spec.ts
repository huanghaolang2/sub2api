import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UserDashboardStats from '../UserDashboardStats.vue'
import type { UserDashboardStats as UserStatsType } from '@/api/usage'

function makeStats(over: Partial<UserStatsType> = {}): UserStatsType {
  return {
    total_api_keys: 1,
    active_api_keys: 1,
    total_requests: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_creation_tokens: 0,
    total_cache_read_tokens: 0,
    total_tokens: 0,
    total_cost: 0,
    total_actual_cost: 0,
    usage_board: { users: 0, total_tokens: 0, ranking: [] },
    today_requests: 0,
    today_input_tokens: 0,
    today_output_tokens: 0,
    today_cache_creation_tokens: 0,
    today_cache_read_tokens: 0,
    today_tokens: 0,
    today_cost: 0,
    today_actual_cost: 0,
    average_duration_ms: 0,
    rpm: 0,
    tpm: 0,
    by_platform: [],
    ...over,
  }
}

function ranking(count: number, start = count) {
  return Array.from({ length: count }, (_, index) => ({ name: `文案 ${index + 1}`, usage: start - index }))
}

function period(usage = 0, rangeLabel = '', rankingCount = usage > 0 ? 1 : 0) {
  return { users: usage > 0 ? Math.max(1, rankingCount) : 0, usage, ranking: ranking(rankingCount, usage), error: '', rangeLabel }
}

function mountStats(options: {
  stats?: UserStatsType
  periodStats?: { week: ReturnType<typeof period>; month: ReturnType<typeof period> }
  periodLoading?: boolean
} = {}) {
  return mount(UserDashboardStats, { props: {
    stats: options.stats ?? makeStats(),
    loading: false,
    periodLoading: options.periodLoading ?? false,
    error: '',
    periodStats: options.periodStats ?? { week: period(), month: period() },
  } })
}

describe('UserDashboardStats', () => {
  it('shows week, month, and lifetime Top 10 cards in one ranking grid', () => {
    const wrapper = mountStats({
      periodStats: {
        week: period(120, '第38周（2026-09-14 到 2026-09-19）'),
        month: period(240, '九月（2026-09-01 到 2026-09-30）'),
      },
    })
    expect(wrapper.get('#dashboard-ranking-title').text()).toBe('Token 用量排行')
    expect(wrapper.find('.dashboard-period-board').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('当天使用')
    expect(wrapper.text()).toContain('第38周（2026-09-14 到 2026-09-19）')
    expect(wrapper.text()).toContain('所有时间')
    expect(wrapper.get('.dashboard-ranking-grid').findAll('h3').map((heading) => heading.text())).toEqual([
      '当周使用 Top 10',
      '当月使用 Top 10',
      '累计看板 Top 10',
    ])
    wrapper.unmount()
  })

  it('removes the summary metric boards and keeps cumulative ranking data', () => {
    const wrapper = mountStats({
      stats: makeStats({
        usage_board: {
          users: 12,
          total_tokens: 987_000_000,
          ranking: [{ api_key_id: 1, api_key_name: '累计文案', total_tokens: 987_000_000 }],
        },
      }),
      periodStats: { week: period(2_500_000), month: period(120_000_000) },
    })
    expect(wrapper.find('.dashboard-period-metric').exists()).toBe(false)
    expect(wrapper.findAll('.dashboard-ranking-card')).toHaveLength(3)
    expect(wrapper.findAll('.dashboard-ranking-card')[2].text()).toContain('累计文案')
    expect(wrapper.findAll('.dashboard-ranking-card')[2].text()).toContain('9.87 亿 Tokens')
    wrapper.unmount()
  })

  it('renders at most ten ranked API keys for every board', () => {
    const cumulativeRanking = Array.from({ length: 10 }, (_, index) => ({
      api_key_id: index + 1,
      api_key_name: `累计 ${index + 1}`,
      total_tokens: 100 - index,
    }))
    const wrapper = mountStats({
      stats: makeStats({ usage_board: { users: 10, total_tokens: 955, ranking: cumulativeRanking } }),
      periodStats: { week: period(200, '本周', 12), month: period(100, '本月', 10) },
    })
    const rankings = wrapper.findAll('.dashboard-ranking-card')
    expect(rankings).toHaveLength(3)
    expect(rankings.every((board) => board.text().includes('Top 10'))).toBe(true)
    expect(rankings[0].findAll('li')).toHaveLength(10)
    expect(rankings[1].findAll('li')).toHaveLength(10)
    expect(rankings[2].findAll('li')).toHaveLength(10)
    expect(rankings[2].text()).toContain('累计 10')
    wrapper.unmount()
  })

  it('keeps the lifetime board available while week and month data load', () => {
    const wrapper = mountStats({
      stats: makeStats({ usage_board: { users: 1, total_tokens: 20, ranking: [{ api_key_id: 1, api_key_name: '累计文案', total_tokens: 20 }] } }),
      periodLoading: true,
    })
    expect(wrapper.findAll('.dashboard-ranking-card')).toHaveLength(3)
    expect(wrapper.findAll('.dashboard-ranking-loading')).toHaveLength(2)
    expect(wrapper.text()).toContain('累计文案')
    expect(wrapper.text()).not.toContain('暂无有效 Token 使用')
    wrapper.unmount()
  })

  it('keeps zero boards and independent period failures explicit', () => {
    const failed = { ...period(), error: '周统计查询失败' }
    const wrapper = mountStats({ periodStats: { week: failed, month: period() } })
    expect(wrapper.get('[role="alert"]').text()).toBe('周统计查询失败')
    expect(wrapper.findAll('.dashboard-ranking-state')).toHaveLength(3)
    expect(wrapper.findAll('.dashboard-ranking-card li')).toHaveLength(0)
    wrapper.unmount()
  })
})
