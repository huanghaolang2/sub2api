import type {
  HealthState,
  MonitorHealth,
  MonitorMatrixRow,
  MonitorMetric
} from '@shared-api/channelMonitorV2'
import type { UserMonitorDetail, UserMonitorView } from '@shared-api/channelMonitor'

export enum LegacyMonitorWindow {
  DAYS_7 = '7d',
  DAYS_15 = '15d',
  DAYS_30 = '30d'
}

export enum MonitorDetailTab {
  MODELS = 'models',
  ERRORS = 'errors',
  USERS = 'users'
}

export enum MonitorTrendView {
  PULSE = 'pulse',
  LINE = 'line'
}

export enum MonitorHealthMode {
  OVERALL = 'overall',
  SUCCESS = 'success',
  TTFT = 'ttft',
  CACHE = 'cache'
}

export const monitorStatusLabels: Record<string, string> = {
  operational: '运行正常',
  degraded: '性能下降',
  failed: '探测失败',
  error: '服务异常'
}

export function availabilityForWindow(
  row: UserMonitorView,
  detail: UserMonitorDetail | undefined,
  window: LegacyMonitorWindow
): number | null {
  if (window === LegacyMonitorWindow.DAYS_7) return row.availability_7d
  if (!detail) return null
  const primary = detail.models.find((model) => model.model === row.primary_model) ?? detail.models[0]
  if (!primary) return null
  return window === LegacyMonitorWindow.DAYS_15 ? primary.availability_15d : primary.availability_30d
}

export function overallLegacyState(items: UserMonitorView[]): 'operational' | 'degraded' {
  return items.some((item) => item.primary_status !== 'operational') ? 'degraded' : 'operational'
}

export function formatMonitorPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const normalized = Number(value) * 100
  return `${Intl.NumberFormat('zh-CN', { minimumFractionDigits: normalized < 1 ? 2 : 1, maximumFractionDigits: normalized < 1 ? 2 : 1 }).format(normalized)}%`
}

export function formatAvailability(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '同步中…'
  return `${Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(Number(value))}%`
}

export function formatMonitorMs(value: number | null | undefined): string {
  if (value == null) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`
}

export function formatThroughput(value: number | null | undefined): string {
  const numeric = Number(value || 0)
  if (Math.abs(numeric) < 1000) return Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(numeric)
  return Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(numeric)
}

export function tokensPerSecond(tpm: number | null | undefined): number {
  return Number(tpm || 0) / 60
}

export function healthState(health: MonitorHealth, mode: MonitorHealthMode): HealthState {
  if (mode === MonitorHealthMode.SUCCESS) return health.error_rate
  if (mode === MonitorHealthMode.TTFT) return health.ttft
  if (mode === MonitorHealthMode.CACHE) return health.cache ?? health.overall
  return health.overall
}

export function healthClass(health: MonitorHealth, mode: MonitorHealthMode): string {
  const score = mode === MonitorHealthMode.SUCCESS
    ? health.error_rate_score
    : mode === MonitorHealthMode.TTFT
      ? health.ttft_score
      : mode === MonitorHealthMode.CACHE
        ? health.cache_score
        : health.score
  if (score != null && Number.isFinite(score)) return `score-${Math.max(0, Math.min(10, Math.round(score / 10)))}`
  return `state-${healthState(health, mode)}`
}

export function matrixRowLabel(row: MonitorMatrixRow): string {
  return [row.platform, row.group_name || (row.group_id ? `#${row.group_id}` : ''), row.model === '__other__' ? '其他模型' : row.model || ''].filter(Boolean).join(' / ')
}

export function successRate(metrics: MonitorMetric): string {
  if (metrics.request_count <= 0 && metrics.rpm <= 0 && metrics.tpm <= 0) return '—'
  return formatMonitorPercent(1 - Number(metrics.error_rate || 0))
}

export function latencySummary(metrics: MonitorMetric['ttft']): string {
  return [
    metrics.avg_ms == null ? '' : `AVG ${formatMonitorMs(metrics.avg_ms)}`,
    metrics.p50_ms == null ? '' : `P50 ${formatMonitorMs(metrics.p50_ms)}`,
    metrics.p90_ms == null ? (metrics.p95_ms == null ? '' : `P95 ${formatMonitorMs(metrics.p95_ms)}`) : `P90 ${formatMonitorMs(metrics.p90_ms)}`
  ].filter(Boolean).join(' · ') || '—'
}

export function lineChartPoints(values: Array<number | null>, width: number, height: number): string {
  if (!values.length) return ''
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!finite.length) return ''
  const minimum = Math.min(...finite)
  const maximum = Math.max(...finite)
  const spread = Math.max(1, maximum - minimum)
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
    const y = value == null ? height : height - ((value - minimum) / spread) * (height - 8) - 4
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

export interface ZoomWindow {
  start: number
  span: number
}

export function zoomWindow(current: ZoomWindow, deltaY: number, cursorRatio: number): ZoomWindow {
  const nextSpan = Math.max(0.2, Math.min(1, current.span * (deltaY < 0 ? 0.75 : 1.333333)))
  const anchor = current.start + current.span * Math.max(0, Math.min(1, cursorRatio))
  const start = Math.max(0, Math.min(1 - nextSpan, anchor - nextSpan * cursorRatio))
  return { start, span: nextSpan }
}

export function sliceByZoom<T>(items: T[], zoom: ZoomWindow): T[] {
  if (zoom.span >= 0.999 || items.length < 2) return items
  const start = Math.floor(zoom.start * items.length)
  const count = Math.max(2, Math.ceil(zoom.span * items.length))
  return items.slice(start, Math.min(items.length, start + count))
}
