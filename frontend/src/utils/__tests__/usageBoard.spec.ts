import { describe, expect, it } from 'vitest'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity, type UsageBoardResponse } from '../../api/usageBoard'
import { boardChartGeometry, boardDefaultRange, boardMonthLastDay, formatUsageBoardTokens, validateBoardRange, UsageBoardChartType, UsageBoardValidation } from '../usageBoard'

describe('usage board presentation', () => {
  it('formats all displayed token counts as millions', () => {
    expect(formatUsageBoardTokens(0)).toBe('0')
    expect(formatUsageBoardTokens(1_250_000)).toBe('1.25')
  })
  it('uses calendar dates for defaults and validates leap days, months and order', () => {
    expect(boardDefaultRange(new Date(2026, 0, 3, 12))).toEqual({ start: '2025-12-28', end: '2026-01-03' })
    expect(boardMonthLastDay('2024-02')).toBe('2024-02-29')
    expect(validateBoardRange(UsageBoardGranularity.DAY, '2024-02-29', '2024-02-29')).toBe(UsageBoardValidation.VALID)
    expect(validateBoardRange(UsageBoardGranularity.DAY, '2026-02-29', '2026-03-01')).toBe(UsageBoardValidation.INVALID)
    expect(validateBoardRange(UsageBoardGranularity.MONTH, '2026-13', '2026-13')).toBe(UsageBoardValidation.INVALID)
    expect(validateBoardRange(UsageBoardGranularity.WEEK, '2026-09-10', '2026-09-09')).toBe(UsageBoardValidation.REVERSED)
    expect(validateBoardRange(UsageBoardGranularity.DAY, '', '')).toBe(UsageBoardValidation.REQUIRED)
  })
  it('keeps observed zero and missing at the baseline with distinct states in both chart types', () => {
    const data: UsageBoardResponse = {
      granularity: UsageBoardGranularity.DAY, timezone: 'UTC', start_date: '2026-09-07', end_date: '2026-09-09', rows: [], pagination: { page: 1, page_size: 20, total: 3, pages: 1 },
      periods: ['07', '08', '09'].map((day) => ({ start: `2026-09-${day}`, end: `2026-09-${day}`, label: `2026-09-${day}`, coverage: UsageBoardCoverage.FULL })),
      series: [{ api_key_id: 1, api_key_name: '项目接口', points: [
        { period_start: '2026-09-07', total_tokens: 100, record_count: 1, data_state: UsageBoardDataState.OBSERVED },
        { period_start: '2026-09-08', total_tokens: 0, record_count: 1, data_state: UsageBoardDataState.OBSERVED },
        { period_start: '2026-09-09', total_tokens: 0, record_count: 0, data_state: UsageBoardDataState.MISSING }
      ] }]
    }
    for (const type of [UsageBoardChartType.LINE, UsageBoardChartType.BAR]) {
      const chart = boardChartGeometry(data, type)
      expect(chart.series[0].points[1].y).toBe(chart.bottom)
      expect(chart.series[0].points[2].y).toBe(chart.bottom)
      expect(chart.series[0].points[1].data_state).toBe(UsageBoardDataState.OBSERVED)
      expect(chart.series[0].points[2].data_state).toBe(UsageBoardDataState.MISSING)
      expect(chart.series[0].segments.map((segment) => segment.missing)).toEqual([false, true])
      expect(chart.series[0].api_key_name).toBe('项目接口')
      const narrowChart = boardChartGeometry(data, type, 320)
      expect(narrowChart.width).toBe(320)
      expect(narrowChart.series[0].points.every((point) => point.x >= narrowChart.left && point.x < 320)).toBe(true)
    }
  })
})
