import { describe, expect, it } from 'vitest'
import {
  UsageBoardCoverage,
  UsageBoardDataState,
  UsageBoardGranularity,
  type UsageBoardResponse
} from '@/api/usageBoard'
import {
  buildDashboardTrend,
  dashboardPeriodLabel,
  dashboardTrendRange,
  summarizeUsageBoardPeriod
} from '../dashboardTrends'

function response(overrides: Partial<UsageBoardResponse> = {}): UsageBoardResponse {
  return {
    granularity: UsageBoardGranularity.WEEK,
    timezone: 'Asia/Taipei',
    start_date: '2026-08-31',
    end_date: '2026-09-19',
    periods: [
      { start: '2026-08-31', end: '2026-09-06', label: '2026-08-31 ~ 2026-09-06', coverage: UsageBoardCoverage.FULL },
      { start: '2026-09-07', end: '2026-09-13', label: '2026-09-07 ~ 2026-09-13', coverage: UsageBoardCoverage.FULL },
      { start: '2026-09-14', end: '2026-09-20', label: '2026-09-14 ~ 2026-09-20', coverage: UsageBoardCoverage.PARTIAL }
    ],
    series: [
      {
        api_key_id: 1,
        api_key_name: '文案 A',
        points: [
          { period_start: '2026-08-31', total_tokens: 100, record_count: 1, data_state: UsageBoardDataState.OBSERVED },
          { period_start: '2026-09-07', total_tokens: 200, record_count: 1, data_state: UsageBoardDataState.OBSERVED },
          { period_start: '2026-09-14', total_tokens: 300, record_count: 1, data_state: UsageBoardDataState.OBSERVED }
        ]
      },
      {
        api_key_id: 2,
        api_key_name: '文案 B',
        points: [
          { period_start: '2026-08-31', total_tokens: 0, record_count: 0, data_state: UsageBoardDataState.MISSING },
          { period_start: '2026-09-07', total_tokens: 50, record_count: 1, data_state: UsageBoardDataState.OBSERVED },
          { period_start: '2026-09-14', total_tokens: 100, record_count: 1, data_state: UsageBoardDataState.OBSERVED }
        ]
      }
    ],
    rows: [],
    pagination: { page: 1, page_size: 1000, total: 6, pages: 1 },
    ...overrides
  }
}

describe('dashboard trend helpers', () => {
  it('creates six-period ranges aligned to the current week and month', () => {
    const now = new Date(2026, 8, 19, 15, 30)
    expect(dashboardTrendRange('week', now)).toEqual({ startDate: '2026-08-10', endDate: '2026-09-19' })
    expect(dashboardTrendRange('month', now)).toEqual({ startMonth: '2026-04', endMonth: '2026-09' })
  })

  it('summarizes the latest period rather than the full trend range', () => {
    const summary = summarizeUsageBoardPeriod(response())
    expect(summary.users).toBe(2)
    expect(summary.usage).toBe(400)
    expect(summary.ranking).toEqual([
      { name: '文案 A', usage: 300 },
      { name: '文案 B', usage: 100 }
    ])
  })

  it('builds week labels and clips the current period to the actual query end', () => {
    const data = response()
    expect(dashboardPeriodLabel('week', data)).toBe('第38周（2026-09-14 到 2026-09-19）')
    expect(buildDashboardTrend(data, 'week').points).toEqual([
      { key: '2026-08-31', label: '36周', start: '2026-08-31', end: '2026-09-06', users: 1, usage: 100 },
      { key: '2026-09-07', label: '37周', start: '2026-09-07', end: '2026-09-13', users: 2, usage: 250 },
      { key: '2026-09-14', label: '38周', start: '2026-09-14', end: '2026-09-19', users: 2, usage: 400 }
    ])
  })

  it('handles calendar-year boundaries for ranges and ISO week names', () => {
    const now = new Date(2026, 0, 3, 12, 0)
    expect(dashboardTrendRange('month', now)).toEqual({ startMonth: '2025-08', endMonth: '2026-01' })

    const data = response({
      start_date: '2025-12-29',
      end_date: '2026-01-03',
      periods: [{ start: '2025-12-29', end: '2026-01-04', label: '2025-12-29 ~ 2026-01-04', coverage: UsageBoardCoverage.PARTIAL }],
      series: []
    })
    expect(dashboardPeriodLabel('week', data)).toBe('第1周（2025-12-29 到 2026-01-03）')
  })

  it('formats a monthly period as a Chinese month plus its date range', () => {
    const data = response({
      granularity: UsageBoardGranularity.MONTH,
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      periods: [{ start: '2026-09-01', end: '2026-09-30', label: '2026-09', coverage: UsageBoardCoverage.FULL }],
      series: []
    })
    expect(dashboardPeriodLabel('month', data)).toBe('九月（2026-09-01 到 2026-09-30）')
  })
})
