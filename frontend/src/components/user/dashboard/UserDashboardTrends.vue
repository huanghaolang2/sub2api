<template>
  <section class="dashboard-trends" aria-labelledby="dashboard-trends-title">
    <header class="dashboard-section-heading">
      <div>
        <h2 id="dashboard-trends-title">使用趋势</h2>
        <p>按自然周期观察使用人数与 Token 变化，悬浮数据点可查看具体日期。</p>
      </div>
    </header>

    <div v-if="loading && !hasData" class="dashboard-trend-stack" aria-label="趋势加载中">
      <article v-for="index in 2" :key="index" class="dashboard-trend-card is-loading">
        <span /><strong />
        <div><i /><i /></div>
      </article>
    </div>

    <div v-else class="dashboard-trend-stack">
      <article v-for="board in boards" :key="board.key" class="dashboard-trend-card">
        <header class="dashboard-trend-card__header">
          <div>
            <h3>{{ board.title }}</h3>
            <p>{{ board.caption }}</p>
          </div>
          <span v-if="board.range">{{ board.range }}</span>
        </header>

        <div v-if="board.error" class="dashboard-trend-state is-error" role="alert">{{ board.error }}</div>
        <div v-else-if="board.points.length === 0" class="dashboard-trend-state">暂无趋势数据</div>
        <div v-else class="dashboard-trend-metrics">
          <section v-for="metric in board.metrics" :key="metric.key" class="dashboard-trend-metric">
            <header class="dashboard-trend-metric__summary">
              <div>
                <span>{{ metric.label }}</span>
                <strong>{{ metric.latest }}</strong>
              </div>
              <small :class="metric.direction">{{ metric.delta }}</small>
            </header>

            <div class="dashboard-trend-figure">
              <div class="dashboard-trend-plot-frame" @mouseleave="clearHover(board.key, metric.key)">
                <svg
                  class="dashboard-trend-plot"
                  viewBox="0 0 100 48"
                  preserveAspectRatio="none"
                  role="img"
                  :aria-label="`${board.title}${metric.label}趋势：${metric.description}`"
                >
                  <line class="grid-line" x1="0" y1="8" x2="100" y2="8" />
                  <line class="grid-line" x1="0" y1="24" x2="100" y2="24" />
                  <line class="grid-line" x1="0" y1="40" x2="100" y2="40" />
                  <line
                    v-if="hoveredPoint(board.key, metric)"
                    class="crosshair"
                    :x1="hoveredPoint(board.key, metric)?.x"
                    y1="5"
                    :x2="hoveredPoint(board.key, metric)?.x"
                    y2="43"
                  />
                  <polyline :points="metric.line" />
                </svg>

                <button
                  v-for="mark in metric.marks"
                  :key="mark.point.key"
                  type="button"
                  class="dashboard-trend-hit"
                  :class="{ 'is-active': isHovered(board.key, metric.key, mark.index) }"
                  :style="markStyle(mark)"
                  :aria-label="mark.ariaLabel"
                  @mouseenter="activatePoint(board.key, metric.key, mark.index)"
                  @focus="activatePoint(board.key, metric.key, mark.index)"
                  @click="activatePoint(board.key, metric.key, mark.index)"
                  @blur="clearHover(board.key, metric.key)"
                >
                  <span />
                </button>

                <div
                  v-if="hoveredPoint(board.key, metric)"
                  class="dashboard-trend-tooltip"
                  :class="tooltipAlignment(hoveredPoint(board.key, metric)?.x ?? 50)"
                  :style="{ left: `${hoveredPoint(board.key, metric)?.x ?? 50}%` }"
                  role="status"
                >
                  <strong>{{ hoveredPoint(board.key, metric)?.formatted }}</strong>
                  <span>{{ metric.label }} · {{ hoveredPoint(board.key, metric)?.point.label }}</span>
                  <time>{{ hoveredPoint(board.key, metric)?.point.start }} 至 {{ hoveredPoint(board.key, metric)?.point.end }}</time>
                </div>
              </div>

              <div
                class="dashboard-trend-labels"
                :style="{ gridTemplateColumns: `repeat(${Math.max(board.points.length, 1)}, minmax(0, 1fr))` }"
              >
                <span
                  v-for="(point, pointIndex) in board.points"
                  :key="point.key"
                  :class="{ 'is-first': pointIndex === 0, 'is-last': pointIndex === board.points.length - 1 }"
                  :data-range="`${point.start} 至 ${point.end}`"
                  :aria-label="`${point.label}，${point.start} 至 ${point.end}`"
                  tabindex="0"
                >{{ point.label }}</span>
              </div>

              <table class="sr-only">
                <caption>{{ board.title }}{{ metric.label }}明细</caption>
                <thead><tr><th>周期</th><th>开始日期</th><th>结束日期</th><th>{{ metric.label }}</th></tr></thead>
                <tbody>
                  <tr v-for="mark in metric.marks" :key="`table-${mark.point.key}`">
                    <th>{{ mark.point.label }}</th><td>{{ mark.point.start }}</td><td>{{ mark.point.end }}</td><td>{{ mark.formatted }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatUsageBoardTokens, usageBoardTokenUnit } from '@/utils/usageBoard'
import type { DashboardTrendPoint, DashboardTrendSeries } from './dashboardTrends'

type MetricKey = 'users' | 'usage'

interface PlotMark {
  index: number
  x: number
  y: number
  value: number
  formatted: string
  ariaLabel: string
  point: DashboardTrendPoint
}

interface TrendMetric {
  key: MetricKey
  label: string
  latest: string
  delta: string
  direction: string
  line: string
  description: string
  marks: PlotMark[]
}

const props = defineProps<{
  trends: { week: DashboardTrendSeries; month: DashboardTrendSeries }
  loading: boolean
}>()

const hover = ref<{ boardKey: string; metricKey: MetricKey; index: number } | null>(null)
const hasData = computed(() => props.trends.week.points.length > 0 || props.trends.month.points.length > 0)

function plot(values: number[]): { line: string; marks: Array<{ index: number; x: number; y: number }> } {
  if (values.length === 0) return { line: '', marks: [] }
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const span = maximum - minimum
  const marks = values.map((value, index) => {
    const x = values.length === 1 ? 50 : index * 100 / (values.length - 1)
    const y = span === 0 ? 24 : 40 - ((value - minimum) / span) * 32
    return { index, x, y }
  })
  return { line: marks.map((mark) => `${mark.x.toFixed(2)},${mark.y.toFixed(2)}`).join(' '), marks }
}

function signed(value: number, formatter: (amount: number) => string): string {
  if (value === 0) return '较首期持平'
  return `较首期 ${value > 0 ? '+' : '−'}${formatter(Math.abs(value))}`
}

function direction(value: number): string {
  if (value === 0) return 'is-flat'
  return value > 0 ? 'is-up' : 'is-down'
}

function tokenAmount(value: number): string {
  return `${formatUsageBoardTokens(value)} ${usageBoardTokenUnit(value)}`
}

function metric(points: DashboardTrendPoint[], key: MetricKey): TrendMetric {
  const values = points.map((point) => point[key])
  const first = values[0] ?? 0
  const latest = values[values.length - 1] ?? 0
  const difference = latest - first
  const formatter = key === 'users' ? (value: number) => value.toLocaleString('zh-CN') : tokenAmount
  const label = key === 'users' ? '使用人数' : 'Token 使用量'
  const geometry = plot(values)
  const marks = geometry.marks.map((mark) => {
    const point = points[mark.index]
    const formatted = key === 'users' ? `${formatter(values[mark.index])} 人` : `${formatter(values[mark.index])} Tokens`
    return {
      ...mark,
      value: values[mark.index],
      formatted,
      point,
      ariaLabel: `${point.label}，${point.start} 至 ${point.end}，${label} ${formatted}`,
    }
  })
  return {
    key,
    label,
    latest: key === 'users' ? `${formatter(latest)} 人` : `${formatter(latest)} Tokens`,
    delta: signed(difference, formatter),
    direction: direction(difference),
    line: geometry.line,
    description: points.map((point, index) => `${point.label}（${point.start} 至 ${point.end}）${formatter(values[index])}`).join('，'),
    marks,
  }
}

const boards = computed(() => ([
  { key: 'week', title: '周看板趋势', caption: '最近 4 个自然周', data: props.trends.week },
  { key: 'month', title: '月看板趋势', caption: '最近 3 个自然月', data: props.trends.month },
].map((board) => ({
  ...board,
  points: board.data.points,
  error: board.data.error,
  range: board.data.points.length > 0
    ? `${board.data.points[0].start} 到 ${board.data.points[board.data.points.length - 1].end}`
    : '',
  metrics: [metric(board.data.points, 'users'), metric(board.data.points, 'usage')],
}))))

function activatePoint(boardKey: string, metricKey: MetricKey, index: number): void {
  hover.value = { boardKey, metricKey, index }
}

function clearHover(boardKey: string, metricKey: MetricKey): void {
  if (hover.value?.boardKey === boardKey && hover.value.metricKey === metricKey) hover.value = null
}

function isHovered(boardKey: string, metricKey: MetricKey, index: number): boolean {
  return hover.value?.boardKey === boardKey && hover.value.metricKey === metricKey && hover.value.index === index
}

function hoveredPoint(boardKey: string, metric: TrendMetric): PlotMark | undefined {
  if (hover.value?.boardKey !== boardKey || hover.value.metricKey !== metric.key) return undefined
  return metric.marks[hover.value.index]
}

function markStyle(mark: PlotMark): Record<string, string> {
  return { left: `${mark.x}%`, top: `${mark.y / 48 * 100}%` }
}

function tooltipAlignment(x: number): string {
  if (x < 20) return 'is-left'
  if (x > 80) return 'is-right'
  return ''
}
</script>

<style scoped>
.dashboard-trends {
  --dashboard-surface: #ffffff;
  --dashboard-surface-soft: #f7f9fc;
  --dashboard-ink: #172033;
  --dashboard-muted: #64748b;
  --dashboard-border: #dbe4f0;
  --dashboard-accent: #2563eb;
  display: grid;
  gap: 20px;
  color: var(--dashboard-ink);
}
:global(.dark .dashboard-trends) {
  --dashboard-surface: #151a24;
  --dashboard-surface-soft: #1d2430;
  --dashboard-ink: #f8fafc;
  --dashboard-muted: #94a3b8;
  --dashboard-border: #334155;
  --dashboard-accent: #3b82f6;
}
.dashboard-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
.dashboard-section-heading h2 { margin: 0; color: var(--dashboard-ink); font-size: clamp(22px, 2vw, 28px); font-weight: 760; letter-spacing: -.035em; }
.dashboard-section-heading p { max-width: 680px; margin: 6px 0 0; color: var(--dashboard-muted); font-size: 13px; line-height: 1.6; }
.dashboard-trend-stack { display: grid; gap: 24px; }
.dashboard-trend-card { min-width: 0; padding: clamp(20px, 2.4vw, 30px); background: var(--dashboard-surface); border: 1px solid var(--dashboard-border); border-radius: 22px; box-shadow: 0 18px 48px rgb(15 23 42 / 7%); }
:global(.dark .dashboard-trend-card) { box-shadow: 0 20px 56px rgb(0 0 0 / 22%); }
.dashboard-trend-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.dashboard-trend-card__header h3 { margin: 0; color: var(--dashboard-ink); font-size: 18px; font-weight: 740; letter-spacing: -.02em; }
.dashboard-trend-card__header p { margin: 5px 0 0; color: var(--dashboard-muted); font-size: 12px; }
.dashboard-trend-card__header > span { color: var(--dashboard-muted); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dashboard-trend-metrics { margin-top: 22px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.dashboard-trend-metric { min-width: 0; padding: 21px; background: var(--dashboard-surface-soft); border: 1px solid var(--dashboard-border); border-radius: 16px; }
.dashboard-trend-metric__summary { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.dashboard-trend-metric__summary > div { min-width: 0; display: grid; gap: 7px; }
.dashboard-trend-metric__summary span { color: var(--dashboard-muted); font-size: 12px; font-weight: 680; }
.dashboard-trend-metric__summary strong { color: var(--dashboard-ink); font-size: clamp(23px, 2.3vw, 32px); font-weight: 750; letter-spacing: -.035em; line-height: 1.05; overflow-wrap: anywhere; }
.dashboard-trend-metric__summary > small { flex: 0 0 auto; color: var(--dashboard-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.dashboard-trend-metric__summary > small.is-up, .dashboard-trend-metric__summary > small.is-down { color: var(--dashboard-accent); }
.dashboard-trend-figure { margin-top: 16px; }
.dashboard-trend-plot-frame { position: relative; height: 150px; }
.dashboard-trend-plot { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; }
.dashboard-trend-plot .grid-line { stroke: var(--dashboard-border); stroke-width: .55; vector-effect: non-scaling-stroke; }
.dashboard-trend-plot .crosshair { stroke: var(--dashboard-muted); stroke-width: .8; vector-effect: non-scaling-stroke; }
.dashboard-trend-plot polyline { fill: none; stroke: var(--dashboard-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.dashboard-trend-hit { position: absolute; z-index: 2; width: 28px; height: 28px; padding: 0; display: grid; place-items: center; background: transparent; border: 0; border-radius: 999px; transform: translate(-50%, -50%); cursor: crosshair; }
.dashboard-trend-hit > span { width: 8px; height: 8px; display: block; background: var(--dashboard-accent); border-radius: 999px; box-shadow: 0 0 0 2px var(--dashboard-surface-soft); transition: transform .12s ease; }
.dashboard-trend-hit:hover > span, .dashboard-trend-hit:focus-visible > span, .dashboard-trend-hit.is-active > span { transform: scale(1.35); }
.dashboard-trend-hit:focus-visible { outline: 2px solid var(--dashboard-accent); outline-offset: 1px; }
.dashboard-trend-tooltip { position: absolute; z-index: 4; top: 2px; min-width: 188px; padding: 10px 12px; display: grid; gap: 3px; color: var(--dashboard-surface); background: var(--dashboard-ink); border-radius: 10px; box-shadow: 0 12px 28px rgb(15 23 42 / 20%); transform: translateX(-50%); pointer-events: none; }
.dashboard-trend-tooltip.is-left { transform: translateX(0); }
.dashboard-trend-tooltip.is-right { transform: translateX(-100%); }
.dashboard-trend-tooltip strong { font-size: 14px; font-weight: 740; }
.dashboard-trend-tooltip span, .dashboard-trend-tooltip time { color: color-mix(in srgb, var(--dashboard-surface) 78%, transparent); font-size: 10px; font-style: normal; font-variant-numeric: tabular-nums; }
.dashboard-trend-labels { position: relative; z-index: 3; margin-top: 7px; display: grid; color: var(--dashboard-muted); font-size: 10px; font-variant-numeric: tabular-nums; text-align: center; }
.dashboard-trend-labels span { position: relative; min-width: 0; white-space: nowrap; cursor: default; outline: none; }
.dashboard-trend-labels span::after { content: attr(data-range); position: absolute; z-index: 6; left: 50%; bottom: calc(100% + 8px); width: max-content; max-width: 210px; padding: 7px 9px; color: var(--dashboard-surface); background: var(--dashboard-ink); border-radius: 8px; box-shadow: 0 10px 24px rgb(15 23 42 / 18%); font-size: 10px; line-height: 1.35; text-align: left; opacity: 0; visibility: hidden; transform: translate(-50%, 4px); transition: opacity .12s ease, transform .12s ease, visibility .12s ease; pointer-events: none; }
.dashboard-trend-labels span.is-first::after { left: 0; transform: translate(0, 4px); }
.dashboard-trend-labels span.is-last::after { right: 0; left: auto; transform: translate(0, 4px); }
.dashboard-trend-labels span:hover::after, .dashboard-trend-labels span:focus::after { opacity: 1; visibility: visible; transform: translate(-50%, 0); }
.dashboard-trend-labels span.is-first:hover::after, .dashboard-trend-labels span.is-first:focus::after, .dashboard-trend-labels span.is-last:hover::after, .dashboard-trend-labels span.is-last:focus::after { transform: translate(0, 0); }
.dashboard-trend-labels span:focus-visible { border-radius: 3px; box-shadow: 0 0 0 2px var(--dashboard-accent); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.dashboard-trend-state { min-height: 240px; display: grid; place-items: center; color: var(--dashboard-muted); font-size: 12px; }
.dashboard-trend-state.is-error { color: #dc2626; }
:global(.dark .dashboard-trend-state.is-error) { color: #f87171; }
.dashboard-trend-card.is-loading { min-height: 350px; display: grid; align-content: start; gap: 12px; }
.dashboard-trend-card.is-loading > span, .dashboard-trend-card.is-loading > strong, .dashboard-trend-card.is-loading i { display: block; background: var(--dashboard-surface-soft); border-radius: 7px; animation: dashboard-trend-pulse 1.2s ease-in-out infinite; }
.dashboard-trend-card.is-loading > span { width: 108px; height: 16px; }
.dashboard-trend-card.is-loading > strong { width: 190px; height: 10px; }
.dashboard-trend-card.is-loading > div { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.dashboard-trend-card.is-loading i { height: 238px; }
@keyframes dashboard-trend-pulse { 50% { opacity: .42; } }
@media (max-width: 900px) {
  .dashboard-trend-metrics, .dashboard-trend-card.is-loading > div { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .dashboard-trend-card { padding: 18px; border-radius: 18px; }
  .dashboard-trend-card__header { display: grid; gap: 6px; }
  .dashboard-trend-card__header > span { white-space: normal; }
  .dashboard-trend-metric { padding: 17px; }
  .dashboard-trend-metric__summary { align-items: flex-start; flex-direction: column; }
  .dashboard-trend-plot-frame { height: 138px; }
}
@media (prefers-reduced-motion: reduce) {
  .dashboard-trend-card.is-loading > span, .dashboard-trend-card.is-loading > strong, .dashboard-trend-card.is-loading i { animation: none; }
  .dashboard-trend-hit > span { transition: none; }
}
</style>
