<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardStats } from '@/types/user'
import { formatCompactNumber, formatCurrency } from './dashboard'

const props = defineProps<{ stats: DashboardStats | null; loading: boolean }>()

interface DashboardMetric {
  label: string
  value: string
  detail: string
  supplement?: string
  tone: string
}

const metrics = computed<DashboardMetric[]>(() => {
  const stats = props.stats
  if (!stats) return []
  const todayTokenDetail = stats.today_input_tokens != null || stats.today_output_tokens != null
    ? `输入 ${formatCompactNumber(stats.today_input_tokens ?? 0)} · 输出 ${formatCompactNumber(stats.today_output_tokens ?? 0)}`
    : `当前 ${formatCompactNumber(stats.tpm)} TPM`
  const totalTokenDetail = stats.total_input_tokens != null || stats.total_output_tokens != null
    ? `累计 ${formatCompactNumber(stats.total_tokens)} · 输入 ${formatCompactNumber(stats.total_input_tokens ?? 0)} · 输出 ${formatCompactNumber(stats.total_output_tokens ?? 0)}`
    : `累计 ${formatCompactNumber(stats.total_tokens)} Tokens`
  return [
    { label: '今日请求', value: stats.today_requests.toLocaleString(), detail: `累计 ${stats.total_requests.toLocaleString()} 次`, tone: 'accent' },
    { label: '今日 Tokens', value: formatCompactNumber(stats.today_tokens), detail: todayTokenDetail, supplement: totalTokenDetail, tone: 'positive' },
    {
      label: '今日消费',
      value: formatCurrency(stats.today_actual_cost),
      detail: `标准 ${formatCurrency(stats.today_cost ?? 0)}`,
      supplement: `累计实际 ${formatCurrency(stats.total_actual_cost)} · 标准 ${formatCurrency(stats.total_cost ?? 0)}`,
      tone: 'warning'
    },
    { label: '平均延迟', value: `${Math.round(stats.average_duration_ms).toLocaleString()} ms`, detail: `${stats.rpm.toLocaleString()} RPM · ${formatCompactNumber(stats.tpm)} TPM`, tone: 'positive' }
  ]
})
</script>

<template>
  <section class="dashboard-metrics" aria-label="核心指标">
    <template v-if="loading && !stats">
      <article v-for="index in 4" :key="index" class="is-loading"><span /><strong /><small /></article>
    </template>
    <article v-for="metric in metrics" v-else :key="metric.label" :class="`tone-${metric.tone}`">
      <div><span>{{ metric.label }}</span><i /></div>
      <strong>{{ metric.value }}</strong>
      <small :title="metric.detail">{{ metric.detail }}</small>
      <small v-if="metric.supplement" class="dashboard-metric-supplement" :title="metric.supplement">{{ metric.supplement }}</small>
    </article>
  </section>
</template>

<style scoped>
.dashboard-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-block: 1px solid var(--border-subtle); }
.dashboard-metrics article { min-width: 0; padding: 27px 24px 24px; display: grid; gap: 8px; border-right: 1px solid var(--border-subtle); }
.dashboard-metrics article:first-child { padding-left: 4px; }
.dashboard-metrics article:last-child { border-right: 0; }
.dashboard-metrics article > div { display: flex; align-items: center; gap: 7px; }
.dashboard-metrics article > div span { color: var(--text-secondary); font-size: 12px; font-weight: 630; }
.dashboard-metrics article > div i { width: 5px; height: 5px; border-radius: 50%; }
.dashboard-metrics .tone-accent > div i { background: var(--accent); }
.dashboard-metrics .tone-positive > div i { background: var(--success); }
.dashboard-metrics .tone-warning > div i { background: #d7972d; }
.dashboard-metrics article > strong { overflow: hidden; font-size: clamp(25px, 2.45vw, 35px); letter-spacing: -.045em; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dashboard-metrics article small { overflow: hidden; color: var(--text-secondary); font-size: var(--font-body-sm); text-overflow: ellipsis; white-space: nowrap; }
.dashboard-metric-supplement { margin-top: -4px; }
.dashboard-metrics article.is-loading span, .dashboard-metrics article.is-loading strong, .dashboard-metrics article.is-loading small { display: block; background: color-mix(in srgb, var(--border-subtle) 56%, transparent); border-radius: 6px; animation: dashboard-pulse 1.2s ease-in-out infinite; }
.dashboard-metrics article.is-loading span { width: 66px; height: 10px; }
.dashboard-metrics article.is-loading strong { width: 116px; height: 34px; }
.dashboard-metrics article.is-loading small { width: 92px; height: 8px; }
@keyframes dashboard-pulse { 50% { opacity: .42; } }

@media (max-width: 900px) {
  .dashboard-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--border-subtle); }
  .dashboard-metrics article:nth-child(2) { border-right: 0; }
  .dashboard-metrics article:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); }
  .dashboard-metrics article, .dashboard-metrics article:first-child { padding-left: 18px; }
}

@media (max-width: 520px) {
  .dashboard-metrics { grid-template-columns: 1fr; }
  .dashboard-metrics article { border-right: 0; border-bottom: 1px solid var(--border-subtle); }
}
</style>
