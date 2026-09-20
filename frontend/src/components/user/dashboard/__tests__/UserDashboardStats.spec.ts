import { describe, it, expect } from 'vitest'
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

function period(usage = 0, rangeLabel = '') {
  return { users: usage > 0 ? 1 : 0, usage, ranking: usage > 0 ? [{ name: '文案 A', usage }] : [], error: '', rangeLabel }
}
function mountStats(periodStats = { today: period(), week: period(), month: period() }) {
  return mount(UserDashboardStats, { props: {
    stats: makeStats(), loading: false, periodLoading: false, error: '', periodStats,
  } })
}

describe('UserDashboardStats release dashboard after upstream merge', () => {
  it('retains paired period metrics and all three rankings without reintroducing platform or spending cards', () => {
    const wrapper = mountStats({ today: period(2_500_000), week: period(120_000_000), month: period(250_000_000) })
    expect(wrapper.findAll('.dashboard-period-card')).toHaveLength(3)
    const rankings = wrapper.findAll('.dashboard-ranking-card')
    expect(rankings.map((card) => card.get('h3').text())).toEqual(['当天 Top 3', '当周 Top 3', '当月 Top 3'])
    expect(rankings[0].get('li').text()).toContain('文案 A2.5 百万 Tokens')
    expect(rankings[1].get('li').text()).toContain('文案 A1.2 亿 Tokens')
    for (const removed of ['今日消费', '余额', '按平台拆分', '平均响应']) expect(wrapper.text()).not.toContain(removed)
    wrapper.unmount()
  })
  it('shows the platform usage heading and dynamic period descriptions', () => {
    const wrapper = mountStats({
      today: period(1, '当天（2026-09-19）'),
      week: period(2, '第38周（2026-09-14 到 2026-09-19）'),
      month: period(3, '九月（2026-09-01 到 2026-09-30）'),
    })
    expect(wrapper.text()).toContain('平台功能使用情况')
    expect(wrapper.text()).toContain('第38周（2026-09-14 到 2026-09-19）')
    expect(wrapper.text()).toContain('九月（2026-09-01 到 2026-09-30）')
    wrapper.unmount()
  })
  it('does not flash empty rankings while period data is loading', () => {
    const wrapper = mount(UserDashboardStats, { props: {
      stats: makeStats(), loading: false, periodLoading: true, error: '',
      periodStats: { today: period(), week: period(), month: period() },
    } })
    expect(wrapper.findAll('.dashboard-ranking-card')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('暂无有效 Token 使用')
    wrapper.unmount()
  })
  it('keeps zero periods and empty rankings visible', () => {
    const wrapper = mountStats()
    expect(wrapper.findAll('.dashboard-period-card')).toHaveLength(3)
    expect(wrapper.findAll('.dashboard-ranking-state')).toHaveLength(3)
    expect(wrapper.findAll('.dashboard-ranking-card li')).toHaveLength(0)
    wrapper.unmount()
  })
  it('preserves period failure messages instead of inventing ranking entries', () => {
    const failed = { ...period(), error: '查询失败' }
    const wrapper = mountStats({ today: failed, week: period(), month: period() })
    expect(wrapper.get('.dashboard-ranking-card [role="alert"]').text()).toBe('查询失败')
    wrapper.unmount()
  })
})
