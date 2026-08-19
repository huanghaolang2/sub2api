import { describe, expect, it } from 'vitest'
import type { DashboardModelStat, DashboardTrendPoint } from '@/types/user'
import { DashboardRangePreset, buildDashboardCsv, getPresetRange } from '../dashboard'

const trend: DashboardTrendPoint[] = [{
  date: '2026-08-17',
  requests: 3,
  input_tokens: 10,
  output_tokens: 20,
  cache_creation_tokens: 4,
  cache_read_tokens: 6,
  total_tokens: 40,
  cost: 1.2,
  actual_cost: .9
}]

const models: DashboardModelStat[] = [{
  model: 'model,"quoted"',
  requests: 3,
  input_tokens: 10,
  output_tokens: 20,
  cache_creation_tokens: 4,
  cache_read_tokens: 6,
  total_tokens: 40,
  cost: 1.2,
  actual_cost: .9
}]

describe('dashboard helpers', () => {
  it('builds inclusive preset ranges in local calendar days', () => {
    const now = new Date(2026, 7, 17, 23, 59)
    expect(getPresetRange(DashboardRangePreset.SEVEN_DAYS, now)).toEqual({ startDate: '2026-08-11', endDate: '2026-08-17' })
    expect(getPresetRange(DashboardRangePreset.THIRTY_DAYS, now)).toEqual({ startDate: '2026-07-19', endDate: '2026-08-17' })
  })

  it('exports both data sets and escapes spreadsheet cells', () => {
    const csv = buildDashboardCsv(trend, models)
    expect(csv.startsWith('\uFEFF趋势数据')).toBe(true)
    expect(csv).toContain('2026-08-17,3,10,20,4,6,40,0.9,1.2')
    expect(csv).toContain('"model,""quoted"""')
  })
})
