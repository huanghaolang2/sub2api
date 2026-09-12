<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity, type UsageBoardResponse } from '@/api/usageBoard'
import { boardChartGeometry, formatUsageBoardTokens, usageBoardTokenUnit, UsageBoardChartType } from '@shared-utils/usageBoard'

const props = defineProps<{ data: UsageBoardResponse; type: UsageBoardChartType }>()
const { t } = useI18n()
const host = ref<HTMLElement | null>(null)
const width = ref(700)
const activePeriod = ref<number | null>(null)
const geometry = computed(() => {
  const chart = boardChartGeometry(props.data, props.type, width.value)
  return { ...chart, series: chart.series.map((series, index) => ({ ...series, color: index === 0 ? 'var(--accent)' : index === 1 ? 'var(--success)' : series.color })) }
})
const active = computed(() => activePeriod.value === null ? null : props.data.periods[activePeriod.value])
let observer: ResizeObserver | undefined
onMounted(() => {
  if (host.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(([entry]) => { width.value = Math.floor(entry.contentRect.width) })
    observer.observe(host.value)
  }
})
onUnmounted(() => observer?.disconnect())
function accessiblePeriod(index: number): string {
  const period = props.data.periods[index]
  return `${period.label}: ${geometry.value.series.map((series) => `${series.api_key_name}: ${series.points[index].data_state === UsageBoardDataState.MISSING ? `0 ${usageBoardTokenUnit(0)} · ${t('usageBoard.noData')}` : `${formatUsageBoardTokens(series.points[index].total_tokens)} ${usageBoardTokenUnit(series.points[index].total_tokens)}`}`).join('; ')}`
}
</script>

<template>
  <div ref="host" class="board-chart" data-testid="board-chart" @mouseleave="activePeriod = null">
    <div class="board-legend" :aria-label="t('usageBoard.legend')">
      <span v-for="series in geometry.series" :key="series.api_key_id ?? 'empty'"><i :style="{ background: series.api_key_id === null ? '#94a3b8' : series.color }" />{{ series.api_key_id === null ? t('usageBoard.noData') : series.api_key_name }}</span>
    </div>
    <div class="board-chart-scroll">
      <svg :width="geometry.width" :height="geometry.height" :viewBox="`0 0 ${geometry.width} ${geometry.height}`" :aria-label="t('usageBoard.chartLabel')">
        <title>{{ t('usageBoard.chartLabel') }}</title>
        <g v-for="tick in geometry.ticks" :key="tick.y">
          <line :x1="geometry.left" :x2="geometry.width - 24" :y1="tick.y" :y2="tick.y" class="board-grid" />
          <text :x="geometry.left - 12" :y="tick.y + 4" text-anchor="end" class="board-axis">{{ formatUsageBoardTokens(tick.value) }}</text>
        </g>
        <text :x="12" :y="13" class="board-axis">{{ usageBoardTokenUnit(geometry.maxValue) }} Tokens</text>
        <g v-for="series in geometry.series" :key="series.api_key_id ?? 'empty'" :data-series-key="series.api_key_id">
          <template v-if="type === UsageBoardChartType.LINE">
            <line v-for="segment in series.segments" :key="segment.to.period_start" :x1="segment.from.x" :y1="segment.from.y" :x2="segment.to.x" :y2="segment.to.y" :stroke="segment.missing ? '#94a3b8' : series.color" :stroke-dasharray="segment.missing ? '5 5' : undefined" stroke-width="2" />
            <g v-for="point in series.points" :key="point.period_start" :data-state="point.data_state" :data-value="point.total_tokens">
              <path v-if="point.data_state === UsageBoardDataState.MISSING" :d="`M ${point.x} ${point.y - 6} l 6 6 l -6 6 l -6 -6 Z`" class="board-missing-marker" />
              <circle v-else :cx="point.x" :cy="point.y" r="3.5" :fill="series.color" :stroke="series.color" />
            </g>
          </template>
          <template v-else>
            <g v-for="point in series.points" :key="point.period_start" :data-state="point.data_state" :data-value="point.total_tokens">
              <rect v-if="point.total_tokens > 0" :x="point.x - geometry.barWidth * 0.4" :y="point.y" :width="geometry.barWidth * 0.8" :height="geometry.bottom - point.y" :fill="series.color" rx="2" />
              <rect v-else-if="point.data_state === UsageBoardDataState.MISSING" :x="point.x - Math.max(3, geometry.barWidth * 0.4)" :y="point.y - 4" :width="Math.max(6, geometry.barWidth * 0.8)" height="8" stroke-dasharray="2 2" class="board-missing-marker" />
              <line v-else :x1="point.x - Math.max(3, geometry.barWidth * 0.4)" :x2="point.x + Math.max(3, geometry.barWidth * 0.4)" :y1="point.y" :y2="point.y" :stroke="series.color" stroke-width="3" data-testid="board-observed-zero-bar" />
            </g>
          </template>
        </g>
        <g v-for="(period, index) in geometry.labels" :key="period.start">
          <text :x="period.x" :y="geometry.bottom + 26" text-anchor="middle" class="board-axis">{{ data.granularity === UsageBoardGranularity.DAY ? period.start.slice(5) : period.label }}</text>
          <rect :x="period.x - geometry.step / 2" :y="geometry.top" :width="geometry.step" :height="geometry.bottom - geometry.top + 8" fill="transparent" tabindex="0" :aria-label="accessiblePeriod(index)" :data-testid="`board-chart-period-${index}`" class="board-chart-target" @mouseenter="activePeriod = index" @focus="activePeriod = index" @click="activePeriod = index" @keydown.esc="activePeriod = null" />
        </g>
      </svg>
    </div>
    <div v-if="active && activePeriod !== null" class="board-tooltip" role="status" aria-live="polite" data-testid="board-chart-tooltip">
      <template v-if="active && activePeriod !== null">
        <strong>{{ active.label }} <small v-if="active.coverage === UsageBoardCoverage.PARTIAL">{{ t('usageBoard.partial') }}</small></strong>
        <div class="board-tooltip-series">
          <div v-for="series in geometry.series" :key="series.api_key_id ?? 'empty'">
            <span><i :style="{ background: series.color }" />{{ series.api_key_id === null ? '—' : series.api_key_name }}</span>
            <span v-if="series.points[activePeriod].data_state === UsageBoardDataState.MISSING" class="board-missing-text">0 {{ usageBoardTokenUnit(0) }} · {{ t('usageBoard.noData') }}</span>
            <b v-else>{{ formatUsageBoardTokens(series.points[activePeriod].total_tokens) }} {{ usageBoardTokenUnit(series.points[activePeriod].total_tokens) }} Tokens</b>
          </div>
        </div>
      </template>
    </div>
    <p class="board-chart-hint">{{ t('usageBoard.chartHint') }}</p>
    <p class="board-chart-note"><span class="board-note-marker">◇</span> {{ t('usageBoard.missingHint') }}</p>
  </div>
</template>

<style scoped>
.board-chart { position: relative; min-width: 0; color: var(--board-text); }
.board-legend { display: flex; flex-wrap: wrap; gap: 10px 20px; max-height: 100px; overflow: auto; padding: 0 0 14px; font-size: 11px; }
.board-legend span { display: inline-flex; align-items: center; gap: 7px; overflow-wrap: anywhere; }
.board-legend i, .board-tooltip i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.board-chart-scroll { overflow-x: auto; max-width: 100%; }
svg { display: block; }
.board-grid { stroke: var(--board-border); stroke-width: 1; }
.board-axis { fill: var(--board-muted); font-size: 11px; }
.board-missing-marker { fill: var(--board-bg); stroke: #94a3b8; stroke-width: 1.5; }
.board-chart-target { cursor: crosshair; }
.board-chart-target:focus-visible { outline: 2px solid var(--board-accent); outline-offset: -2px; }
.board-tooltip { position: absolute; top: 48px; right: 8px; z-index: 10; width: 320px; max-width: calc(100% - 16px); max-height: min(60vh, 420px); overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 12px; border-radius: 8px; background: rgb(17 24 39 / 95%); color: #f9fafb; box-shadow: 0 4px 16px #0002; font-size: 12px; pointer-events: auto; }
.board-tooltip > span { color: var(--board-muted); }
.board-tooltip strong { display: block; margin-bottom: 8px; }
.board-tooltip strong small { margin-left: 5px; font-weight: 400; color: var(--board-muted); }
.board-tooltip-series { display: grid; gap: 7px; grid-template-columns: 1fr; }
.board-tooltip-series > div { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
.board-tooltip-series span:first-child { display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.board-tooltip b { font-weight: 600; white-space: nowrap; }
.board-missing-text { color: #cbd5e1; white-space: nowrap; }
.board-chart-hint { margin: 4px 0 0; color: var(--board-muted); font-size: 11px; }
.board-chart-note { margin: 10px 0 0; color: var(--board-muted); font-size: 11px; }
.board-note-marker { color: #94a3b8; font-size: 16px; }
</style>
