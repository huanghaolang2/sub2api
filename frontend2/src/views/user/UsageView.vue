<script setup lang="ts">
import UsageBoardPanel from '@/components/usage-board/UsageBoardPanel.vue'
import { UsageBoardScope } from '@/api/usageBoard'
import { UsageViewSection } from '@shared-utils/usageBoard'
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as authAPI from '@shared-api/auth'
import * as groupsAPI from '@shared-api/groups'
import * as keysAPI from '@shared-api/keys'
import * as usageAPI from '@shared-api/usage'
import type {
  ApiKey,
  EndpointStat,
  Group,
  GroupStat,
  ModelStat,
  PublicSettings,
  TrendDataPoint,
  UsageLog,
  UsageQueryParams,
  UsageStatsResponse,
  UserErrorRequest
} from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import ErrorDetailDialog from '@/components/user/usage/ErrorDetailDialog.vue'
import {
  BillingModeFilter,
  BillingTypeFilter,
  billingModeLabel,
  billingTypeLabel,
  buildUsageCsv,
  buildUsageQuery,
  ErrorColumnKey,
  errorColumns,
  errorStatusTone,
  formatLatency,
  formatNumber,
  formatUsd,
  requestTypeLabel,
  totalTokens,
  UsageColumnKey,
  usageColumns,
  UsageGranularity,
  UsageRequestFilter,
  UsageSortOrder,
  UsageTab,
  type UsageFilters
} from '@/features/user/usage/model'
import { useAppStore } from '@/stores/app'

enum ChartMetric {
  TOKENS = 'tokens',
  COST = 'cost'
}

enum EndpointSource {
  INBOUND = 'inbound',
  UPSTREAM = 'upstream',
  PATH = 'path'
}

enum ErrorCategoryFilter {
  ALL = '',
  AUTH = 'auth',
  RATE_LIMIT = 'rate_limit',
  QUOTA = 'quota',
  INVALID_REQUEST = 'invalid_request',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  UPSTREAM = 'upstream',
  INTERNAL = 'internal',
  CYBER = 'cyber'
}

interface DistributionItem {
  label: string
  requests: number
  tokens: number
  cost: number
}

const USAGE_COLUMNS_KEY = 'frontend2-usage-hidden-columns-v1'
const ERROR_COLUMNS_KEY = 'frontend2-usage-error-hidden-columns-v1'
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultRange(): { start: string; end: string } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { start: localDate(start), end: localDate(end) }
}

const range = defaultRange()
const app = useAppStore()
const settings = ref<PublicSettings | null>(null)
const apiKeys = ref<ApiKey[]>([])
const groups = ref<Group[]>([])
const logs = ref<UsageLog[]>([])
const stats = ref<UsageStatsResponse | null>(null)
const trend = ref<TrendDataPoint[]>([])
const modelStats = ref<ModelStat[]>([])
const groupStats = ref<GroupStat[]>([])
const endpointStats = ref<EndpointStat[]>([])
const upstreamEndpointStats = ref<EndpointStat[]>([])
const endpointPathStats = ref<EndpointStat[]>([])
const activeTab = ref(UsageTab.USAGE)
const granularity = ref(UsageGranularity.DAY)
const chartMetric = ref(ChartMetric.TOKENS)
const endpointSource = ref(EndpointSource.INBOUND)
const listLoading = ref(true)
const analyticsLoading = ref(true)
const pageError = ref('')
const exporting = ref(false)
const showColumnMenu = ref(false)
const selectedLog = ref<UsageLog | null>(null)
const usageDetailOpen = ref(false)
const selectedErrorId = ref<number | null>(null)
const errorDetailOpen = ref(false)
const hiddenUsageColumns = ref(new Set<UsageColumnKey>())
const hiddenErrorColumns = ref(new Set<ErrorColumnKey>())
const filters = reactive<UsageFilters>({
  startDate: range.start,
  endDate: range.end,
  apiKeyId: '',
  model: '',
  groupId: '',
  requestType: UsageRequestFilter.ALL,
  billingType: BillingTypeFilter.ALL,
  billingMode: BillingModeFilter.ALL
})
const pagination = reactive({ page: 1, pageSize: 20, total: 0, pages: 1 })
const usageSort = reactive({ by: UsageColumnKey.CREATED_AT, order: UsageSortOrder.DESC })
const errors = ref<UserErrorRequest[]>([])
const errorsLoading = ref(false)
const errorPagination = reactive({ page: 1, pageSize: 20, total: 0, pages: 1 })
const errorSort = reactive({ by: 'created_at', order: UsageSortOrder.DESC })
const errorFilters = reactive({ apiKeyId: '', model: '', category: ErrorCategoryFilter.ALL, statusCode: '' })
let listController: AbortController | null = null
let requestSequence = 0

const errorViewEnabled = computed(() => Boolean(settings.value?.allow_user_view_error_requests))
const visibleUsageColumns = computed(() => usageColumns.filter((column) => !hiddenUsageColumns.value.has(column.key)))
const visibleErrorColumns = computed(() => errorColumns.filter((column) => !hiddenErrorColumns.value.has(column.key)))
const currentColumns = computed(() => activeTab.value === UsageTab.USAGE ? usageColumns : errorColumns)
const currentHiddenColumns = computed<Set<string>>(() => activeTab.value === UsageTab.USAGE
  ? hiddenUsageColumns.value as Set<string>
  : hiddenErrorColumns.value as Set<string>)
const pageSizes = computed(() => Array.from(new Set([...(settings.value?.table_page_size_options ?? [10, 20, 50, 100]), pagination.pageSize])).sort((a, b) => a - b))
const modelOptions = computed(() => Array.from(new Set([
  ...modelStats.value.map((item) => item.model),
  ...logs.value.map((item) => item.model),
  filters.model
].filter(Boolean))).sort())

function distributionSort(items: DistributionItem[]): DistributionItem[] {
  const field = chartMetric.value === ChartMetric.TOKENS ? 'tokens' : 'cost'
  return items.sort((left, right) => right[field] - left[field]).slice(0, 7)
}

const modelDistribution = computed(() => distributionSort(modelStats.value.map((item) => ({
  label: item.model,
  requests: item.requests,
  tokens: item.total_tokens,
  cost: item.actual_cost
}))))
const groupDistribution = computed(() => distributionSort(groupStats.value.map((item) => ({
  label: item.group_name,
  requests: item.requests,
  tokens: item.total_tokens,
  cost: item.actual_cost
}))))
const selectedEndpointStats = computed(() => endpointSource.value === EndpointSource.UPSTREAM
  ? upstreamEndpointStats.value
  : endpointSource.value === EndpointSource.PATH ? endpointPathStats.value : endpointStats.value)
const endpointDistribution = computed(() => distributionSort(selectedEndpointStats.value.map((item) => ({
  label: item.endpoint || '未知端点',
  requests: item.requests,
  tokens: item.total_tokens,
  cost: item.actual_cost
}))))
const trendMaximum = computed(() => Math.max(1, ...trend.value.map((item) => chartMetric.value === ChartMetric.TOKENS ? item.total_tokens : item.actual_cost)))

function distributionPercent(item: DistributionItem, items: DistributionItem[]): number {
  const field = chartMetric.value === ChartMetric.TOKENS ? 'tokens' : 'cost'
  const maximum = Math.max(1, ...items.map((entry) => entry[field]))
  return Math.max(2, item[field] / maximum * 100)
}

function distributionValue(item: DistributionItem): string {
  return chartMetric.value === ChartMetric.TOKENS ? formatNumber(item.tokens) : formatUsd(item.cost, 4)
}

function trendPercent(item: TrendDataPoint): number {
  const value = chartMetric.value === ChartMetric.TOKENS ? item.total_tokens : item.actual_cost
  return Math.max(2, value / trendMaximum.value * 100)
}

function restoreColumnSet<T extends string>(key: string, definitions: Array<{ key: T; defaultVisible: boolean }>): Set<T> {
  try {
    const stored = localStorage.getItem(key)
    if (!stored) return new Set(definitions.filter((item) => !item.defaultVisible).map((item) => item.key))
    const valid = new Set(definitions.map((item) => item.key))
    return new Set((JSON.parse(stored) as string[]).filter((item): item is T => valid.has(item as T)))
  } catch {
    return new Set(definitions.filter((item) => !item.defaultVisible).map((item) => item.key))
  }
}

function restoreColumns(): void {
  hiddenUsageColumns.value = restoreColumnSet(USAGE_COLUMNS_KEY, usageColumns)
  hiddenErrorColumns.value = restoreColumnSet(ERROR_COLUMNS_KEY, errorColumns)
}

function toggleCurrentColumn(key: string): void {
  const definitions = currentColumns.value as Array<{ key: string; alwaysVisible?: boolean }>
  if (definitions.find((item) => item.key === key)?.alwaysVisible) return
  if (activeTab.value === UsageTab.USAGE) {
    const next = new Set(hiddenUsageColumns.value)
    const typedKey = key as UsageColumnKey
    if (next.has(typedKey)) next.delete(typedKey)
    else next.add(typedKey)
    hiddenUsageColumns.value = next
    try { localStorage.setItem(USAGE_COLUMNS_KEY, JSON.stringify([...next])) } catch { /* session-only fallback */ }
  } else {
    const next = new Set(hiddenErrorColumns.value)
    const typedKey = key as ErrorColumnKey
    if (next.has(typedKey)) next.delete(typedKey)
    else next.add(typedKey)
    hiddenErrorColumns.value = next
    try { localStorage.setItem(ERROR_COLUMNS_KEY, JSON.stringify([...next])) } catch { /* session-only fallback */ }
  }
}

async function loadSupport(): Promise<void> {
  const [keyResult, groupResult, settingsResult] = await Promise.allSettled([
    keysAPI.list(1, 100, { sort_by: 'created_at', sort_order: 'desc' }),
    groupsAPI.getAvailable(),
    authAPI.getPublicSettings()
  ])
  if (keyResult.status === 'fulfilled') apiKeys.value = keyResult.value.items
  if (groupResult.status === 'fulfilled') groups.value = groupResult.value
  if (settingsResult.status === 'fulfilled') {
    settings.value = settingsResult.value
    const defaultSize = Number(settingsResult.value.table_default_page_size)
    if (defaultSize > 0) {
      pagination.pageSize = defaultSize
      errorPagination.pageSize = defaultSize
    }
  }
}

function baseQuery(): UsageQueryParams {
  const query = buildUsageQuery(filters, 1, pagination.pageSize, usageSort.by, usageSort.order, timezone)
  delete query.page
  delete query.page_size
  delete query.sort_by
  delete query.sort_order
  return query
}

async function loadLogs(): Promise<void> {
  listController?.abort()
  const controller = new AbortController()
  listController = controller
  listLoading.value = true
  pageError.value = ''
  try {
    const response = await usageAPI.query(
      buildUsageQuery(filters, pagination.page, pagination.pageSize, usageSort.by, usageSort.order, timezone),
      { signal: controller.signal }
    )
    if (controller.signal.aborted) return
    logs.value = response.items
    pagination.total = response.total
    pagination.pages = Math.max(1, response.pages || Math.ceil(response.total / pagination.pageSize))
  } catch (caught) {
    const candidate = caught as { name?: string; code?: string; message?: string }
    if (candidate.name !== 'AbortError' && candidate.code !== 'ERR_CANCELED') pageError.value = candidate.message || '用量记录加载失败'
  } finally {
    if (listController === controller) listLoading.value = false
  }
}

async function loadAnalytics(): Promise<void> {
  const sequence = ++requestSequence
  analyticsLoading.value = true
  const params = baseQuery()
  try {
    const [statsResult, modelsResult, snapshotResult] = await Promise.allSettled([
      usageAPI.getStats(params),
      usageAPI.getDashboardModels({ ...params, model_source: 'requested' }),
      usageAPI.getDashboardSnapshotV2({
        ...params,
        granularity: granularity.value,
        include_trend: true,
        include_model_stats: false,
        include_group_stats: true
      })
    ])
    if (sequence !== requestSequence) return
    if (statsResult.status === 'fulfilled') {
      stats.value = statsResult.value
      endpointStats.value = statsResult.value.endpoints ?? []
      upstreamEndpointStats.value = statsResult.value.upstream_endpoints ?? []
      endpointPathStats.value = statsResult.value.endpoint_paths ?? []
    } else stats.value = null
    modelStats.value = modelsResult.status === 'fulfilled' ? modelsResult.value.models : []
    trend.value = snapshotResult.status === 'fulfilled' ? snapshotResult.value.trend ?? [] : []
    groupStats.value = snapshotResult.status === 'fulfilled' ? snapshotResult.value.groups ?? [] : []
  } finally {
    if (sequence === requestSequence) analyticsLoading.value = false
  }
}

function validateRange(): boolean {
  if (!filters.startDate || !filters.endDate) {
    app.showError('请选择完整的开始和结束日期')
    return false
  }
  if (filters.startDate > filters.endDate) {
    app.showError('开始日期不能晚于结束日期')
    return false
  }
  return true
}

function applyFilters(): void {
  if (!validateRange()) return
  pagination.page = 1
  errorPagination.page = 1
  void Promise.all([loadLogs(), loadAnalytics()])
  if (activeTab.value === UsageTab.ERRORS) void loadErrors()
}

function resetFilters(): void {
  const next = defaultRange()
  Object.assign(filters, {
    startDate: next.start,
    endDate: next.end,
    apiKeyId: '',
    model: '',
    groupId: '',
    requestType: UsageRequestFilter.ALL,
    billingType: BillingTypeFilter.ALL,
    billingMode: BillingModeFilter.ALL
  })
  Object.assign(errorFilters, { apiKeyId: '', model: '', category: ErrorCategoryFilter.ALL, statusCode: '' })
  granularity.value = UsageGranularity.DAY
  applyFilters()
}

function refreshAll(): void {
  void Promise.all([loadLogs(), loadAnalytics()])
  if (activeTab.value === UsageTab.ERRORS) void loadErrors()
}

function switchTab(tab: UsageTab): void {
  activeTab.value = tab
  showColumnMenu.value = false
  if (tab === UsageTab.ERRORS && errors.value.length === 0) void loadErrors()
}

function sortUsage(key: UsageColumnKey): void {
  const column = usageColumns.find((item) => item.key === key)
  if (!column?.sortable) return
  if (usageSort.by === key) usageSort.order = usageSort.order === UsageSortOrder.ASC ? UsageSortOrder.DESC : UsageSortOrder.ASC
  else {
    usageSort.by = key
    usageSort.order = UsageSortOrder.ASC
  }
  pagination.page = 1
  void loadLogs()
}

function changeUsagePage(page: number): void {
  if (page < 1 || page > pagination.pages || page === pagination.page) return
  pagination.page = page
  void loadLogs()
}

function changeUsagePageSize(event: Event): void {
  pagination.pageSize = Number((event.target as HTMLSelectElement).value)
  pagination.page = 1
  void loadLogs()
}

async function loadErrors(): Promise<void> {
  if (!errorViewEnabled.value) return
  errorsLoading.value = true
  try {
    const response = await usageAPI.listMyErrorRequests({
      page: errorPagination.page,
      page_size: errorPagination.pageSize,
      start_date: filters.startDate,
      end_date: filters.endDate,
      timezone,
      api_key_id: errorFilters.apiKeyId ? Number(errorFilters.apiKeyId) : undefined,
      model: errorFilters.model.trim() || undefined,
      category: errorFilters.category || undefined,
      status_code: errorFilters.statusCode ? Number(errorFilters.statusCode) : undefined,
      sort_by: errorSort.by,
      sort_order: errorSort.order
    })
    errors.value = response.items
    errorPagination.total = response.total
    errorPagination.pages = Math.max(1, response.pages || Math.ceil(response.total / errorPagination.pageSize))
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '错误请求加载失败')
  } finally {
    errorsLoading.value = false
  }
}

function applyErrorFilters(): void {
  errorPagination.page = 1
  void loadErrors()
}

function sortErrors(key: ErrorColumnKey): void {
  const column = errorColumns.find((item) => item.key === key)
  if (!column?.sortable) return
  const serverKey = key === ErrorColumnKey.STATUS ? 'status_code' : key
  if (errorSort.by === serverKey) errorSort.order = errorSort.order === UsageSortOrder.ASC ? UsageSortOrder.DESC : UsageSortOrder.ASC
  else {
    errorSort.by = serverKey
    errorSort.order = UsageSortOrder.ASC
  }
  errorPagination.page = 1
  void loadErrors()
}

function changeErrorPage(page: number): void {
  if (page < 1 || page > errorPagination.pages || page === errorPagination.page) return
  errorPagination.page = page
  void loadErrors()
}

function changeErrorPageSize(event: Event): void {
  errorPagination.pageSize = Number((event.target as HTMLSelectElement).value)
  errorPagination.page = 1
  void loadErrors()
}

async function exportCsv(): Promise<void> {
  if (exporting.value || pagination.total === 0) {
    if (pagination.total === 0) app.showError('当前筛选没有可导出的记录')
    return
  }
  exporting.value = true
  app.showInfo('正在按当前服务端筛选准备完整 CSV…')
  try {
    const allLogs: UsageLog[] = []
    const pageSize = 100
    const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize))
    for (let page = 1; page <= totalPages; page += 1) {
      const response = await usageAPI.query(buildUsageQuery(filters, page, pageSize, usageSort.by, usageSort.order, timezone))
      allLogs.push(...response.items)
    }
    const blob = new Blob([`\uFEFF${buildUsageCsv(allLogs)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `usage_${filters.startDate}_${filters.endDate}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    app.showSuccess(`已导出 ${allLogs.length} 条用量记录`)
  } catch (caught) {
    app.showError((caught as { message?: string }).message || 'CSV 导出失败')
  } finally {
    exporting.value = false
  }
}

function openUsageDetail(log: UsageLog): void {
  selectedLog.value = log
  usageDetailOpen.value = true
}

function openErrorDetail(row: UserErrorRequest): void {
  selectedErrorId.value = row.id
  errorDetailOpen.value = true
}

async function copyRequestId(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    app.showSuccess('请求 ID 已复制')
  } catch {
    app.showError('复制失败')
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))
}

function errorRequestType(row: UserErrorRequest): string {
  if (row.request_type === 3) return 'WebSocket'
  if (row.request_type === 5) return 'Live'
  if (row.request_type === 2 || row.stream) return '流式'
  if (row.request_type === 1 || row.stream === false) return '同步'
  return '—'
}

onMounted(async () => {
  restoreColumns()
  await loadSupport()
  await Promise.all([loadLogs(), loadAnalytics()])
})

onBeforeUnmount(() => {
  listController?.abort()
  requestSequence += 1
})

const usageSection = ref(UsageViewSection.STATISTICS)
const usageBoardMounted = ref(false)
function openUsageBoard(): void {
  usageBoardMounted.value = true
  usageSection.value = UsageViewSection.BOARD
}
const { t: boardT } = useI18n()

</script>

<template>
  <ConsoleShell>
    <section class="usage-page">
      <header class="page-heading usage-heading">
        <div><p>消费洞察 · 服务端全量查询</p><h1>用量与错误日志</h1><span>从费用趋势下钻到单次调用，并保留完整账单和失败上下文。</span></div>
        <div v-show="usageSection === UsageViewSection.STATISTICS" class="heading-actions"><button class="button button--secondary" type="button" :disabled="listLoading || analyticsLoading" @click="refreshAll">刷新</button><button class="button button--primary" type="button" :disabled="exporting || pagination.total === 0" @click="exportCsv">{{ exporting ? '导出中…' : '导出完整 CSV' }}</button></div>
      </header>
      <nav class="resource-tabs" role="tablist" :aria-label="boardT('usageBoard.title')">
        <button type="button" role="tab" :aria-selected="usageSection === UsageViewSection.STATISTICS" aria-controls="usage-statistics-panel" data-testid="usage-statistics-tab" @click="usageSection = UsageViewSection.STATISTICS">{{ boardT('usageBoard.statistics') }}</button>
        <button type="button" role="tab" :aria-selected="usageSection === UsageViewSection.BOARD" aria-controls="usage-board-panel" data-testid="usage-board-tab" @click="openUsageBoard">{{ boardT('usageBoard.title') }}</button>
      </nav>
      <UsageBoardPanel v-if="usageBoardMounted" v-show="usageSection === UsageViewSection.BOARD" id="usage-board-panel" role="tabpanel" :scope="UsageBoardScope.SELF" />
      <div v-show="usageSection === UsageViewSection.STATISTICS" id="usage-statistics-panel" role="tabpanel" class="usage-statistics-panel">


      <section class="range-bar" aria-label="统计时间范围">
        <label><span>开始日期</span><input v-model="filters.startDate" type="date"></label>
        <span class="range-separator">→</span>
        <label><span>结束日期</span><input v-model="filters.endDate" type="date"></label>
        <label><span>趋势粒度</span><select v-model="granularity" @change="loadAnalytics"><option :value="UsageGranularity.HOUR">小时</option><option :value="UsageGranularity.DAY">天</option></select></label>
        <button type="button" @click="applyFilters">应用时间范围</button>
        <small>时区 {{ timezone }}</small>
      </section>

      <section class="usage-metrics" :aria-busy="analyticsLoading">
        <div><span>请求数</span><strong>{{ formatNumber(stats?.total_requests || 0) }}</strong><small>当前筛选</small></div>
        <div><span>实际扣费</span><strong>{{ formatUsd(stats?.total_actual_cost || 0, 4) }}</strong><small>标准 {{ formatUsd(stats?.total_cost || 0, 4) }}</small></div>
        <div><span>总 Token</span><strong>{{ formatNumber(stats?.total_tokens || 0) }}</strong><small>输入 + 输出 + 缓存</small></div>
        <div><span>缓存读取</span><strong>{{ formatNumber(stats?.total_cache_read_tokens || 0) }}</strong><small>写入 {{ formatNumber(stats?.total_cache_creation_tokens || 0) }}</small></div>
        <div><span>平均耗时</span><strong>{{ formatLatency(stats?.average_duration_ms ?? null) }}</strong><small>端到端</small></div>
      </section>

      <section class="analytics-grid">
        <article class="trend-panel">
          <header><div><strong>消费趋势</strong><small>{{ filters.startDate }} 至 {{ filters.endDate }}</small></div><nav><button type="button" :class="{ active: chartMetric === ChartMetric.TOKENS }" @click="chartMetric = ChartMetric.TOKENS">Token</button><button type="button" :class="{ active: chartMetric === ChartMetric.COST }" @click="chartMetric = ChartMetric.COST">费用</button></nav></header>
          <div v-if="analyticsLoading" class="chart-state">正在计算趋势…</div>
          <div v-else-if="trend.length === 0" class="chart-state">当前范围暂无趋势数据</div>
          <div v-else class="trend-chart"><div v-for="point in trend" :key="point.date" class="trend-column" :title="`${point.date} · ${chartMetric === ChartMetric.TOKENS ? formatNumber(point.total_tokens) : formatUsd(point.actual_cost)}`"><i :style="{ height: `${trendPercent(point)}%` }"></i><span>{{ point.date.slice(5) }}</span></div></div>
        </article>

        <article class="distribution-panel">
          <header><strong>模型分布</strong><small>Top {{ modelDistribution.length }}</small></header>
          <div v-if="modelDistribution.length === 0" class="chart-state">暂无模型数据</div>
          <div v-else class="distribution-list"><div v-for="item in modelDistribution" :key="item.label"><p><span>{{ item.label }}</span><strong>{{ distributionValue(item) }}</strong></p><i><b :style="{ width: `${distributionPercent(item, modelDistribution)}%` }"></b></i><small>{{ formatNumber(item.requests) }} 次请求</small></div></div>
        </article>

        <article class="distribution-panel">
          <header><strong>分组分布</strong><small>实际归属</small></header>
          <div v-if="groupDistribution.length === 0" class="chart-state">暂无分组数据</div>
          <div v-else class="distribution-list"><div v-for="item in groupDistribution" :key="item.label"><p><span>{{ item.label }}</span><strong>{{ distributionValue(item) }}</strong></p><i><b :style="{ width: `${distributionPercent(item, groupDistribution)}%` }"></b></i><small>{{ formatNumber(item.requests) }} 次请求</small></div></div>
        </article>

        <article class="distribution-panel endpoint-panel">
          <header><strong>端点分布</strong><nav><button type="button" :class="{ active: endpointSource === EndpointSource.INBOUND }" @click="endpointSource = EndpointSource.INBOUND">入口</button><button type="button" :class="{ active: endpointSource === EndpointSource.UPSTREAM }" @click="endpointSource = EndpointSource.UPSTREAM">上游</button><button type="button" :class="{ active: endpointSource === EndpointSource.PATH }" @click="endpointSource = EndpointSource.PATH">路径</button></nav></header>
          <div v-if="endpointDistribution.length === 0" class="chart-state">暂无端点数据</div>
          <div v-else class="distribution-list"><div v-for="item in endpointDistribution" :key="item.label"><p><span>{{ item.label }}</span><strong>{{ distributionValue(item) }}</strong></p><i><b :style="{ width: `${distributionPercent(item, endpointDistribution)}%` }"></b></i><small>{{ formatNumber(item.requests) }} 次请求</small></div></div>
        </article>
      </section>

      <section class="logs-workspace">
        <nav v-if="errorViewEnabled" class="log-tabs" aria-label="日志类型"><button type="button" :class="{ active: activeTab === UsageTab.USAGE }" @click="switchTab(UsageTab.USAGE)">成功用量 <span>{{ pagination.total }}</span></button><button type="button" :class="{ active: activeTab === UsageTab.ERRORS }" @click="switchTab(UsageTab.ERRORS)">错误请求 <span>{{ errorPagination.total }}</span></button></nav>

        <section v-if="activeTab === UsageTab.USAGE" class="filter-panel" aria-label="用量筛选">
          <label><span>API Key</span><select v-model="filters.apiKeyId" @change="applyFilters"><option value="">全部 Key</option><option v-for="key in apiKeys" :key="key.id" :value="String(key.id)">{{ key.name }}</option></select></label>
          <label><span>模型</span><input v-model="filters.model" list="usage-model-options" placeholder="全部模型" @keyup.enter="applyFilters"><datalist id="usage-model-options"><option v-for="model in modelOptions" :key="model" :value="model" /></datalist></label>
          <label><span>分组</span><select v-model="filters.groupId" @change="applyFilters"><option value="">全部分组</option><option v-for="group in groups" :key="group.id" :value="String(group.id)">{{ group.name }}</option></select></label>
          <label><span>请求类型</span><select v-model="filters.requestType" @change="applyFilters"><option :value="UsageRequestFilter.ALL">全部</option><option :value="UsageRequestFilter.SYNC">同步</option><option :value="UsageRequestFilter.STREAM">流式</option><option :value="UsageRequestFilter.WS_V2">WebSocket</option><option :value="UsageRequestFilter.CYBER">Cyber</option><option :value="UsageRequestFilter.LIVE">Live</option></select></label>
          <label><span>扣费来源</span><select v-model="filters.billingType" @change="applyFilters"><option :value="BillingTypeFilter.ALL">全部</option><option :value="BillingTypeFilter.BALANCE">账户余额</option><option :value="BillingTypeFilter.SUBSCRIPTION">订阅额度</option></select></label>
          <label><span>计费模式</span><select v-model="filters.billingMode" @change="applyFilters"><option :value="BillingModeFilter.ALL">全部</option><option :value="BillingModeFilter.TOKEN">Token</option><option :value="BillingModeFilter.PER_REQUEST">按次</option><option :value="BillingModeFilter.IMAGE">图片</option><option :value="BillingModeFilter.VIDEO">视频</option></select></label>
          <button type="button" @click="applyFilters">查询</button><button type="button" @click="resetFilters">重置</button>
          <div class="column-picker"><button type="button" :aria-expanded="showColumnMenu" @click="showColumnMenu = !showColumnMenu">显示字段 · {{ visibleUsageColumns.length }}</button><div v-if="showColumnMenu"><strong>用量字段</strong><label v-for="column in currentColumns" :key="column.key"><input type="checkbox" :checked="!currentHiddenColumns.has(column.key)" :disabled="column.alwaysVisible" @change="toggleCurrentColumn(column.key)"><span>{{ column.label }}</span></label></div></div>
        </section>

        <section v-else class="filter-panel error-filter-panel" aria-label="错误日志筛选">
          <label><span>API Key</span><select v-model="errorFilters.apiKeyId" @change="applyErrorFilters"><option value="">全部 Key</option><option v-for="key in apiKeys" :key="key.id" :value="String(key.id)">{{ key.name }}</option></select></label>
          <label><span>模型</span><input v-model="errorFilters.model" placeholder="输入模型关键字" @keyup.enter="applyErrorFilters"></label>
          <label><span>错误分类</span><select v-model="errorFilters.category" @change="applyErrorFilters"><option :value="ErrorCategoryFilter.ALL">全部分类</option><option :value="ErrorCategoryFilter.AUTH">鉴权</option><option :value="ErrorCategoryFilter.RATE_LIMIT">限流</option><option :value="ErrorCategoryFilter.QUOTA">额度</option><option :value="ErrorCategoryFilter.INVALID_REQUEST">无效请求</option><option :value="ErrorCategoryFilter.SERVICE_UNAVAILABLE">服务不可用</option><option :value="ErrorCategoryFilter.UPSTREAM">上游</option><option :value="ErrorCategoryFilter.INTERNAL">内部错误</option><option :value="ErrorCategoryFilter.CYBER">Cyber</option></select></label>
          <label><span>状态码</span><select v-model="errorFilters.statusCode" @change="applyErrorFilters"><option value="">全部状态</option><option v-for="code in [400,401,403,404,408,413,429,499,500,502,503,504,529]" :key="code" :value="String(code)">{{ code }}</option></select></label>
          <button type="button" @click="applyErrorFilters">查询</button><button type="button" @click="resetFilters">重置</button>
          <div class="column-picker"><button type="button" :aria-expanded="showColumnMenu" @click="showColumnMenu = !showColumnMenu">显示字段 · {{ visibleErrorColumns.length }}</button><div v-if="showColumnMenu"><strong>错误字段</strong><label v-for="column in currentColumns" :key="column.key"><input type="checkbox" :checked="!currentHiddenColumns.has(column.key)" :disabled="column.alwaysVisible" @change="toggleCurrentColumn(column.key)"><span>{{ column.label }}</span></label></div></div>
        </section>

        <template v-if="activeTab === UsageTab.USAGE">
          <PageState :loading="listLoading" :error="pageError" :empty="!listLoading && !pageError && logs.length === 0" empty-text="当前筛选没有用量记录。" @retry="loadLogs">
            <div class="log-table-wrap"><table class="usage-table"><thead><tr><th v-for="column in visibleUsageColumns" :key="column.key"><button v-if="column.sortable" type="button" @click="sortUsage(column.key)">{{ column.label }} <span v-if="usageSort.by === column.key">{{ usageSort.order === UsageSortOrder.ASC ? '↑' : '↓' }}</span></button><span v-else>{{ column.label }}</span></th></tr></thead><tbody><tr v-for="log in logs" :key="log.id">
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.API_KEY)"><strong>{{ log.api_key?.name || `#${log.api_key_id}` }}</strong></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.MODEL)" class="model-cell"><strong>{{ log.model }}</strong><small v-if="log.service_tier">{{ log.service_tier }}</small></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.REASONING)">{{ log.reasoning_effort || '—' }}</td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.ENDPOINT)" class="endpoint-cell"><code>{{ log.inbound_endpoint || '—' }}</code></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.IP)"><code>{{ log.ip_address || '—' }}</code></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.GROUP)"><span class="soft-badge">{{ log.group?.name || '—' }}</span></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.REQUEST_TYPE)"><span class="soft-badge">{{ requestTypeLabel(log) }}</span></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.BILLING)" class="billing-cell"><strong>{{ billingModeLabel(log) }}</strong><small>{{ billingTypeLabel(log.billing_type) }} · {{ log.rate_multiplier }}×</small></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.TOKENS)" class="tokens-cell"><template v-if="log.image_count > 0 && log.billing_mode !== 'token'"><strong>{{ log.image_count }} 张</strong><small>{{ log.image_output_size || log.image_size || '默认尺寸' }}</small></template><template v-else><div><span>↓ {{ formatNumber(log.input_tokens) }}</span><span>↑ {{ formatNumber(log.output_tokens) }}</span></div><small v-if="log.cache_read_tokens || log.cache_creation_tokens">缓存读 {{ formatNumber(log.cache_read_tokens) }} · 写 {{ formatNumber(log.cache_creation_tokens) }}</small><small v-if="log.image_input_tokens || log.image_output_tokens">图片入 {{ formatNumber(log.image_input_tokens) }} · 出 {{ formatNumber(log.image_output_tokens) }}</small></template></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.COST)" class="cost-cell"><strong>{{ formatUsd(log.actual_cost) }}</strong><small>标准 {{ formatUsd(log.total_cost) }}</small><span v-if="log.long_context_billing_applied">长上下文 ×2</span></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.LATENCY)" class="latency-cell"><span>首字 {{ formatLatency(log.first_token_ms) }}</span><span>总计 {{ formatLatency(log.duration_ms) }}</span></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.CREATED_AT)" class="date-cell">{{ formatDate(log.created_at) }}</td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.REQUEST_ID)" class="request-cell"><code>{{ log.request_id }}</code><button type="button" @click="copyRequestId(log.request_id)">复制</button></td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.USER_AGENT)" class="ua-cell" :title="log.user_agent || ''">{{ log.user_agent || '—' }}</td>
              <td v-if="!hiddenUsageColumns.has(UsageColumnKey.ACTIONS)" class="sticky-action"><button type="button" @click="openUsageDetail(log)">查看账单</button></td>
            </tr></tbody></table></div>
            <footer class="pagination-bar"><p>第 {{ pagination.page }} / {{ pagination.pages }} 页 · 共 {{ pagination.total }} 条</p><label>每页 <select :value="pagination.pageSize" @change="changeUsagePageSize"><option v-for="size in pageSizes" :key="size" :value="size">{{ size }}</option></select> 条</label><nav><button type="button" :disabled="pagination.page <= 1" @click="changeUsagePage(pagination.page - 1)">上一页</button><button type="button" :disabled="pagination.page >= pagination.pages" @click="changeUsagePage(pagination.page + 1)">下一页</button></nav></footer>
          </PageState>
        </template>

        <template v-else>
          <div v-if="errorsLoading" class="table-state">正在加载错误请求…</div>
          <div v-else-if="errors.length === 0" class="table-state">当前筛选没有错误请求。</div>
          <div v-else class="log-table-wrap"><table class="error-table"><thead><tr><th v-for="column in visibleErrorColumns" :key="column.key"><button v-if="column.sortable" type="button" @click="sortErrors(column.key)">{{ column.label }} <span v-if="errorSort.by === (column.key === ErrorColumnKey.STATUS ? 'status_code' : column.key)">{{ errorSort.order === UsageSortOrder.ASC ? '↑' : '↓' }}</span></button><span v-else>{{ column.label }}</span></th></tr></thead><tbody><tr v-for="row in errors" :key="row.id" @dblclick="openErrorDetail(row)">
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.KEY)"><strong>{{ row.key_name || '—' }}</strong><small v-if="row.key_deleted" class="danger-text">已删除</small></td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.MODEL)"><strong>{{ row.model || '—' }}</strong></td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.ENDPOINT)" class="endpoint-cell"><code>{{ row.inbound_endpoint || '—' }}</code></td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.IP)"><code>{{ row.client_ip || '—' }}</code></td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.GROUP)"><span class="soft-badge">{{ row.group_name || '—' }}</span></td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.TYPE)">{{ errorRequestType(row) }}</td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.PLATFORM)">{{ row.platform || '—' }}</td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.CATEGORY)">{{ row.category || '—' }}</td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.STATUS)"><span :class="['status-code', `status-code--${errorStatusTone(row.status_code)}`]">{{ row.status_code }}</span></td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.MESSAGE)" class="message-cell" :title="row.message">{{ row.message || '—' }}</td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.CREATED_AT)" class="date-cell">{{ formatDate(row.created_at) }}</td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.USER_AGENT)" class="ua-cell" :title="row.user_agent || ''">{{ row.user_agent || '—' }}</td>
            <td v-if="!hiddenErrorColumns.has(ErrorColumnKey.ACTIONS)" class="sticky-action"><button type="button" @click="openErrorDetail(row)">查看错误</button></td>
          </tr></tbody></table></div>
          <footer v-if="errorPagination.total > 0" class="pagination-bar"><p>第 {{ errorPagination.page }} / {{ errorPagination.pages }} 页 · 共 {{ errorPagination.total }} 条</p><label>每页 <select :value="errorPagination.pageSize" @change="changeErrorPageSize"><option v-for="size in pageSizes" :key="size" :value="size">{{ size }}</option></select> 条</label><nav><button type="button" :disabled="errorPagination.page <= 1" @click="changeErrorPage(errorPagination.page - 1)">上一页</button><button type="button" :disabled="errorPagination.page >= errorPagination.pages" @click="changeErrorPage(errorPagination.page + 1)">下一页</button></nav></footer>
        </template>
      </section>
      </div>
    </section>

    <SurfaceDialog :show="usageDetailOpen" title="单次调用账单" :description="selectedLog ? `请求 ${selectedLog.request_id}` : ''" :width="DialogWidth.WIDE" @close="usageDetailOpen = false">
      <div v-if="selectedLog" class="usage-detail">
        <section class="detail-grid"><div><span>时间</span><strong>{{ formatDate(selectedLog.created_at) }}</strong></div><div><span>请求 ID</span><strong>{{ selectedLog.request_id }}</strong></div><div><span>API Key</span><strong>{{ selectedLog.api_key?.name || `#${selectedLog.api_key_id}` }}</strong></div><div><span>分组</span><strong>{{ selectedLog.group?.name || '—' }}</strong></div><div><span>模型</span><strong>{{ selectedLog.model }}</strong></div><div><span>Service Tier</span><strong>{{ selectedLog.service_tier || '—' }}</strong></div><div><span>推理强度</span><strong>{{ selectedLog.reasoning_effort || '—' }}</strong></div><div><span>请求类型</span><strong>{{ requestTypeLabel(selectedLog) }}</strong></div><div><span>计费模式</span><strong>{{ billingModeLabel(selectedLog) }} · {{ billingTypeLabel(selectedLog.billing_type) }}</strong></div><div><span>倍率</span><strong>{{ selectedLog.rate_multiplier }}×</strong></div><div><span>入口端点</span><strong>{{ selectedLog.inbound_endpoint || '—' }}</strong></div><div><span>客户端 IP</span><strong>{{ selectedLog.ip_address || '—' }}</strong></div></section>
        <section class="token-ledger"><div><span>文本输入</span><strong>{{ formatNumber(selectedLog.input_tokens) }}</strong><small>{{ formatUsd(selectedLog.input_cost) }}</small></div><div><span>文本输出</span><strong>{{ formatNumber(selectedLog.output_tokens) }}</strong><small>{{ formatUsd(selectedLog.output_cost) }}</small></div><div><span>缓存读取</span><strong>{{ formatNumber(selectedLog.cache_read_tokens) }}</strong><small>{{ formatUsd(selectedLog.cache_read_cost) }}</small></div><div><span>缓存写入</span><strong>{{ formatNumber(selectedLog.cache_creation_tokens) }}</strong><small>5m {{ formatNumber(selectedLog.cache_creation_5m_tokens) }} · 1h {{ formatNumber(selectedLog.cache_creation_1h_tokens) }}</small></div><div><span>图片输入</span><strong>{{ formatNumber(selectedLog.image_input_tokens) }}</strong><small>{{ formatUsd(selectedLog.image_input_cost) }}</small></div><div><span>图片输出</span><strong>{{ formatNumber(selectedLog.image_output_tokens) }}</strong><small>{{ formatUsd(selectedLog.image_output_cost) }}</small></div></section>
        <section class="bill-total"><div><span>标准计费</span><strong>{{ formatUsd(selectedLog.total_cost, 8) }}</strong></div><div><span>实际扣费</span><strong>{{ formatUsd(selectedLog.actual_cost, 8) }}</strong></div><div><span>首字延迟</span><strong>{{ formatLatency(selectedLog.first_token_ms) }}</strong></div><div><span>总耗时</span><strong>{{ formatLatency(selectedLog.duration_ms) }}</strong></div></section>
        <section class="detail-note"><strong>Token 合计</strong><span>{{ formatNumber(totalTokens(selectedLog)) }} · 输入、输出、缓存读写合计</span></section>
        <section v-if="selectedLog.image_count > 0" class="detail-note"><strong>图片计费</strong><span>{{ selectedLog.image_count }} 张 · 输入 {{ selectedLog.image_input_size || '—' }} · 输出 {{ selectedLog.image_output_size || selectedLog.image_size || '—' }} · 来源 {{ selectedLog.image_size_source || '—' }}</span></section>
        <section class="detail-note"><strong>计费标记</strong><span>长上下文 {{ selectedLog.long_context_billing_applied ? '已应用' : '未应用' }} · 缓存 TTL 重写 {{ selectedLog.cache_ttl_overridden ? '是' : '否' }}</span></section>
        <section v-if="selectedLog.user_agent" class="detail-note"><strong>User-Agent</strong><code>{{ selectedLog.user_agent }}</code></section>
      </div>
      <template #footer><button type="button" class="button button--secondary" @click="usageDetailOpen = false">关闭</button></template>
    </SurfaceDialog>
    <ErrorDetailDialog :show="errorDetailOpen" :error-id="selectedErrorId" @close="errorDetailOpen = false" />
  </ConsoleShell>
</template>

<style scoped>
.usage-page { min-width: 0; }.usage-heading { align-items: flex-end; }.usage-heading > div:first-child { max-width: 760px; }.usage-heading h1 { font-size: clamp(38px, 5vw, 66px); }.usage-heading span { display: block; margin-top: 11px; color: var(--text-secondary); font-size: 13px; }.heading-actions { display: flex; gap: 8px; }
.range-bar { margin-bottom: 22px; padding: 12px 14px; display: flex; align-items: end; flex-wrap: wrap; gap: 9px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.range-bar label { display: grid; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); }.range-bar input, .range-bar select { min-height: 38px; padding: 0 9px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; }.range-bar > button { min-height: 38px; padding: 0 12px; color: white; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }.range-bar small { margin-left: auto; align-self: center; color: var(--text-secondary); }.range-separator { padding-bottom: 11px; color: var(--text-secondary); }
.usage-metrics { margin-bottom: 20px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-block: 1px solid var(--border-subtle); }.usage-metrics > div { padding: 18px 17px; display: grid; gap: 6px; border-right: 1px solid var(--border-subtle); }.usage-metrics > div:first-child { padding-left: 0; }.usage-metrics > div:last-child { border-right: 0; }.usage-metrics span, .usage-metrics small { color: var(--text-secondary); font-size: var(--font-meta); }.usage-metrics strong { font-size: clamp(18px, 2.2vw, 27px); letter-spacing: -.04em; }
.analytics-grid { margin-bottom: 26px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--border-subtle); border: 1px solid var(--border-subtle); }.analytics-grid > article { min-height: 270px; padding: 18px; display: grid; grid-template-rows: auto 1fr; gap: 15px; background: var(--surface-raised); }.analytics-grid header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.analytics-grid header > div, .distribution-panel header { display: flex; align-items: baseline; gap: 7px; }.analytics-grid header strong { font-size: 13px; }.analytics-grid header small { color: var(--text-secondary); font-size: var(--font-meta); }.analytics-grid nav { display: flex; gap: 3px; }.analytics-grid nav button { min-height: 28px; padding: 0 7px; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 6px; cursor: pointer; font-size: var(--font-meta); }.analytics-grid nav button.active { color: var(--accent); border-color: var(--accent); }.chart-state { display: grid; place-content: center; color: var(--text-secondary); font-size: var(--font-meta); }.trend-chart { min-height: 195px; display: flex; align-items: flex-end; gap: 5px; overflow-x: auto; border-bottom: 1px solid var(--border-subtle); }.trend-column { min-width: 25px; height: 170px; flex: 1; display: grid; grid-template-rows: 1fr auto; align-items: end; gap: 6px; }.trend-column i { width: 100%; min-height: 3px; display: block; background: linear-gradient(to top, var(--accent), color-mix(in srgb, var(--accent) 45%, transparent)); border-radius: 4px 4px 0 0; }.trend-column span { color: var(--text-secondary); text-align: center; font-size: var(--font-caption); white-space: nowrap; }
.distribution-list { display: grid; align-content: start; gap: 10px; }.distribution-list > div { display: grid; gap: 4px; }.distribution-list p { margin: 0; display: flex; justify-content: space-between; gap: 14px; font-size: var(--font-meta); }.distribution-list p span { max-width: 72%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.distribution-list p strong { font-variant-numeric: tabular-nums; }.distribution-list i { height: 4px; overflow: hidden; background: var(--surface-canvas); border-radius: 99px; }.distribution-list i b { height: 100%; display: block; background: var(--accent); }.distribution-list small { color: var(--text-secondary); font-size: var(--font-caption); }
.logs-workspace { min-width: 0; }.log-tabs { display: flex; border-bottom: 1px solid var(--border-subtle); }.log-tabs button { min-height: 43px; padding: 0 15px; color: var(--text-secondary); background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }.log-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }.log-tabs span { margin-left: 5px; padding: 2px 5px; background: var(--surface-raised); border-radius: 99px; font-size: var(--font-meta); }
.filter-panel { position: relative; z-index: 5; padding: 12px; display: grid; grid-template-columns: repeat(6, minmax(110px, 1fr)) auto auto auto; align-items: end; gap: 7px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-top: 0; }.filter-panel > label { display: grid; gap: 4px; color: var(--text-secondary); font-size: var(--font-meta); }.filter-panel input, .filter-panel select { width: 100%; min-height: 37px; padding: 0 8px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; }.filter-panel > button, .column-picker > button { min-height: 37px; padding: 0 9px; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; white-space: nowrap; font-size: var(--font-meta); }.error-filter-panel { grid-template-columns: repeat(4, minmax(130px, 1fr)) auto auto auto; }.column-picker { position: relative; }.column-picker > div { position: absolute; z-index: 10; top: calc(100% + 6px); right: 0; width: 215px; max-height: 390px; padding: 11px; display: grid; gap: 3px; overflow: auto; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 10px; box-shadow: 0 18px 45px rgba(10, 8, 18, .17); }.column-picker > div > strong { padding: 4px 5px 8px; font-size: var(--font-meta); }.column-picker > div label { padding: 5px; display: flex; gap: 7px; color: var(--text-primary); font-size: var(--font-meta); cursor: pointer; }.column-picker input { width: auto; min-height: auto; accent-color: var(--accent); }
.log-table-wrap { overflow: auto; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-top: 0; }.log-table-wrap table { width: 100%; min-width: 1590px; border-collapse: collapse; }.log-table-wrap th, .log-table-wrap td { padding: 12px 13px; vertical-align: top; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }.log-table-wrap th { color: var(--text-secondary); background: var(--surface-raised); font-size: var(--font-meta); letter-spacing: .05em; text-transform: uppercase; }.log-table-wrap th button { padding: 0; color: inherit; background: transparent; border: 0; cursor: pointer; font: inherit; text-transform: inherit; letter-spacing: inherit; }.log-table-wrap tbody tr:last-child td { border-bottom: 0; }.log-table-wrap tbody tr:hover td { background: color-mix(in srgb, var(--accent) 2.5%, var(--surface-raised)); }.log-table-wrap td strong, .log-table-wrap td small { display: block; }.log-table-wrap td small { margin-top: 4px; color: var(--text-secondary); }.model-cell { min-width: 150px; }.endpoint-cell { min-width: 190px; max-width: 270px; }.endpoint-cell code { overflow-wrap: anywhere; }.soft-badge { padding: 3px 6px; display: inline-flex; color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 5px; white-space: nowrap; }.billing-cell { min-width: 110px; }.tokens-cell { min-width: 170px; }.tokens-cell > div { display: flex; gap: 8px; }.cost-cell { min-width: 110px; }.cost-cell strong { color: var(--success); }.cost-cell span { margin-top: 4px; padding: 2px 4px; display: inline-flex; color: #a36400; background: #fff5d8; border-radius: 4px; font-size: var(--font-caption); }.latency-cell { min-width: 115px; }.latency-cell span { display: block; margin-bottom: 4px; }.date-cell { min-width: 145px; white-space: nowrap; }.request-cell { min-width: 190px; }.request-cell code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.request-cell button, .sticky-action button { margin-top: 5px; padding: 4px 7px; color: var(--accent); background: transparent; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-subtle)); border-radius: 5px; cursor: pointer; font-size: var(--font-meta); }.ua-cell, .message-cell { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.sticky-action { position: sticky; right: 0; min-width: 85px; background: var(--surface-raised); box-shadow: -10px 0 16px -16px #000; }.status-code { padding: 4px 6px; display: inline-flex; border: 1px solid var(--border-subtle); border-radius: 99px; }.status-code--danger { color: var(--danger); border-color: var(--danger); }.status-code--warning { color: #b06c00; border-color: #b06c00; }.danger-text { color: var(--danger) !important; }
.table-state { min-height: 220px; display: grid; place-content: center; color: var(--text-secondary); border: 1px solid var(--border-subtle); border-top: 0; }.pagination-bar { min-height: 63px; padding: 11px 2px; display: flex; align-items: center; gap: 16px; color: var(--text-secondary); font-size: var(--font-meta); }.pagination-bar p { margin: 0 auto 0 0; }.pagination-bar label { display: flex; align-items: center; gap: 5px; }.pagination-bar select, .pagination-bar button { min-height: 32px; padding: 0 8px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 6px; }.pagination-bar nav { display: flex; gap: 4px; }.pagination-bar button { cursor: pointer; }.pagination-bar button:disabled { opacity: .45; cursor: default; }
.usage-detail { display: grid; gap: 13px; }.detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--border-subtle); border-radius: 11px; overflow: hidden; }.detail-grid > div { min-width: 0; padding: 11px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); }.detail-grid > div:nth-child(3n) { border-right: 0; }.detail-grid > div:nth-last-child(-n+3) { border-bottom: 0; }.detail-grid span, .token-ledger span, .bill-total span { color: var(--text-secondary); font-size: var(--font-meta); text-transform: uppercase; letter-spacing: .05em; }.detail-grid strong { overflow-wrap: anywhere; font-size: var(--font-meta); }.token-ledger { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--border-subtle); border: 1px solid var(--border-subtle); }.token-ledger > div { padding: 13px; display: grid; gap: 6px; background: var(--surface-canvas); }.token-ledger strong { font-size: 17px; }.token-ledger small { color: var(--text-secondary); font-size: var(--font-meta); }.bill-total { display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--border-subtle); }.bill-total > div { padding: 14px; display: grid; gap: 7px; border-right: 1px solid var(--border-subtle); }.bill-total > div:last-child { border-right: 0; }.bill-total strong { font-size: 15px; }.detail-note { padding: 11px 13px; display: flex; align-items: baseline; gap: 10px; background: var(--surface-canvas); border-left: 3px solid var(--accent); border-radius: 5px; font-size: var(--font-meta); }.detail-note span, .detail-note code { color: var(--text-secondary); overflow-wrap: anywhere; }
@media (max-width: 1120px) { .usage-metrics { grid-template-columns: repeat(3, 1fr); }.usage-metrics > div:nth-child(3) { border-right: 0; }.usage-metrics > div:nth-child(-n+3) { border-bottom: 1px solid var(--border-subtle); }.filter-panel { grid-template-columns: repeat(3, 1fr); }.error-filter-panel { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 760px) { .usage-heading { align-items: stretch; }.heading-actions { width: 100%; }.heading-actions .button { flex: 1; }.range-separator { display: none; }.range-bar label { flex: 1 1 130px; }.range-bar small { width: 100%; margin: 0; }.usage-metrics { grid-template-columns: repeat(2, 1fr); }.usage-metrics > div { padding: 13px 10px; border-bottom: 1px solid var(--border-subtle); }.usage-metrics > div:first-child { padding-left: 10px; }.usage-metrics > div:nth-child(odd) { border-right: 1px solid var(--border-subtle); }.usage-metrics > div:nth-child(even) { border-right: 0; }.analytics-grid { grid-template-columns: 1fr; }.filter-panel, .error-filter-panel { grid-template-columns: repeat(2, 1fr); }.column-picker { grid-column: span 2; }.column-picker > button { width: 100%; }.detail-grid, .token-ledger { grid-template-columns: 1fr 1fr; }.detail-grid > div { border-right: 1px solid var(--border-subtle) !important; border-bottom: 1px solid var(--border-subtle) !important; }.detail-grid > div:nth-child(even) { border-right: 0 !important; }.bill-total { grid-template-columns: 1fr 1fr; }.bill-total > div:nth-child(2) { border-right: 0; }.bill-total > div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); } }
</style>

<style scoped>
.usage-statistics-panel { display: grid; gap: 24px; min-width: 0; }
</style>
