<template>
  <section class="dashboard-trends" aria-labelledby="dashboard-trends-title">
    <header class="dashboard-section-heading">
      <div>
        <h2 id="dashboard-trends-title">使用趋势</h2>
        <p>按自然周与自然月对比使用人数和 Token 量。</p>
      </div>
    </header>

    <div v-if="loading && !hasData" class="dashboard-trend-grid" aria-label="趋势加载中">
      <div v-for="index in 2" :key="index" class="card dashboard-trend-card is-loading">
        <span /><strong /><i /><i />
      </div>
    </div>

    <div v-else class="dashboard-trend-grid">
      <article v-for="board in boards" :key="board.key" class="card dashboard-trend-card">
        <header>
          <div>
            <h3>{{ board.title }}</h3>
            <p>{{ board.caption }}</p>
          </div>
          <span v-if="board.range">{{ board.range }}</span>
        </header>

        <div v-if="board.error" class="dashboard-trend-state is-error" role="alert">{{ board.error }}</div>
        <div v-else-if="board.points.length === 0" class="dashboard-trend-state">暂无趋势数据</div>
        <div v-else class="dashboard-trend-metrics">
          <div v-for="metric in board.metrics" :key="metric.key" class="dashboard-trend-metric" :class="`is-${metric.key}`">
            <div class="dashboard-trend-metric__summary">
              <span>{{ metric.label }}</span>
              <strong>{{ metric.latest }}</strong>
              <small :class="metric.direction">{{ metric.delta }}</small>
            </div>
            <svg
              class="dashboard-trend-plot"
              viewBox="0 0 100 48"
              preserveAspectRatio="none"
              role="img"
              :aria-label="`${board.title}${metric.label}趋势：${metric.description}`"
            >
              <line x1="0" y1="8" x2="100" y2="8" />
              <line x1="0" y1="24" x2="100" y2="24" />
              <line x1="0" y1="40" x2="100" y2="40" />
              <polyline :points="metric.line" />
            </svg>
            <div
              class="dashboard-trend-labels"
              :style="{ gridTemplateColumns: `repeat(${Math.max(board.points.length, 1)}, minmax(0, 1fr))` }"
              aria-hidden="true"
            >
              <span v-for="point in board.points" :key="point.key">{{ point.label }}</span>
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatUsageBoardTokens, usageBoardTokenUnit } from '@/utils/usageBoard'
import type { DashboardTrendPoint, DashboardTrendSeries } from './dashboardTrends'

const props = defineProps<{
  trends: { week: DashboardTrendSeries; month: DashboardTrendSeries }
  loading: boolean
}>()

const hasData = computed(() => props.trends.week.points.length > 0 || props.trends.month.points.length > 0)

function line(values: number[]): string {
  if (values.length === 0) return ''
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const span = maximum - minimum
  return values.map((value, index) => {
    const x = values.length === 1 ? 50 : index * 100 / (values.length - 1)
    const y = span === 0 ? 24 : 40 - ((value - minimum) / span) * 32
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
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

function metric(points: DashboardTrendPoint[], key: 'users' | 'usage') {
  const values = points.map((point) => point[key])
  const first = values[0] ?? 0
  const latest = values[values.length - 1] ?? 0
  const difference = latest - first
  const formatter = key === 'users' ? (value: number) => value.toLocaleString('zh-CN') : tokenAmount
  return {
    key,
    label: key === 'users' ? '使用人数' : 'Token 量',
    latest: key === 'users' ? `${formatter(latest)} 人` : `${formatter(latest)} Tokens`,
    delta: signed(difference, formatter),
    direction: direction(difference),
    line: line(values),
    description: points.map((point, index) => `${point.label} ${formatter(values[index])}`).join('，')
  }
}

const boards = computed(() => ([
  { key: 'week', title: '周看板趋势', caption: '最近 6 个自然周', data: props.trends.week },
  { key: 'month', title: '月看板趋势', caption: '最近 6 个自然月', data: props.trends.month }
].map((board) => ({
  ...board,
  points: board.data.points,
  error: board.data.error,
  range: board.data.points.length > 0
    ? `${board.data.points[0].start} 到 ${board.data.points[board.data.points.length - 1].end}`
    : '',
  metrics: [metric(board.data.points, 'users'), metric(board.data.points, 'usage')]
}))))
</script>

<style scoped>
.dashboard-trends { display: grid; gap: 12px; }
.dashboard-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.dashboard-section-heading h2 { margin: 0; color: var(--text-primary); font-size: 16px; font-weight: 700; letter-spacing: -.02em; }
.dashboard-section-heading p { margin: 3px 0 0; color: var(--text-secondary); font-size: 12px; }
.dashboard-trend-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.dashboard-trend-card { min-width: 0; padding: 18px; box-shadow: none; }
.dashboard-trend-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dashboard-trend-card > header h3 { margin: 0; color: var(--text-primary); font-size: 14px; font-weight: 700; }
.dashboard-trend-card > header p { margin: 3px 0 0; color: var(--text-secondary); font-size: 11px; }
.dashboard-trend-card > header > span { color: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dashboard-trend-metrics { margin-top: 18px; display: grid; gap: 20px; }
.dashboard-trend-metric { min-width: 0; }
.dashboard-trend-metric__summary { display: grid; grid-template-columns: minmax(72px, 1fr) auto auto; align-items: baseline; gap: 10px; }
.dashboard-trend-metric__summary > span { color: var(--text-secondary); font-size: 12px; font-weight: 650; }
.dashboard-trend-metric__summary > strong { color: var(--text-primary); font-size: 15px; font-variant-numeric: tabular-nums; }
.dashboard-trend-metric__summary > small { color: var(--text-secondary); font-size: 10px; font-variant-numeric: tabular-nums; }
.dashboard-trend-metric__summary > small.is-up { color: var(--success); }
.dashboard-trend-metric__summary > small.is-down { color: var(--danger); }
.dashboard-trend-plot { width: 100%; height: 84px; margin-top: 8px; display: block; overflow: visible; }
.dashboard-trend-plot line { stroke: color-mix(in srgb, var(--border-subtle) 72%, transparent); stroke-width: .55; vector-effect: non-scaling-stroke; }
.dashboard-trend-plot polyline { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.dashboard-trend-metric.is-usage .dashboard-trend-plot polyline { stroke: var(--success); }
.dashboard-trend-labels { margin-top: 4px; display: grid; color: var(--text-secondary); font-size: 10px; font-variant-numeric: tabular-nums; text-align: center; }
.dashboard-trend-labels span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dashboard-trend-state { min-height: 220px; display: grid; place-items: center; color: var(--text-secondary); font-size: 12px; }
.dashboard-trend-state.is-error { color: var(--danger); }
.dashboard-trend-card.is-loading { min-height: 318px; display: grid; align-content: start; gap: 12px; }
.dashboard-trend-card.is-loading span, .dashboard-trend-card.is-loading strong, .dashboard-trend-card.is-loading i { display: block; background: color-mix(in srgb, var(--border-subtle) 60%, transparent); border-radius: 5px; animation: dashboard-trend-pulse 1.2s ease-in-out infinite; }
.dashboard-trend-card.is-loading span { width: 92px; height: 13px; }
.dashboard-trend-card.is-loading strong { width: 160px; height: 9px; }
.dashboard-trend-card.is-loading i { width: 100%; height: 92px; }
@keyframes dashboard-trend-pulse { 50% { opacity: .42; } }
@media (max-width: 900px) { .dashboard-trend-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) {
  .dashboard-trend-card { padding: 16px; }
  .dashboard-trend-card > header { display: grid; gap: 5px; }
  .dashboard-trend-metric__summary { grid-template-columns: 1fr auto; }
  .dashboard-trend-metric__summary > small { grid-column: 1 / -1; }
  .dashboard-trend-labels { font-size: 9px; }
}
@media (prefers-reduced-motion: reduce) { .dashboard-trend-card.is-loading span, .dashboard-trend-card.is-loading strong, .dashboard-trend-card.is-loading i { animation: none; } }
</style>
