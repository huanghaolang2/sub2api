import type { UsageBoardResponse } from '@/api/usageBoard'

export type DashboardTrendKind = 'week' | 'month'

export interface DashboardPeriodStats {
  users: number
  usage: number
  ranking: Array<{ name: string; usage: number }>
  error: string
  rangeLabel: string
}

export interface DashboardTrendPoint {
  key: string
  label: string
  start: string
  end: string
  users: number
  usage: number
}

export interface DashboardTrendSeries {
  points: DashboardTrendPoint[]
  error: string
}

const chineseMonthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function isoWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
}

function monthName(value: string): string {
  return chineseMonthNames[parseLocalDate(value).getMonth()]
}

function clippedEnd(periodEnd: string, responseEnd: string): string {
  return periodEnd > responseEnd ? responseEnd : periodEnd
}

export function dashboardTrendRange(kind: DashboardTrendKind, now: Date = new Date(), periodCount = 6): {
  startDate?: string
  endDate?: string
  startMonth?: string
  endMonth?: string
} {
  if (kind === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() - (periodCount - 1), 1)
    return {
      startMonth: localDate(start).slice(0, 7),
      endMonth: localDate(now).slice(0, 7)
    }
  }

  const currentMonday = addDays(now, -((now.getDay() + 6) % 7))
  return {
    startDate: localDate(addDays(currentMonday, -(periodCount - 1) * 7)),
    endDate: localDate(now)
  }
}

export function summarizeUsageBoardPeriod(result: UsageBoardResponse, periodIndex = result.periods.length - 1): DashboardPeriodStats {
  const values = result.series.map((series) => ({
    name: series.api_key_name,
    usage: series.points[periodIndex]?.total_tokens ?? 0
  }))
  const period = result.periods[periodIndex]

  return {
    users: values.filter((item) => item.usage > 0).length,
    usage: values.reduce((sum, item) => sum + item.usage, 0),
    ranking: values.filter((item) => item.usage > 0).sort((left, right) => right.usage - left.usage).slice(0, 3),
    error: '',
    rangeLabel: period ? `${period.start} 到 ${clippedEnd(period.end, result.end_date)}` : `${result.start_date} 到 ${result.end_date}`
  }
}

export function dashboardPeriodLabel(kind: 'today' | DashboardTrendKind, result: UsageBoardResponse): string {
  const period = result.periods[result.periods.length - 1]
  const start = period?.start ?? result.start_date
  const end = clippedEnd(period?.end ?? result.end_date, result.end_date)

  if (kind === 'week') return `第${isoWeek(parseLocalDate(start))}周（${start} 到 ${end}）`
  if (kind === 'month') return `${monthName(start)}（${start} 到 ${end}）`
  return `当天（${start}）`
}

export function buildDashboardTrend(result: UsageBoardResponse, kind: DashboardTrendKind): DashboardTrendSeries {
  return {
    error: '',
    points: result.periods.map((period, index) => ({
      key: period.start,
      label: kind === 'week' ? `${isoWeek(parseLocalDate(period.start))}周` : monthName(period.start),
      start: period.start,
      end: clippedEnd(period.end, result.end_date),
      users: result.series.filter((series) => (series.points[index]?.total_tokens ?? 0) > 0).length,
      usage: result.series.reduce((sum, series) => sum + (series.points[index]?.total_tokens ?? 0), 0)
    }))
  }
}
