<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as dashboardAPI from '@shared-api/admin/dashboard'
import type { ApiKeyUsageTrendPoint, DashboardStats, GroupStat, ModelStat, TrendDataPoint, UserBreakdownItem, UserSpendingRankingItem, UserUsageTrendPoint } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import { formatCompactNumber, formatDuration, formatGovernanceDate, formatMoney } from '@/features/admin/governance/model'

const router = useRouter()
const loading = ref(true)
const error = ref('')
const partialWarnings = ref<string[]>([])
const stats = ref<DashboardStats | null>(null)
const realtime = ref({ active_requests: 0, requests_per_minute: 0, average_response_time: 0, error_rate: 0 })
const trend = ref<TrendDataPoint[]>([])
const models = ref<ModelStat[]>([])
const groups = ref<GroupStat[]>([])
const rankings = ref<UserSpendingRankingItem[]>([])
const users = ref<UserBreakdownItem[]>([])
const userTrend = ref<UserUsageTrendPoint[]>([])
const apiKeys = ref<ApiKeyUsageTrendPoint[]>([])
const range = reactive({ start: '', end: '', granularity: 'day' as 'day' | 'hour' })
let controller: AbortController | null = null

const maxTrend = computed(() => Math.max(1, ...trend.value.map((item) => item.requests)))
const maxModelCost = computed(() => Math.max(0.000001, ...models.value.map((item) => item.actual_cost)))
const maxUserTrendTokens = computed(() => Math.max(1, ...userTrend.value.map((item) => item.tokens)))
const userTrendSeries = computed(() => {
  const series = new Map<number, {
    userId: number
    label: string
    requests: number
    tokens: number
    actualCost: number
    points: UserUsageTrendPoint[]
  }>()
  for (const point of userTrend.value) {
    const current = series.get(point.user_id) ?? {
      userId: point.user_id,
      label: point.username?.trim() || point.email?.trim() || `用户 #${point.user_id}`,
      requests: 0,
      tokens: 0,
      actualCost: 0,
      points: [],
    }
    current.requests += point.requests
    current.tokens += point.tokens
    current.actualCost += point.actual_cost
    current.points.push(point)
    series.set(point.user_id, current)
  }
  return [...series.values()]
    .map((item) => ({ ...item, points: item.points.sort((left, right) => left.date.localeCompare(right.date)) }))
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 12)
})

function defaultRange(): void {
  const end = new Date()
  const start = new Date(end.getTime() - 7 * 86400000)
  range.start = start.toISOString().slice(0, 10)
  range.end = end.toISOString().slice(0, 10)
}

function query() {
  return { start_date: range.start || undefined, end_date: range.end || undefined, granularity: range.granularity }
}

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  partialWarnings.value = []
  const params = query()
  try {
    const core = await Promise.all([dashboardAPI.getStats(), dashboardAPI.getRealtimeMetrics()])
    stats.value = core[0]
    realtime.value = core[1]
    const results = await Promise.allSettled([
      dashboardAPI.getSnapshotV2({ ...params, include_stats: false, include_trend: true, include_model_stats: true, include_group_stats: true }),
      dashboardAPI.getUserSpendingRanking({ start_date: params.start_date, end_date: params.end_date, limit: 12 }),
      dashboardAPI.getUserBreakdown({ start_date: params.start_date, end_date: params.end_date, limit: 12, sort_by: 'actual_cost' }),
      dashboardAPI.getApiKeyUsageTrend({ ...params, limit: 12 }),
      dashboardAPI.getUserUsageTrend({ ...params, limit: 12 }),
    ])
    if (results[0].status === 'fulfilled') {
      trend.value = results[0].value.trend || []
      models.value = results[0].value.models || []
      groups.value = results[0].value.groups || []
    } else partialWarnings.value.push('趋势与分布')
    if (results[1].status === 'fulfilled') rankings.value = results[1].value.ranking || []
    else partialWarnings.value.push('用户消费排行')
    if (results[2].status === 'fulfilled') users.value = results[2].value.users || []
    else partialWarnings.value.push('用户明细')
    if (results[3].status === 'fulfilled') apiKeys.value = results[3].value.trend || []
    else partialWarnings.value.push('API Key 趋势')
    if (results[4].status === 'fulfilled') userTrend.value = results[4].value.trend || []
    else partialWarnings.value.push('用户时间趋势')
  } catch (caught) {
    if ((caught as { code?: string }).code !== 'ERR_CANCELED') error.value = (caught as { message?: string }).message || '管理概览加载失败'
  } finally {
    loading.value = false
  }
}

function openUserUsage(userId: number): void {
  void router.push({ path: '/admin/usage', query: { user_id: String(userId), start_date: range.start, end_date: range.end } })
}

onMounted(() => { defaultRange(); void load() })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading">
        <div><span class="resource-eyebrow">Control Room</span><h1>平台概览</h1><p>首屏同时呈现规模、收入、账户健康与实时负载；所有排行均可直接下钻到用量审计。</p></div>
        <div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" @click="router.push('/admin/ops')">进入实时运维</button><button class="resource-button" :disabled="loading" @click="load">刷新数据</button></div>
      </header>

      <PageState :loading="loading && !stats" :error="error" @retry="load">
        <template v-if="stats">
          <section class="governance-kpis">
            <div><span>用户 / 今日新增</span><strong>{{ formatCompactNumber(stats.total_users) }} <small>+{{ stats.today_new_users }}</small></strong></div>
            <div><span>今日请求 / 累计</span><strong>{{ formatCompactNumber(stats.today_requests) }} <small>{{ formatCompactNumber(stats.total_requests) }}</small></strong></div>
            <div><span>今日实际收入</span><strong>{{ formatMoney(stats.today_actual_cost) }}</strong></div>
            <div><span>账户健康</span><strong>{{ stats.normal_accounts }} / {{ stats.total_accounts }}</strong></div>
            <div><span>实时请求 / RPM</span><strong>{{ realtime.active_requests }} / {{ formatCompactNumber(realtime.requests_per_minute || stats.rpm) }}</strong></div>
            <div><span>TPM</span><strong>{{ formatCompactNumber(stats.tpm) }}</strong></div>
            <div><span>平均响应</span><strong>{{ formatDuration(realtime.average_response_time || stats.average_duration_ms) }}</strong></div>
            <div><span>实时错误率</span><strong>{{ (realtime.error_rate * (realtime.error_rate <= 1 ? 100 : 1)).toFixed(2) }}%</strong></div>
          </section>

          <p v-if="stats.stats_stale" class="notice notice--error">统计快照可能已过期，最后更新：{{ formatGovernanceDate(stats.stats_updated_at) }}</p>
          <p v-if="partialWarnings.length" class="notice notice--error">以下非核心模块本次加载失败：{{ partialWarnings.join('、') }}。可单独刷新重试。</p>

          <section class="resource-toolbar" aria-label="数据范围">
            <div class="resource-toolbar__filters"><label>开始日期<input v-model="range.start" type="date" /></label><label>结束日期<input v-model="range.end" type="date" /></label><label>粒度<select v-model="range.granularity"><option value="day">按日</option><option value="hour">按小时</option></select></label></div>
            <div class="resource-toolbar__actions"><button class="resource-button" @click="load">应用范围</button></div>
          </section>

          <section class="governance-grid">
            <article class="governance-card">
              <header class="governance-card__header"><div><h2>请求趋势</h2><p>请求量与实际扣费按所选粒度聚合。</p></div><strong>{{ formatMoney(trend.reduce((sum, item) => sum + item.actual_cost, 0)) }}</strong></header>
              <div v-if="trend.length" class="governance-chart"><div v-for="item in trend" :key="item.date" :title="`${item.date} · ${item.requests} 请求 · ${formatMoney(item.actual_cost)}`"><i :style="{ height: `${Math.max(4, item.requests / maxTrend * 160)}px` }"></i><span>{{ item.date.slice(5, 10) }}</span></div></div><p v-else class="resource-empty-inline">所选范围暂无趋势数据。</p>
            </article>
            <article class="governance-card">
              <header class="governance-card__header"><div><h2>模型消费</h2><p>按实际扣费排序，快速识别成本重心。</p></div></header>
              <div v-if="models.length" class="governance-list"><article v-for="item in models.slice(0, 10)" :key="item.model"><div><strong>{{ item.model }}</strong><small>{{ formatCompactNumber(item.requests) }} 请求 · {{ formatCompactNumber(item.total_tokens) }} tokens</small><div class="governance-meter"><i :style="{ width: `${item.actual_cost / maxModelCost * 100}%` }"></i></div></div><strong>{{ formatMoney(item.actual_cost) }}</strong></article></div><p v-else class="resource-empty-inline">暂无模型分布。</p>
            </article>
            <article class="governance-card">
              <header class="governance-card__header"><div><h2>用户消费排行</h2><p>点击用户直接进入带筛选条件的用量审计。</p></div></header>
              <div v-if="rankings.length" class="governance-list"><article v-for="(item, index) in rankings" :key="item.user_id"><button class="resource-link" @click="openUserUsage(item.user_id)">#{{ index + 1 }} · {{ item.username || item.email }}</button><div><strong>{{ formatMoney(item.actual_cost) }}</strong><small>{{ formatCompactNumber(item.requests) }} 请求</small></div></article></div><p v-else class="resource-empty-inline">暂无排行数据。</p>
            </article>
            <article class="governance-card">
              <header class="governance-card__header"><div><h2>分组分布</h2><p>定价分组的请求与收入贡献。</p></div><button class="resource-link" @click="router.push('/admin/groups')">管理分组</button></header>
              <div v-if="groups.length" class="governance-list"><article v-for="item in groups" :key="item.group_id"><div><strong>{{ item.group_name }}</strong><small>#{{ item.group_id }} · {{ formatCompactNumber(item.total_tokens) }} tokens</small></div><div><strong>{{ formatMoney(item.actual_cost) }}</strong><small>{{ formatCompactNumber(item.requests) }} 请求</small></div></article></div><p v-else class="resource-empty-inline">暂无分组分布。</p>
            </article>
          </section>

          <section class="governance-grid">
            <article class="governance-card">
              <header class="governance-card__header"><div><h2>用户成本明细</h2><p>同时对照标准成本、实际扣费与账号成本。</p></div></header>
              <div class="resource-table"><table><thead><tr><th>用户</th><th>请求</th><th>Tokens</th><th>标准</th><th>实收</th><th>账号成本</th></tr></thead><tbody><tr v-for="item in users" :key="item.user_id"><td><button class="resource-link" @click="openUserUsage(item.user_id)">{{ item.email }}</button><small>#{{ item.user_id }}</small></td><td>{{ formatCompactNumber(item.requests) }}</td><td>{{ formatCompactNumber(item.total_tokens) }}</td><td>{{ formatMoney(item.cost) }}</td><td>{{ formatMoney(item.actual_cost) }}</td><td>{{ formatMoney(item.account_cost) }}</td></tr></tbody></table></div>
            </article>
            <article class="governance-card">
              <header class="governance-card__header"><div><h2>API Key 活跃趋势</h2><p>最近窗口内活跃 Key 的请求与 token 消耗。</p></div></header>
              <div v-if="apiKeys.length" class="governance-list"><article v-for="item in apiKeys" :key="`${item.date}-${item.api_key_id}`"><div><strong>{{ item.key_name || `Key #${item.api_key_id}` }}</strong><small>{{ item.date }} · #{{ item.api_key_id }}</small></div><div><strong>{{ formatCompactNumber(item.requests) }}</strong><small>{{ formatCompactNumber(item.tokens) }} tokens</small></div></article></div><p v-else class="resource-empty-inline">暂无 Key 趋势。</p>
            </article>
          </section>

          <section class="governance-card governance-card--wide">
            <header class="governance-card__header"><div><h2>近期用户趋势 · Top 12</h2><p>按所选时间粒度展示各用户 token 变化；点击用户进入同日期范围的用量审计。</p></div></header>
            <div v-if="userTrendSeries.length" class="admin-user-trend">
              <article v-for="series in userTrendSeries" :key="series.userId">
                <button class="resource-link" @click="openUserUsage(series.userId)">{{ series.label }}</button>
                <div class="admin-user-trend__bars" :aria-label="`${series.label} token 趋势`">
                  <i
                    v-for="point in series.points"
                    :key="`${series.userId}-${point.date}`"
                    :style="{ height: `${Math.max(3, point.tokens / maxUserTrendTokens * 38)}px` }"
                    :title="`${point.date} · ${formatCompactNumber(point.tokens)} tokens · ${point.requests} 请求`"
                  />
                </div>
                <span>{{ formatCompactNumber(series.requests) }} 请求</span>
                <strong>{{ formatCompactNumber(series.tokens) }} tokens</strong>
                <strong>{{ formatMoney(series.actualCost) }}</strong>
              </article>
            </div>
            <p v-else class="resource-empty-inline">所选范围暂无用户趋势。</p>
          </section>
        </template>
      </PageState>
    </main>
  </ConsoleShell>
</template>

<style scoped>
.governance-kpis small { color: var(--text-secondary); font-size: var(--font-body-sm); font-weight: 600; }
.resource-toolbar label { display: grid; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); }
.resource-toolbar label input { min-width: 145px; }
.governance-list button { padding-left: 0; text-align: left; }
.admin-user-trend { display: grid; }
.admin-user-trend article { min-height: 58px; display: grid; grid-template-columns: minmax(160px, 1fr) minmax(150px, 1.3fr) 90px 110px 86px; align-items: center; gap: 16px; border-bottom: 1px solid var(--border-subtle); }
.admin-user-trend article:last-child { border-bottom: 0; }
.admin-user-trend article > span { color: var(--text-secondary); font-size: var(--font-meta); text-align: right; }
.admin-user-trend article > strong { font-size: var(--font-meta); text-align: right; }
.admin-user-trend__bars { height: 42px; display: flex; align-items: flex-end; gap: 3px; }
.admin-user-trend__bars i { min-width: 3px; flex: 1; background: color-mix(in srgb, var(--accent) 72%, var(--surface-raised)); border-radius: 2px 2px 0 0; }
@media (max-width: 820px) { .admin-user-trend article { grid-template-columns: minmax(120px, 1fr) minmax(110px, 1fr) 76px; }.admin-user-trend article > span, .admin-user-trend article > strong:first-of-type { display: none; } }
</style>
