<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardTrendPoint } from '@/types/user'
import { formatChartDate, formatCompactNumber, formatCurrency } from './dashboard'

const props = defineProps<{ trend: DashboardTrendPoint[]; loading: boolean; error: string }>()
const emit = defineEmits<{ retry: [] }>()

const chartWidth = 760
const chartHeight = 220

interface ChartPoint { x: number; y: number; source: DashboardTrendPoint }

function makePoints(key: 'total_tokens' | 'actual_cost'): ChartPoint[] {
  const maximum = Math.max(...props.trend.map((item) => item[key]), 1)
  return props.trend.map((item, index) => ({
    x: props.trend.length === 1 ? chartWidth / 2 : index * (chartWidth / (props.trend.length - 1)),
    y: chartHeight - 12 - (item[key] / maximum) * (chartHeight - 28),
    source: item
  }))
}

const tokenPoints = computed(() => makePoints('total_tokens'))
const costPoints = computed(() => makePoints('actual_cost'))
const tokenPolyline = computed(() => tokenPoints.value.map((point) => `${point.x},${point.y}`).join(' '))
const costPolyline = computed(() => costPoints.value.map((point) => `${point.x},${point.y}`).join(' '))
const tokenArea = computed(() => `0,${chartHeight} ${tokenPolyline.value} ${chartWidth},${chartHeight}`)
const totalTokens = computed(() => props.trend.reduce((sum, item) => sum + item.total_tokens, 0))
const totalCost = computed(() => props.trend.reduce((sum, item) => sum + item.actual_cost, 0))
const axisLabels = computed(() => {
  if (props.trend.length <= 5) return props.trend.map((item, index) => ({ index, label: formatChartDate(item.date) }))
  const indexes = [0, Math.round((props.trend.length - 1) * .25), Math.round((props.trend.length - 1) * .5), Math.round((props.trend.length - 1) * .75), props.trend.length - 1]
  return [...new Set(indexes)].map((index) => ({ index, label: formatChartDate(props.trend[index].date) }))
})
</script>

<template>
  <article class="dashboard-panel dashboard-trend-panel">
    <header>
      <div><span>用量趋势</span><strong>{{ formatCompactNumber(totalTokens) }}</strong><small>范围内 Tokens · 实际消费 {{ formatCurrency(totalCost) }}</small></div>
      <div class="dashboard-trend-legend"><span><i class="is-token" />Tokens</span><span><i class="is-cost" />实际消费</span></div>
    </header>

    <div v-if="loading && trend.length === 0" class="dashboard-panel-state" aria-label="趋势加载中"><span class="dashboard-state-spinner" /><span>正在加载趋势数据</span></div>
    <div v-else-if="error && trend.length === 0" class="dashboard-panel-state is-error"><strong>趋势加载失败</strong><span>{{ error }}</span><button type="button" @click="emit('retry')">重新加载</button></div>
    <div v-else-if="trend.length === 0" class="dashboard-panel-state"><strong>当前范围暂无用量</strong><span>产生调用后，这里会展示 Tokens 与消费变化。</span></div>
    <div v-else class="dashboard-trend-chart">
      <svg :viewBox="`0 0 ${chartWidth} ${chartHeight}`" preserveAspectRatio="none" role="img" aria-label="Tokens 与实际消费趋势图">
        <g class="dashboard-chart-grid"><path d="M0 12H760M0 63H760M0 114H760M0 165H760M0 216H760" /></g>
        <polygon class="dashboard-token-area" :points="tokenArea" />
        <polyline class="dashboard-token-line" :points="tokenPolyline" />
        <polyline class="dashboard-cost-line" :points="costPolyline" />
        <g class="dashboard-chart-points">
          <circle v-for="point in tokenPoints" :key="point.source.date" :cx="point.x" :cy="point.y" r="3">
            <title>{{ formatChartDate(point.source.date) }}：{{ formatCompactNumber(point.source.total_tokens) }} Tokens，{{ formatCurrency(point.source.actual_cost, 4) }}</title>
          </circle>
        </g>
      </svg>
      <div class="dashboard-chart-axis">
        <span v-for="item in axisLabels" :key="item.index" :style="{ left: `${trend.length === 1 ? 50 : item.index / (trend.length - 1) * 100}%` }">{{ item.label }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.dashboard-panel { min-width: 0; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }
.dashboard-panel > header { min-height: 76px; padding: 18px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }
.dashboard-panel > header > div:first-child { display: grid; gap: 3px; }
.dashboard-panel > header span { color: var(--text-secondary); font-size: 12px; font-weight: 650; }
.dashboard-panel > header strong { font-size: 22px; letter-spacing: -.035em; }
.dashboard-panel > header small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-trend-legend { display: flex; gap: 15px; }
.dashboard-trend-legend span { display: flex; align-items: center; gap: 5px; font-size: var(--font-meta) !important; }
.dashboard-trend-legend i { width: 7px; height: 7px; border-radius: 50%; }
.dashboard-trend-legend .is-token { background: var(--accent); }
.dashboard-trend-legend .is-cost { background: var(--success); }
.dashboard-trend-chart { position: relative; height: 296px; padding: 25px 20px 36px; }
.dashboard-trend-chart svg { width: 100%; height: 220px; overflow: visible; }
.dashboard-chart-grid { fill: none; stroke: var(--border-subtle); stroke-width: 1; opacity: .72; }
.dashboard-token-area { fill: var(--accent-soft); }
.dashboard-token-line { fill: none; stroke: var(--accent); stroke-width: 2.2; vector-effect: non-scaling-stroke; }
.dashboard-cost-line { fill: none; stroke: var(--success); stroke-width: 1.7; stroke-dasharray: 5 5; vector-effect: non-scaling-stroke; }
.dashboard-chart-points { fill: var(--accent); }
.dashboard-chart-axis { position: relative; height: 18px; margin-top: 8px; color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-chart-axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.dashboard-chart-axis span:first-child { transform: none; }
.dashboard-chart-axis span:last-child { transform: translateX(-100%); }
.dashboard-panel-state { min-height: 296px; padding: 24px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--text-secondary); text-align: center; }
.dashboard-panel-state strong { color: var(--text-primary); font-size: 13px; }
.dashboard-panel-state span { max-width: 280px; font-size: var(--font-body-sm); line-height: 1.6; }
.dashboard-panel-state button { min-height: 32px; margin-top: 5px; padding: 0 11px; color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-body-sm); font-weight: 700; }
.dashboard-panel-state.is-error { color: var(--danger); }
.dashboard-state-spinner { width: 20px; height: 20px; border: 2px solid var(--border-subtle); border-top-color: var(--accent); border-radius: 50%; animation: dashboard-spin .75s linear infinite; }
@keyframes dashboard-spin { to { transform: rotate(360deg); } }

@media (max-width: 560px) {
  .dashboard-trend-legend { display: none; }
  .dashboard-trend-chart { height: 250px; }
  .dashboard-trend-chart svg { height: 174px; }
}
</style>
