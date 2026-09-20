import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UserDashboardTrends from '../UserDashboardTrends.vue'
import type { DashboardTrendSeries } from '../dashboardTrends'

function trend(prefix: string, values: number[]): DashboardTrendSeries {
  return {
    error: '',
    points: values.map((usage, index) => ({
      key: `${prefix}-${index}`,
      label: `${index + 1}期`,
      start: `2026-0${index + 1}-01`,
      end: `2026-0${index + 1}-28`,
      users: index + 1,
      usage
    }))
  }
}

describe('UserDashboardTrends', () => {
  it('renders both restrained trend boards with finite chart geometry', () => {
    const wrapper = mount(UserDashboardTrends, {
      props: {
        loading: false,
        trends: {
          week: trend('week', [1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 6_000_000]),
          month: trend('month', [6_000_000, 5_000_000, 4_000_000, 3_000_000, 2_000_000, 1_000_000])
        }
      }
    })

    expect(wrapper.findAll('.dashboard-trend-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('周看板趋势')
    expect(wrapper.text()).toContain('月看板趋势')
    expect(wrapper.text()).toContain('6 人')
    expect(wrapper.text()).toContain('较首期 +5')
    expect(wrapper.text()).toContain('较首期 −5 百万')
    for (const chart of wrapper.findAll('.dashboard-trend-plot polyline')) {
      expect(chart.attributes('points')).not.toMatch(/NaN|Infinity/)
    }
    wrapper.unmount()
  })

  it('keeps one failed board independent from the successful board', () => {
    const wrapper = mount(UserDashboardTrends, {
      props: {
        loading: false,
        trends: {
          week: { points: [], error: '周统计加载失败' },
          month: trend('month', [0, 0, 0, 0, 0, 0])
        }
      }
    })

    expect(wrapper.get('[role="alert"]').text()).toBe('周统计加载失败')
    expect(wrapper.text()).toContain('较首期持平')
    wrapper.unmount()
  })
})
