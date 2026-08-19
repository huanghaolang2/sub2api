<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as keysAPI from '@shared-api/keys'
import * as usageAPI from '@shared-api/usage'
import * as userAPI from '@shared-api/user'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import { keyAllowsBatchImage } from '@/features/user/batch-image/model'
import type { PlatformQuotaItem } from '@/types'
import { AccountStatus } from '@/types/auth'
import {
  DashboardGranularity,
  type DashboardModelStat,
  type DashboardStats,
  type DashboardTrendPoint,
  type UsageLog
} from '@/types/user'
import { useAuthStore } from '@/stores/auth'
import DashboardAccountPanel from './dashboard/DashboardAccountPanel.vue'
import DashboardMetricGrid from './dashboard/DashboardMetricGrid.vue'
import DashboardModelPanel from './dashboard/DashboardModelPanel.vue'
import DashboardModelTable from './dashboard/DashboardModelTable.vue'
import DashboardPlatformPanel from './dashboard/DashboardPlatformPanel.vue'
import DashboardRecentUsage from './dashboard/DashboardRecentUsage.vue'
import DashboardScopeSwitch from './dashboard/DashboardScopeSwitch.vue'
import DashboardToolbar from './dashboard/DashboardToolbar.vue'
import DashboardTrendPanel from './dashboard/DashboardTrendPanel.vue'
import {
  DashboardRangePreset,
  buildDashboardCsv,
  downloadDashboardCsv,
  getPresetRange
} from './dashboard/dashboard'

interface RequestError {
  code?: string
  message?: string
}

const auth = useAuthStore()
const initialRange = getPresetRange(DashboardRangePreset.SEVEN_DAYS)

const stats = ref<DashboardStats | null>(null)
const trend = ref<DashboardTrendPoint[]>([])
const models = ref<DashboardModelStat[]>([])
const recentUsage = ref<UsageLog[]>([])
const platformQuotas = ref<PlatformQuotaItem[]>([])
const batchImageAvailable = ref(false)
const preset = ref<DashboardRangePreset>(DashboardRangePreset.SEVEN_DAYS)
const startDate = ref(initialRange.startDate)
const endDate = ref(initialRange.endDate)
const granularity = ref(DashboardGranularity.DAY)
const statsLoading = ref(true)
const insightsLoading = ref(true)
const recentLoading = ref(true)
const platformLoading = ref(true)
const statsError = ref('')
const trendError = ref('')
const modelError = ref('')
const recentError = ref('')
const platformError = ref('')
const accountError = ref('')
const exportMessage = ref('')
const lastUpdated = ref<Date | null>(null)

let recentController: AbortController | null = null
let exportMessageTimer: number | null = null
let statsRequestId = 0
let insightsRequestId = 0
let supportRequestId = 0

const displayName = computed(() => auth.user?.username.trim() || auth.user?.email.split('@')[0] || '你好')
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
})
const loading = computed(() => statsLoading.value || insightsLoading.value || recentLoading.value || platformLoading.value)
const canExport = computed(() => trend.value.length > 0 || models.value.length > 0)
const accountStatus = computed<AccountStatus>(() =>
  String(auth.user?.status) === AccountStatus.ACTIVE ? AccountStatus.ACTIVE : AccountStatus.DISABLED
)
const lastUpdatedLabel = computed(() => lastUpdated.value
  ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastUpdated.value)
  : '等待首次更新')

function isCanceled(error: unknown): boolean {
  return (error as RequestError)?.code === 'ERR_CANCELED'
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as RequestError)?.message || fallback
}

function currentRangeParams(): { start_date: string; end_date: string } {
  return { start_date: startDate.value, end_date: endDate.value }
}

async function loadStats(): Promise<void> {
  const requestId = ++statsRequestId
  statsLoading.value = true
  statsError.value = ''
  accountError.value = ''
  const [statsResult, accountResult] = await Promise.allSettled([
    usageAPI.getDashboardStats(),
    auth.refreshUser()
  ])
  if (requestId !== statsRequestId) return
  if (statsResult.status === 'fulfilled') {
    stats.value = statsResult.value
    lastUpdated.value = new Date()
  } else {
    statsError.value = errorMessage(statsResult.reason, '摘要指标加载失败')
  }
  if (accountResult.status === 'rejected') accountError.value = errorMessage(accountResult.reason, '账户资料刷新失败')
  statsLoading.value = false
}

async function loadInsights(clearExisting: boolean = false): Promise<void> {
  const requestId = ++insightsRequestId
  if (clearExisting) {
    trend.value = []
    models.value = []
  }
  insightsLoading.value = true
  trendError.value = ''
  modelError.value = ''
  const params = { ...currentRangeParams(), granularity: granularity.value }
  const [trendResult, modelResult] = await Promise.allSettled([
    usageAPI.getDashboardTrend({ ...params, granularity: params.granularity === DashboardGranularity.HOUR ? 'hour' : 'day' }),
    usageAPI.getDashboardModels({ start_date: params.start_date, end_date: params.end_date })
  ])
  if (requestId !== insightsRequestId) return
  if (trendResult.status === 'fulfilled') {
    trend.value = trendResult.value.trend ?? []
    lastUpdated.value = new Date()
  } else if (!isCanceled(trendResult.reason)) {
    trendError.value = errorMessage(trendResult.reason, '趋势数据加载失败')
  }
  if (modelResult.status === 'fulfilled') {
    models.value = modelResult.value.models ?? []
    lastUpdated.value = new Date()
  } else if (!isCanceled(modelResult.reason)) {
    modelError.value = errorMessage(modelResult.reason, '模型数据加载失败')
  }
  insightsLoading.value = false
}

async function loadRecent(clearExisting: boolean = false): Promise<void> {
  recentController?.abort()
  const controller = new AbortController()
  recentController = controller
  if (clearExisting) recentUsage.value = []
  recentLoading.value = true
  recentError.value = ''
  try {
    const response = await usageAPI.query(
      { ...currentRangeParams(), page: 1, page_size: 5, sort_by: 'created_at', sort_order: 'desc' },
      { signal: controller.signal }
    )
    recentUsage.value = response.items
    lastUpdated.value = new Date()
  } catch (caught) {
    if (!isCanceled(caught)) recentError.value = errorMessage(caught, '近期调用加载失败')
  } finally {
    if (recentController === controller) recentLoading.value = false
  }
}

async function hasBatchImageKey(): Promise<boolean> {
  let page = 1
  let hasMore = true
  while (hasMore) {
    const response = await keysAPI.list(page, 100, {
      status: 'active',
      sort_by: 'created_at',
      sort_order: 'desc'
    })
    if (response.items.some(keyAllowsBatchImage)) return true
    hasMore = page < response.pages && response.items.length > 0
    page += 1
  }
  return false
}

async function loadSupport(): Promise<void> {
  const requestId = ++supportRequestId
  platformLoading.value = true
  platformError.value = ''
  const [quotaResult, batchAccessResult] = await Promise.allSettled([
    userAPI.getMyPlatformQuotas(),
    hasBatchImageKey()
  ])
  if (requestId !== supportRequestId) return
  if (quotaResult.status === 'fulfilled') {
    platformQuotas.value = quotaResult.value.platform_quotas || []
  } else {
    platformError.value = errorMessage(quotaResult.reason, '平台额度加载失败')
  }
  batchImageAvailable.value = batchAccessResult.status === 'fulfilled' && batchAccessResult.value
  platformLoading.value = false
}

async function loadRangeData(clearExisting: boolean = false): Promise<void> {
  await Promise.all([loadInsights(clearExisting), loadRecent(clearExisting)])
}

async function refreshAll(): Promise<void> {
  await Promise.all([loadStats(), loadRangeData(false), loadSupport()])
}

function selectPreset(value: Exclude<DashboardRangePreset, DashboardRangePreset.CUSTOM>): void {
  const range = getPresetRange(value)
  preset.value = value
  startDate.value = range.startDate
  endDate.value = range.endDate
  void loadRangeData(true)
}

function updateStartDate(value: string): void {
  startDate.value = value
  preset.value = DashboardRangePreset.CUSTOM
}

function updateEndDate(value: string): void {
  endDate.value = value
  preset.value = DashboardRangePreset.CUSTOM
}

function applyCustomRange(): void {
  preset.value = DashboardRangePreset.CUSTOM
  void loadRangeData(true)
}

function updateGranularity(value: DashboardGranularity): void {
  granularity.value = value
  void loadInsights(true)
}

function exportCsv(): void {
  if (!canExport.value) return
  downloadDashboardCsv(buildDashboardCsv(trend.value, models.value), { startDate: startDate.value, endDate: endDate.value })
  exportMessage.value = `已导出 ${startDate.value} 至 ${endDate.value} 的看板数据`
  if (exportMessageTimer != null) window.clearTimeout(exportMessageTimer)
  exportMessageTimer = window.setTimeout(() => { exportMessage.value = '' }, 3600)
}

onMounted(() => { void refreshAll() })
onBeforeUnmount(() => {
  statsRequestId += 1
  insightsRequestId += 1
  supportRequestId += 1
  recentController?.abort()
  if (exportMessageTimer != null) window.clearTimeout(exportMessageTimer)
})
</script>

<template>
  <ConsoleShell>
    <div class="dashboard-page">
      <header class="dashboard-hero">
        <div class="dashboard-hero__copy">
          <div class="dashboard-hero__eyebrow"><i />个人用量总览 <span>数据更新 {{ lastUpdatedLabel }}</span></div>
          <h1>{{ greeting }}，{{ displayName }}</h1>
          <p>请求、Tokens、消费与模型分布集中在同一视图，筛选结果会同步作用于图表和调用记录。</p>
        </div>
        <DashboardScopeSwitch :is-admin="auth.isAdmin" />
      </header>

      <DashboardToolbar
        :preset="preset"
        :start-date="startDate"
        :end-date="endDate"
        :granularity="granularity"
        :loading="loading"
        :can-export="canExport"
        @select-preset="selectPreset"
        @update:start-date="updateStartDate"
        @update:end-date="updateEndDate"
        @apply-custom="applyCustomRange"
        @update:granularity="updateGranularity"
        @refresh="refreshAll"
        @export="exportCsv"
      />

      <p v-if="exportMessage" class="dashboard-feedback" role="status">{{ exportMessage }}</p>
      <p v-if="statsError && stats" class="dashboard-feedback is-error" role="alert">摘要刷新失败，当前仍展示上次成功结果：{{ statsError }}</p>
      <p v-if="accountError" class="dashboard-feedback is-error" role="alert">{{ accountError }}；余额与账户配置可能不是最新数据。</p>

      <PageState :loading="statsLoading && !stats" :error="stats ? '' : statsError" @retry="loadStats">
        <DashboardMetricGrid :stats="stats" :loading="statsLoading" />
      </PageState>

      <DashboardPlatformPanel
        v-if="!auth.isSimpleMode"
        :stats="stats"
        :quotas="platformQuotas"
        :loading="platformLoading"
        :error="platformError"
      />

      <section class="dashboard-primary-grid" aria-label="趋势与模型分布">
        <DashboardTrendPanel :trend="trend" :loading="insightsLoading" :error="trendError" @retry="loadInsights(true)" />
        <DashboardModelPanel :models="models" :loading="insightsLoading" :error="modelError" @retry="loadInsights(true)" />
      </section>

      <section class="dashboard-secondary-grid" aria-label="近期调用与账户状态">
        <DashboardRecentUsage :items="recentUsage" :loading="recentLoading" :error="recentError" @retry="loadRecent(true)" />
        <DashboardAccountPanel
          :stats="stats"
          :status="accountStatus"
          :balance="auth.user?.balance ?? 0"
          :concurrency="auth.user?.concurrency ?? 0"
          :is-admin="auth.isAdmin"
          :can-use-batch-image="batchImageAvailable"
          :simple-mode="auth.isSimpleMode"
        />
      </section>

      <DashboardModelTable :models="models" :loading="insightsLoading" :error="modelError" @retry="loadInsights(true)" />
    </div>
  </ConsoleShell>
</template>

<style scoped>
.dashboard-page { width: min(1500px, 100%); margin: 0 auto; }
.dashboard-hero { min-height: 126px; display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; }
.dashboard-hero__copy { min-width: 0; }
.dashboard-hero__eyebrow { margin-bottom: 14px; display: flex; align-items: center; gap: 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.dashboard-hero__eyebrow > i { width: 7px; height: 7px; background: var(--success); border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 11%, transparent); }
.dashboard-hero__eyebrow > span { margin-left: 7px; color: var(--text-secondary); font-weight: 550; letter-spacing: 0; text-transform: none; }
.dashboard-hero h1 { max-width: none; font-size: clamp(34px, 4vw, 52px); line-height: 1.02; letter-spacing: -.055em; }
.dashboard-hero p { max-width: 700px; margin: 16px 0 0; color: var(--text-secondary); font-size: 12px; line-height: 1.65; }
.dashboard-feedback { min-height: 38px; margin: 12px 0 0; padding: 0 13px; display: flex; align-items: center; color: var(--success); background: color-mix(in srgb, var(--success) 8%, transparent); border-left: 3px solid currentColor; border-radius: 5px; font-size: var(--font-body-sm); }
.dashboard-feedback.is-error { color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.dashboard-primary-grid { margin-top: 28px; display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(310px, .8fr); gap: 16px; }
.dashboard-secondary-grid { margin: 16px 0; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(340px, .85fr); gap: 16px; align-items: stretch; }

:deep(.page-state) { min-height: 154px; margin-top: 6px; }

@media (max-width: 980px) {
  .dashboard-primary-grid, .dashboard-secondary-grid { grid-template-columns: 1fr; }
  .dashboard-hero { min-height: 112px; }
}

@media (max-width: 640px) {
  .dashboard-hero { align-items: flex-start; flex-direction: column-reverse; gap: 18px; }
  .dashboard-hero__eyebrow { align-items: flex-start; flex-wrap: wrap; }
  .dashboard-hero__eyebrow > span { width: 100%; margin-left: 14px; }
  .dashboard-hero p { font-size: var(--font-body-sm); }
}
</style>
