import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UserDashboardTrends from '../UserDashboardTrends.vue'
import type { DashboardTrendSeries } from '../dashboardTrends'
import { DashboardKind, DashboardState, type DashboardTrendCardModel, type DashboardTrendSectionModel } from '../dashboardBoards'

function trend(prefix: string, values: number[]): DashboardTrendSeries {
  return {
    error: '',
    points: values.map((usage, index) => ({
      key: `${prefix}-${index}`,
      label: `${index + 1}期`,
      start: `2026-09-${String(index * 7 + 1).padStart(2, '0')}`,
      end: `2026-09-${String(index * 7 + 7).padStart(2, '0')}`,
      users: index + 1,
      usage,
    })),
  }
}


function card(id: string, title: string, data: DashboardTrendSeries, state = data.error ? DashboardState.ERROR : DashboardState.READY): DashboardTrendCardModel {
  return { id, title, caption: id === 'week' ? '最近 4 个自然周' : '最近 3 个自然月', rangeLabel: '2026-09-01 到 2026-09-30', state, error: data.error, points: data.points, retryTargets: data.error ? [{ key: `${id}-request`, label: '重试' }] : [] }
}
function section(week: DashboardTrendSeries, month: DashboardTrendSeries): DashboardTrendSectionModel {
  return { id: 'test-trends', title: '使用趋势', description: '统计周期说明', kind: DashboardKind.TREND, cards: [card('week', '周看板趋势', week), card('month', '月看板趋势', month)] }
}

describe('UserDashboardTrends', () => {
  it('renders two large boards with separate people and token charts', () => {
    const wrapper = mount(UserDashboardTrends, {
      props: {
        section: section(trend('week', [1_000_000, 2_000_000, 3_000_000, 4_000_000]), trend('month', [3_000_000, 2_000_000, 1_000_000])),
      },
    })

    expect(wrapper.findAll('.dashboard-trend-card')).toHaveLength(2)
    expect(wrapper.findAll('.dashboard-trend-metric')).toHaveLength(4)
    expect(wrapper.findAll('.dashboard-trend-y-axis')).toHaveLength(4)
    expect(wrapper.findAll('.dashboard-trend-y-axis')[0].text()).toContain('人数')
    expect(wrapper.findAll('.dashboard-trend-y-axis')[0].findAll('span').map((tick) => tick.text())).toEqual(['4', '2', '0'])
    expect(wrapper.findAll('.dashboard-trend-y-axis')[1].text()).toContain('Tokens')
    expect(wrapper.findAll('.dashboard-trend-y-axis')[1].findAll('span').map((tick) => tick.text())).toEqual(['5百万', '2.5百万', '0'])
    expect(wrapper.text()).toContain('最近 4 个自然周')
    expect(wrapper.text()).toContain('最近 3 个自然月')
    expect(wrapper.text()).toContain('4 人')
    expect(wrapper.text()).toContain('较首期 +3')
    expect(wrapper.text()).toContain('较首期 −2 百万')
    const metrics = wrapper.findAll('.dashboard-trend-metric')
    const weeklyPositions = metrics[0].findAll('.dashboard-trend-hit').map((point) => {
      const style = point.attributes('style')
      return {
        x: parseFloat(style.match(/left: ([\d.]+)%/)?.[1] ?? '0'),
        y: parseFloat(style.match(/top: ([\d.]+)%/)?.[1] ?? '0'),
      }
    })
    expect(weeklyPositions).toEqual([
      { x: 12.5, y: expect.closeTo(66.67, 2) },
      { x: 37.5, y: 50 },
      { x: 62.5, y: expect.closeTo(33.33, 2) },
      { x: 87.5, y: expect.closeTo(16.67, 2) },
    ])
    const monthlyPointPositions = metrics[2].findAll('.dashboard-trend-hit').map((point) => parseFloat(point.attributes('style').match(/left: ([\d.]+)%/)?.[1] ?? '0'))
    expect(monthlyPointPositions).toEqual([expect.closeTo(16.67, 2), 50, expect.closeTo(83.33, 2)])
    expect(metrics[0].get('.dashboard-trend-plot polyline').attributes('points')).toMatch(/^12\.50,/)
    for (const chart of wrapper.findAll('.dashboard-trend-plot polyline')) {
      expect(chart.attributes('points')).not.toMatch(/NaN|Infinity/)
    }
    wrapper.unmount()
  })

  it('shows exact point dates on pointer hover and keyboard focus', async () => {
    const wrapper = mount(UserDashboardTrends, {
      props: {
        section: section({ error: '', points: [
          { key: '2026-09-07', label: '37周', start: '2026-09-07', end: '2026-09-13', users: 2, usage: 100 },
          { key: '2026-09-14', label: '38周', start: '2026-09-14', end: '2026-09-19', users: 3, usage: 200 },
        ] }, trend('month', [100, 200, 300])),
      },
    })

    const weeklyPeopleChart = wrapper.findAll('.dashboard-trend-metric')[0]
    expect(weeklyPeopleChart.findAll('.dashboard-trend-labels span')[0].attributes('data-range')).toBe('2026-09-07 至 2026-09-13')
    expect(weeklyPeopleChart.findAll('.dashboard-trend-labels span')[1].attributes('data-range')).toBe('2026-09-14 至 2026-09-19')
    expect(weeklyPeopleChart.findAll('.dashboard-trend-labels span')[0].attributes('tabindex')).toBe('0')
    const points = weeklyPeopleChart.findAll('.dashboard-trend-hit')
    await points[1].trigger('mouseenter')
    expect(weeklyPeopleChart.get('.dashboard-trend-tooltip').text()).toContain('2026-09-14 至 2026-09-19')
    expect(weeklyPeopleChart.get('.dashboard-trend-tooltip').text()).toContain('3 人')
    expect(weeklyPeopleChart.find('.crosshair').exists()).toBe(true)

    await weeklyPeopleChart.get('.dashboard-trend-plot-frame').trigger('mouseleave')
    expect(weeklyPeopleChart.find('.dashboard-trend-tooltip').exists()).toBe(false)
    await points[0].trigger('focus')
    expect(weeklyPeopleChart.get('.dashboard-trend-tooltip').text()).toContain('2026-09-07 至 2026-09-13')
    wrapper.unmount()
  })

  it('keeps one failed board independent from the successful board', () => {
    const wrapper = mount(UserDashboardTrends, {
      props: {
        section: section({ points: [], error: '周统计加载失败' }, trend('month', [0, 0, 0])),
      },
    })

    expect(wrapper.get('[role="alert"] > span').text()).toBe('周统计加载失败')
    expect(wrapper.text()).toContain('较首期持平')
    expect(wrapper.findAll('.dashboard-trend-metric')).toHaveLength(2)
    wrapper.unmount()
  })

  it('renders a completed board while another is loading or idle, without a group overlay', async () => {
    const data = section(trend('week', [10, 20]), trend('month', []))
    data.cards[1].state = DashboardState.LOADING
    const wrapper = mount(UserDashboardTrends, { props: { section: data } })
    expect(wrapper.findAll('.dashboard-trend-card')).toHaveLength(2)
    expect(wrapper.findAll('.dashboard-trend-metric')).toHaveLength(2)
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1)
    expect(wrapper.findAll('.dashboard-trend-card')[0].attributes('aria-busy')).toBe('false')
    expect(wrapper.findAll('.dashboard-trend-card')[1].attributes('aria-busy')).toBe('true')
    expect(wrapper.text()).not.toContain('暂无趋势数据')
    data.cards[1] = { ...data.cards[1], state: DashboardState.IDLE }
    await wrapper.setProps({ section: { ...data } })
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('uses supplied order, stable heading IDs and exact retry dependencies', async () => {
    const data = section({ points: [], error: '周统计失败' }, trend('month', [3, 5]))
    data.cards.reverse()
    const wrapper = mount(UserDashboardTrends, { props: { section: data } })
    expect(wrapper.findAll('h3').map(h => h.text())).toEqual(['月看板趋势', '周看板趋势'])
    const articles = wrapper.findAll('.dashboard-trend-card')
    expect(articles[0].attributes('aria-labelledby')).toBe('test-trends-month-title')
    expect(wrapper.get('#test-trends-month-title').text()).toBe('月看板趋势')
    await wrapper.get('.dashboard-trend-retry').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['week-request']])
    await wrapper.setProps({ section: { ...data, cards: [data.cards[0]] } })
    expect(wrapper.findAll('h3').map(h => h.text())).toEqual(['月看板趋势'])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

})
