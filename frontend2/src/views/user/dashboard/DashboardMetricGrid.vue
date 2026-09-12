<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardStats } from '@/types/user'
import { formatUsageBoardTokens, usageBoardTokenUnit } from '@shared-utils/usageBoard'

interface RankingItem { name: string; usage: number }
interface PeriodStats { users: number; usage: number; ranking: RankingItem[]; error: string }
const props = defineProps<{ stats: DashboardStats | null; periodStats: { today: PeriodStats; week: PeriodStats; month: PeriodStats }; loading: boolean }>()
const formatAmount = (value: number): string => `${formatUsageBoardTokens(value)} ${usageBoardTokenUnit(value)} Tokens`
const periods = computed(() => [
  { key: 'today', label: '当天使用', ...props.periodStats.today, usageLabel: formatAmount(props.periodStats.today.usage) },
  { key: 'week', label: '当周使用', ...props.periodStats.week, usageLabel: formatAmount(props.periodStats.week.usage) },
  { key: 'month', label: '当月使用', ...props.periodStats.month, usageLabel: formatAmount(props.periodStats.month.usage) }
])
const rankings = computed(() => [
  { key: 'today', label: '当天 Top 3', ...props.periodStats.today },
  { key: 'week', label: '当周 Top 3', ...props.periodStats.week },
  { key: 'month', label: '当月 Top 3', ...props.periodStats.month }
])
</script>

<template>
  <section class="dashboard-user-stats" aria-label="文案用户用量统计">
    <div v-if="loading && !stats" class="dashboard-period-grid"><article v-for="index in 3" :key="index" class="is-loading"><span /><strong /><small /></article></div>
    <div v-else class="dashboard-period-grid">
      <article v-for="period in periods" :key="period.key" class="dashboard-period-card">
        <header><span>{{ period.label }}</span><strong v-if="period.error" class="is-error">{{ period.error }}</strong></header>
        <div class="dashboard-period-facts"><div><small>使用人数</small><b>{{ period.users }}</b></div><div><small>使用量</small><b>{{ period.usageLabel }} <em>百万 Tokens</em></b></div></div>
      </article>
    </div>
    <div class="dashboard-ranking-grid">
      <article v-for="ranking in rankings" :key="ranking.key" class="dashboard-ranking-card">
        <header><h3>{{ ranking.label }}</h3><span>API Key · Tokens</span></header>
        <div v-if="ranking.error" class="dashboard-ranking-state is-error" role="alert">{{ ranking.error }}</div>
        <div v-else-if="ranking.ranking.length === 0" class="dashboard-ranking-state">暂无有效 Token 使用</div>
        <ol v-else><li v-for="(item, index) in ranking.ranking" :key="`${item.name}-${index}`"><span>{{ index + 1 }}</span><strong :title="item.name">{{ item.name }}</strong><b>{{ formatUsageBoardTokens(item.usage) }} {{ usageBoardTokenUnit(item.usage) }} Tokens</b></li></ol>
      </article>
    </div>
  </section>
</template>

<style scoped>
.dashboard-user-stats { display: grid; gap: 16px; }.dashboard-period-grid, .dashboard-ranking-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }.dashboard-period-card, .dashboard-ranking-card { min-width: 0; padding: 18px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }.dashboard-period-card > header, .dashboard-ranking-card > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }.dashboard-period-card > header span, .dashboard-ranking-card h3 { color: var(--text-secondary); font-size: 13px; font-weight: 650; }.dashboard-period-card > header strong { font-size: 15px; }.dashboard-period-card > header strong.is-error { color: var(--danger); font-size: 12px; }.dashboard-period-card > header small { color: var(--text-secondary); font-size: 11px; font-weight: 500; }.dashboard-period-facts { margin-top: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--border-subtle); }.dashboard-period-facts div { padding: 10px; display: grid; gap: 4px; background: var(--surface-raised); }.dashboard-period-facts small { color: var(--text-secondary); font-size: var(--font-meta); }.dashboard-period-facts b { font-size: 22px; font-variant-numeric: tabular-nums; }.dashboard-period-facts em, .dashboard-ranking-card em { color: var(--text-secondary); font-size: 11px; font-style: normal; font-weight: 500; }.dashboard-ranking-card > header span { color: var(--text-secondary); font-size: 11px; }.dashboard-ranking-card ol { margin: 14px 0 0; padding: 0; display: grid; gap: 9px; list-style: none; }.dashboard-ranking-card li { min-width: 0; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; }.dashboard-ranking-card li > span { color: var(--text-secondary); font-size: 12px; }.dashboard-ranking-card li strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.dashboard-ranking-card li b { font-size: 13px; font-variant-numeric: tabular-nums; }.dashboard-ranking-state { min-height: 52px; padding-top: 14px; color: var(--text-secondary); font-size: var(--font-meta); }.dashboard-ranking-state.is-error { color: var(--danger); }.dashboard-period-grid article.is-loading { min-height: 128px; display: grid; gap: 8px; align-content: center; }.dashboard-period-grid article.is-loading span, .dashboard-period-grid article.is-loading strong, .dashboard-period-grid article.is-loading small { display: block; background: color-mix(in srgb, var(--border-subtle) 56%, transparent); border-radius: 6px; animation: dashboard-pulse 1.2s ease-in-out infinite; }.dashboard-period-grid article.is-loading span { width: 66px; height: 10px; }.dashboard-period-grid article.is-loading strong { width: 116px; height: 34px; }.dashboard-period-grid article.is-loading small { width: 92px; height: 8px; } @keyframes dashboard-pulse { 50% { opacity: .42; } }
@media (max-width: 900px) { .dashboard-period-grid, .dashboard-ranking-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 560px) { .dashboard-period-grid, .dashboard-ranking-grid { grid-template-columns: 1fr; } }
</style>
