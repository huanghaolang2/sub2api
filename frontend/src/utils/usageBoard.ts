import { UsageBoardDataState, UsageBoardGranularity, type UsageBoardResponse } from '../api/usageBoard'

export enum UsageBoardChartType { LINE = 'line', BAR = 'bar' }
export enum UsageBoardLoadState { IDLE = 'idle', LOADING = 'loading', READY = 'ready', ERROR = 'error' }
export enum UsageViewSection { STATISTICS = 'statistics', BOARD = 'board' }
export enum UsageBoardValidation { VALID = 'valid', REQUIRED = 'required', INVALID = 'invalid', REVERSED = 'reversed' }
export enum UsageBoardChoiceKind { KEY = 'key', GROUP = 'group' }
export interface UsageBoardChoice { id: number; label: string }

export function boardLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function boardDefaultRange(now = new Date()): { start: string; end: string } {
  const start = new Date(now); start.setDate(start.getDate() - 6)
  return { start: boardLocalDate(start), end: boardLocalDate(now) }
}
export function boardMonthLastDay(month: string): string {
  const [year, number] = month.split('-').map(Number)
  const date = new Date(0); date.setFullYear(year, number, 0)
  return boardLocalDate(date)
}
function validBoardDate(value: string, monthly: boolean): boolean {
  if (!(monthly ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return false
  const [year, month, day = 1] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const date = new Date(0); date.setFullYear(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}
export function validateBoardRange(granularity: UsageBoardGranularity, start: string, end: string): UsageBoardValidation {
  if (!start || !end) return UsageBoardValidation.REQUIRED
  if (!validBoardDate(start, granularity === UsageBoardGranularity.MONTH) || !validBoardDate(end, granularity === UsageBoardGranularity.MONTH)) return UsageBoardValidation.INVALID
  return start > end ? UsageBoardValidation.REVERSED : UsageBoardValidation.VALID
}

const boardColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#64748b', '#6366f1']
export function boardSeriesColor(index: number): string { return boardColors[index % boardColors.length] }

// Both frontends render the same geometry; all values and missing states come from the API.
export function boardChartGeometry(data: UsageBoardResponse, type: UsageBoardChartType, availableWidth = 700) {
  const left = 66, top = 20, height = 240, bottom = top + height
  const minimumStep = data.granularity === UsageBoardGranularity.WEEK ? 190 : 70
  const width = Math.max(availableWidth || 700, data.periods.length * minimumStep + left + 24)
  const step = (width - left - 24) / Math.max(data.periods.length, 1)
  const maxValue = data.series.reduce((highest, series) => series.points.reduce((value, point) => Math.max(value, point.total_tokens), highest), 1)
  const barWidth = Math.max(1, Math.min(28, step * 0.8 / Math.max(data.series.length, 1)))
  const series = data.series.map((entry, seriesIndex) => {
    const points = entry.points.map((point, index) => {
      const center = left + step * (index + 0.5)
      const x = type === UsageBoardChartType.BAR ? center + (seriesIndex - (data.series.length - 1) / 2) * barWidth : center
      return { ...point, x, y: bottom - (point.total_tokens / maxValue) * height, label: data.periods[index]?.label ?? point.period_start }
    })
    return { ...entry, color: boardSeriesColor(seriesIndex), points, segments: points.slice(1).map((point, index) => ({
      from: points[index], to: point,
      missing: point.data_state === UsageBoardDataState.MISSING || points[index].data_state === UsageBoardDataState.MISSING
    })) }
  })
  return { width, height: bottom + 54, left, top, bottom, step, barWidth, maxValue, series,
    ticks: Array.from({ length: 5 }, (_, index) => ({ y: bottom - height * index / 4, value: maxValue * index / 4 })),
    labels: data.periods.map((period, index) => ({ ...period, x: left + step * (index + 0.5) })) }
}
