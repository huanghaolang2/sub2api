import type { DashboardModelStat, DashboardTrendPoint } from '@/types/user'

export enum DashboardRangePreset {
  SEVEN_DAYS = '7d',
  FOURTEEN_DAYS = '14d',
  THIRTY_DAYS = '30d',
  CUSTOM = 'custom'
}

export interface DashboardDateRange {
  startDate: string
  endDate: string
}

export const rangePresetLabels: Record<DashboardRangePreset, string> = {
  [DashboardRangePreset.SEVEN_DAYS]: '近 7 天',
  [DashboardRangePreset.FOURTEEN_DAYS]: '近 14 天',
  [DashboardRangePreset.THIRTY_DAYS]: '近 30 天',
  [DashboardRangePreset.CUSTOM]: '自定义'
}

export const dashboardModelColors = ['#6c5ce7', '#16a085', '#e4a33b', '#4d8dff', '#d65c78', '#7c8494']

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getPresetRange(preset: Exclude<DashboardRangePreset, DashboardRangePreset.CUSTOM>, now: Date = new Date()): DashboardDateRange {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = preset === DashboardRangePreset.SEVEN_DAYS ? 7 : preset === DashboardRangePreset.FOURTEEN_DAYS ? 14 : 30
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  return { startDate: formatLocalDate(start), endDate: formatLocalDate(end) }
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

export function formatCurrency(value: number, digits: number = 2): string {
  if (!Number.isFinite(value)) return `$${(0).toFixed(digits)}`
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function formatChartDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

export function formatUsageTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildDashboardCsv(trend: DashboardTrendPoint[], models: DashboardModelStat[]): string {
  const rows: Array<Array<string | number>> = [
    ['趋势数据'],
    ['时间', '请求数', '输入 Tokens', '输出 Tokens', '缓存创建', '缓存读取', '总 Tokens', '实际消费', '标准消费'],
    ...trend.map((point) => [point.date, point.requests, point.input_tokens, point.output_tokens, point.cache_creation_tokens, point.cache_read_tokens, point.total_tokens, point.actual_cost, point.cost]),
    [],
    ['模型数据'],
    ['模型', '请求数', '输入 Tokens', '输出 Tokens', '缓存创建', '缓存读取', '总 Tokens', '实际消费', '标准消费'],
    ...models.map((model) => [model.model, model.requests, model.input_tokens, model.output_tokens, model.cache_creation_tokens, model.cache_read_tokens, model.total_tokens, model.actual_cost, model.cost])
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`
}

export function downloadDashboardCsv(csv: string, range: DashboardDateRange): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `dashboard-${range.startDate}-${range.endDate}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
