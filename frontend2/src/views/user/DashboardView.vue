<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as keysAPI from '@shared-api/keys'
import * as usageAPI from '@shared-api/usage'
import { getUsageBoard, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder } from '@shared-api/usageBoard'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import { keyAllowsBatchImage } from '@/features/user/batch-image/model'
import { AccountStatus } from '@/types/auth'
import type { DashboardStats } from '@/types/user'
import { useAuthStore } from '@/stores/auth'
import DashboardAccountPanel from './dashboard/DashboardAccountPanel.vue'
import DashboardMetricGrid from './dashboard/DashboardMetricGrid.vue'

interface RankingItem { name: string; usage: number }
interface PeriodStats { users: number; usage: number; ranking: RankingItem[]; error: string }
interface RequestError { message?: string }

const auth = useAuthStore()
const stats = ref<DashboardStats | null>(null)
const statsLoading = ref(true)
const periodLoading = ref(true)
const supportLoading = ref(true)
const statsError = ref('')
const periodStats = ref<{ today: PeriodStats; week: PeriodStats; month: PeriodStats }>({
  today: { users: 0, usage: 0, ranking: [], error: '' }, week: { users: 0, usage: 0, ranking: [], error: '' }, month: { users: 0, usage: 0, ranking: [], error: '' }
})
const batchImageAvailable = ref(false)
const lastUpdated = ref<Date | null>(null)
let disposed = false

const displayName = computed(() => auth.user?.username.trim() || auth.user?.email.split('@')[0] || '你好')
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
})
const loading = computed(() => statsLoading.value || periodLoading.value || supportLoading.value)
const accountStatus = computed<AccountStatus>(() => String(auth.user?.status) === AccountStatus.ACTIVE ? AccountStatus.ACTIVE : AccountStatus.DISABLED)
const lastUpdatedLabel = computed(() => lastUpdated.value
  ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastUpdated.value)
  : '等待首次更新')
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function message(error: unknown, fallback: string): string { return (error as RequestError)?.message || fallback }
function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function rangeStart(kind: 'week' | 'month'): string {
  const now = new Date()
  if (kind === 'month') return localDate(new Date(now.getFullYear(), now.getMonth(), 1))
  const mondayOffset = (now.getDay() + 6) % 7
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset))
}
function boardQuery(kind: 'today' | 'week' | 'month') {
  const end = localDate(new Date())
  return {
    granularity: kind === 'today' ? UsageBoardGranularity.DAY : kind === 'week' ? UsageBoardGranularity.WEEK : UsageBoardGranularity.MONTH,
    ...(kind === 'today' || kind === 'week' ? { start_date: kind === 'today' ? end : rangeStart('week'), end_date: end } : { start_month: end.slice(0, 7), end_month: end.slice(0, 7) }),
    timezone, api_key_ids: [], group_ids: [], sort_order: UsageBoardSortOrder.DESC, page: 1, page_size: 1000
  }
}
function summarize(result: Awaited<ReturnType<typeof getUsageBoard>>): { users: number; usage: number; ranking: RankingItem[] } {
  return {
    users: result.series.filter((series) => series.points.some((point) => point.total_tokens > 0)).length,
    usage: result.series.reduce((sum, series) => sum + series.points.reduce((periodSum, point) => periodSum + point.total_tokens, 0), 0),
    ranking: result.series.map((series) => ({ name: series.api_key_name, usage: series.points.reduce((sum, point) => sum + point.total_tokens, 0) })).filter((item) => item.usage > 0).sort((a, b) => b.usage - a.usage).slice(0, 3)
  }
}

async function loadStats(): Promise<void> {
  statsLoading.value = true; statsError.value = ''
  try { const [result] = await Promise.all([usageAPI.getDashboardStats(), auth.refreshUser()]); if (!disposed) { stats.value = result; lastUpdated.value = new Date() } }
  catch (error) { if (!disposed) statsError.value = message(error, '摘要指标加载失败') }
  finally { statsLoading.value = false }
}
async function loadPeriodStats(): Promise<void> {
  periodLoading.value = true
  const kinds = ['today', 'week', 'month'] as const
  const results = await Promise.allSettled(kinds.map((kind) => getUsageBoard(UsageBoardScope.SELF, boardQuery(kind))))
  if (!disposed) {
    kinds.forEach((kind, index) => {
      const result = results[index]
      periodStats.value[kind] = result.status === 'fulfilled' ? { ...summarize(result.value), error: '' } : { users: 0, usage: 0, ranking: [], error: message(result.reason, '统计加载失败') }
    })
  }
  periodLoading.value = false
}
async function hasBatchImageKey(): Promise<boolean> {
  let page = 1
  while (true) {
    const response = await keysAPI.list(page, 100, { status: 'active', sort_by: 'created_at', sort_order: 'desc' })
    if (response.items.some(keyAllowsBatchImage)) return true
    if (page >= response.pages || response.items.length === 0) return false
    page += 1
  }
}
async function loadSupport(): Promise<void> {
  supportLoading.value = true
  try { batchImageAvailable.value = await hasBatchImageKey() } catch { batchImageAvailable.value = false } finally { supportLoading.value = false }
}
async function refreshAll(): Promise<void> { await Promise.all([loadStats(), loadPeriodStats(), loadSupport()]) }

onMounted(() => { void refreshAll() })
onBeforeUnmount(() => { disposed = true })
</script>

<template>
  <ConsoleShell>
    <div class="dashboard-page">
      <header class="dashboard-hero">
        <div class="dashboard-hero__copy">
          <div class="dashboard-hero__eyebrow"><i />文案用户用量总览 <span>数据更新 {{ lastUpdatedLabel }}</span></div>
          <h1>{{ greeting }}，{{ displayName }}</h1>
          <p>当前 API Key 的人数与 Tokens 使用情况集中展示。</p>
        </div>
      </header>

      <p v-if="statsError && stats" class="dashboard-feedback is-error" role="alert">统计刷新失败，当前仍展示可用结果：{{ statsError }}</p>
      <PageState :loading="loading && !stats" :error="stats ? '' : statsError" @retry="refreshAll">
        <DashboardMetricGrid :stats="stats" :period-stats="periodStats" :loading="loading" />
      </PageState>

      <DashboardAccountPanel
        :status="accountStatus"
        :is-admin="auth.isAdmin"
        :can-use-batch-image="batchImageAvailable"
        :simple-mode="auth.isSimpleMode"
      />
    </div>
  </ConsoleShell>
</template>
