<template>
  <section class="dashboard-user-stats" aria-labelledby="dashboard-ranking-title">
    <header class="dashboard-section-heading">
      <div>
        <h2 id="dashboard-ranking-title">Token 用量排行</h2>
        <p>按当周、当月与所有时间对照 API Key 的 Token 使用量。</p>
      </div>
    </header>

    <div class="dashboard-ranking-grid">
      <article v-for="period in periods" :key="period.key" class="dashboard-ranking-card">
        <header>
          <div>
            <h3>{{ period.label }} Top 10</h3>
            <p>{{ period.rangeLabel }}</p>
          </div>
          <span>Tokens</span>
        </header>

        <div v-if="period.loading" class="dashboard-ranking-loading" aria-label="排行加载中">
          <i v-for="index in 5" :key="index" />
        </div>
        <div v-else-if="period.error" class="dashboard-ranking-state is-error" role="alert">{{ period.error }}</div>
        <div v-else-if="period.ranking.length === 0" class="dashboard-ranking-state">暂无有效 Token 使用</div>
        <ol v-else>
          <li v-for="(item, index) in period.ranking.slice(0, 10)" :key="`${period.key}-${index}-${item.name}`">
            <span>{{ index + 1 }}</span>
            <strong :title="item.name">{{ item.name }}</strong>
            <b>{{ formatAmount(item.usage) }}</b>
          </li>
        </ol>
      </article>
    </div>

    <p v-if="props.error" class="dashboard-section-error" role="alert">{{ props.error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { UserDashboardStats } from '@/api/usage'
import { formatUsageBoardTokens, usageBoardTokenUnit } from '@/utils/usageBoard'
import type { DashboardPeriodStats } from './dashboardTrends'

const props = defineProps<{
  stats: UserDashboardStats
  loading: boolean
  periodStats: { week: DashboardPeriodStats; month: DashboardPeriodStats }
  periodLoading: boolean
  error: string
}>()

const formatAmount = (value: number): string => `${formatUsageBoardTokens(value)} ${usageBoardTokenUnit(value)} Tokens`

const lifetime = computed<DashboardPeriodStats>(() => ({
  users: props.stats.usage_board?.users ?? props.stats.total_api_keys,
  usage: props.stats.usage_board?.total_tokens ?? props.stats.total_tokens,
  ranking: (props.stats.usage_board?.ranking ?? []).map((item) => ({
    name: item.api_key_name,
    usage: item.total_tokens,
  })),
  error: '',
  rangeLabel: '所有时间',
}))

const periods = computed(() => [
  { key: 'week', label: '当周使用', ...props.periodStats.week, loading: props.loading || props.periodLoading },
  { key: 'month', label: '当月使用', ...props.periodStats.month, loading: props.loading || props.periodLoading },
  { key: 'lifetime', label: '累计看板', ...lifetime.value, loading: props.loading },
])
</script>

<style scoped>
.dashboard-user-stats {
  --dashboard-surface: #ffffff;
  --dashboard-surface-soft: #f7f9fc;
  --dashboard-ink: #172033;
  --dashboard-muted: #64748b;
  --dashboard-border: #dbe4f0;
  display: grid;
  gap: 16px;
  color: var(--dashboard-ink);
}
:global(.dark .dashboard-user-stats) {
  --dashboard-surface: #151a24;
  --dashboard-surface-soft: #1d2430;
  --dashboard-ink: #f8fafc;
  --dashboard-muted: #94a3b8;
  --dashboard-border: #334155;
}
.dashboard-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
.dashboard-section-heading h2 { margin: 0; color: var(--dashboard-ink); font-size: clamp(22px, 2vw, 28px); font-weight: 760; letter-spacing: -.035em; }
.dashboard-section-heading p { max-width: 620px; margin: 6px 0 0; color: var(--dashboard-muted); font-size: 13px; line-height: 1.6; }
.dashboard-ranking-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 16px; }
.dashboard-ranking-card { min-width: 0; padding: 20px; background: var(--dashboard-surface); border: 1px solid var(--dashboard-border); border-radius: 18px; box-shadow: 0 14px 36px rgb(15 23 42 / 6%); }
:global(.dark .dashboard-ranking-card) { box-shadow: 0 20px 56px rgb(0 0 0 / 22%); }
.dashboard-ranking-card > header { min-height: 46px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dashboard-ranking-card h3 { margin: 0; color: var(--dashboard-ink); font-size: 14px; font-weight: 720; }
.dashboard-ranking-card header p { margin: 4px 0 0; color: var(--dashboard-muted); font-size: 10px; font-variant-numeric: tabular-nums; line-height: 1.45; }
.dashboard-ranking-card > header > span { flex: 0 0 auto; color: var(--dashboard-muted); font-size: 10px; font-weight: 650; }
.dashboard-ranking-card ol { margin: 14px 0 0; padding: 0; display: grid; gap: 5px; list-style: none; }
.dashboard-ranking-card li { min-width: 0; min-height: 36px; padding: 6px 8px; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; border-radius: 8px; }
.dashboard-ranking-card li:nth-child(odd) { background: var(--dashboard-surface-soft); }
.dashboard-ranking-card li > span { color: var(--dashboard-muted); font-size: 10px; font-variant-numeric: tabular-nums; text-align: center; }
.dashboard-ranking-card li > strong { overflow: hidden; color: var(--dashboard-ink); font-size: 12px; font-weight: 660; text-overflow: ellipsis; white-space: nowrap; }
.dashboard-ranking-card li > b { color: var(--dashboard-ink); font-size: 10px; font-weight: 680; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dashboard-ranking-state { min-height: 300px; display: grid; place-items: center; color: var(--dashboard-muted); font-size: 12px; text-align: center; }
.dashboard-ranking-state.is-error, .dashboard-section-error { color: #dc2626; }
:global(.dark .dashboard-ranking-state.is-error), :global(.dark .dashboard-section-error) { color: #f87171; }
.dashboard-ranking-loading { margin-top: 14px; display: grid; gap: 7px; }
.dashboard-ranking-loading i { height: 36px; display: block; background: var(--dashboard-surface-soft); border-radius: 8px; animation: dashboard-ranking-pulse 1.2s ease-in-out infinite; }
@keyframes dashboard-ranking-pulse { 50% { opacity: .45; } }
@media (max-width: 900px) {
  .dashboard-ranking-grid { grid-template-columns: 1fr; }
  .dashboard-ranking-card ol { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 18px; }
  .dashboard-ranking-state { min-height: 100px; }
}
@media (max-width: 520px) {
  .dashboard-ranking-card { padding: 18px; }
  .dashboard-ranking-card ol { grid-template-columns: 1fr; }
  .dashboard-ranking-card li { grid-template-columns: 20px minmax(0, 1fr); }
  .dashboard-ranking-card li > b { grid-column: 2; color: var(--dashboard-muted); font-size: 10px; }
}
@media (prefers-reduced-motion: reduce) { .dashboard-ranking-loading i { animation: none; } }
</style>
