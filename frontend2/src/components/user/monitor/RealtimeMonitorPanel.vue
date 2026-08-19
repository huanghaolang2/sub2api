<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as monitorAPI from '@shared-api/channelMonitorV2'
import type {
  MonitorDimensions,
  MonitorErrorRow,
  MonitorFilter,
  MonitorMatrixGroupBy,
  MonitorMatrixRow,
  MonitorModelRow,
  MonitorRange,
  MonitorSnapshot,
  MonitorUserRow
} from '@shared-api/channelMonitorV2'
import MonitorFilterMenu, { type MonitorFilterOption } from './MonitorFilterMenu.vue'
import {
  formatMonitorMs,
  formatMonitorPercent,
  formatThroughput,
  healthClass,
  latencySummary,
  lineChartPoints,
  matrixRowLabel,
  MonitorDetailTab,
  MonitorHealthMode,
  MonitorTrendView,
  sliceByZoom,
  successRate,
  tokensPerSecond,
  zoomWindow,
  type ZoomWindow
} from '@/features/user/monitor/model'
import { useAuthStore } from '@/stores/auth'
import { isChannelMonitorThroughputHidden } from '@/utils/featureFlags'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const rangeOptions: Array<{ value: MonitorRange; label: string }> = [
  { value: '90m', label: '90 分钟' },
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' }
]
const groupByOptions: Array<{ value: MonitorMatrixGroupBy; label: string }> = [
  { value: 'platform', label: '按平台' },
  { value: 'platform_group', label: '平台 / 分组' },
  { value: 'platform_model', label: '平台 / 模型' },
  { value: 'platform_group_model', label: '平台 / 分组 / 模型' }
]
const healthOptions = [
  { value: MonitorHealthMode.OVERALL, label: '综合' },
  { value: MonitorHealthMode.SUCCESS, label: '成功率' },
  { value: MonitorHealthMode.TTFT, label: '首字延迟' },
  { value: MonitorHealthMode.CACHE, label: '缓存率' }
]

function csv(value: unknown): string[] {
  return typeof value === 'string' ? value.split(',').filter(Boolean) : []
}

function parseRange(value: unknown): MonitorRange {
  return ['90m', '24h', '7d', '30d'].includes(String(value)) ? value as MonitorRange : '90m'
}

function parseGroupBy(value: unknown): MonitorMatrixGroupBy {
  return groupByOptions.some((option) => option.value === value) ? value as MonitorMatrixGroupBy : 'platform_group'
}

function parseHealthMode(value: unknown): MonitorHealthMode {
  return Object.values(MonitorHealthMode).includes(value as MonitorHealthMode) ? value as MonitorHealthMode : MonitorHealthMode.OVERALL
}

function parseTab(value: unknown): MonitorDetailTab {
  return Object.values(MonitorDetailTab).includes(value as MonitorDetailTab) ? value as MonitorDetailTab : MonitorDetailTab.MODELS
}

const filter = reactive<MonitorFilter>({
  range: parseRange(route.query.range),
  platforms: csv(route.query.platform),
  groupIds: csv(route.query.group).map(Number).filter((id) => id > 0),
  models: csv(route.query.model)
})
const dimensions = ref<MonitorDimensions>({ platforms: [], groups: [], models: [] })
const snapshot = ref<MonitorSnapshot | null>(null)
const matrixRows = ref<MonitorMatrixRow[]>([])
const modelRows = ref<MonitorModelRow[]>([])
const errorRows = ref<MonitorErrorRow[]>([])
const userRows = ref<MonitorUserRow[]>([])
const groupBy = ref(parseGroupBy(route.query.group_by))
const healthMode = ref(parseHealthMode(route.query.health_mode))
const trendView = ref(route.query.trend_view === MonitorTrendView.LINE ? MonitorTrendView.LINE : MonitorTrendView.PULSE)
const activeTab = ref(parseTab(route.query.tab))
const loading = ref(true)
const tabLoading = ref(false)
const refreshing = ref(false)
const error = ref('')
const expandedErrors = ref(new Set<string>())
const zoom = ref<ZoomWindow>({ start: 0, span: 1 })
const autoRefresh = ref(true)
const countdown = ref(60)
let controller: AbortController | null = null
let sequence = 0
let timer: number | null = null

const showThroughput = computed(() => auth.isAdmin || !isChannelMonitorThroughputHidden())
const platformOptions = computed<MonitorFilterOption[]>(() => dimensions.value.platforms.map((item) => ({ value: item.value, label: item.label, count: item.request_count })))
const selectedPlatforms = computed(() => new Set(filter.platforms))
const groupOptions = computed<MonitorFilterOption[]>(() => dimensions.value.groups
  .filter((item) => selectedPlatforms.value.size === 0 || !item.platform || selectedPlatforms.value.has(item.platform))
  .map((item) => ({ value: String(item.id), label: item.platform ? `${item.platform} / ${item.name || `#${item.id}`}` : item.name || `#${item.id}`, count: item.request_count })))
const modelOptions = computed<MonitorFilterOption[]>(() => dimensions.value.models
  .filter((item) => selectedPlatforms.value.size === 0 || !item.platform || selectedPlatforms.value.has(item.platform))
  .map((item) => ({ value: item.value, label: item.platform && !item.label.includes(item.platform) ? `${item.platform} / ${item.label}` : item.label, count: item.request_count })))
const selectedGroupIds = computed({
  get: () => filter.groupIds.map(String),
  set: (values: string[]) => { filter.groupIds = values.map(Number).filter((id) => Number.isInteger(id) && id > 0) }
})
const hasDimensionFilter = computed(() => filter.platforms.length + filter.groupIds.length + filter.models.length > 0)
const bootstrap = computed(() => snapshot.value?.coverage.bootstrap)
const bootstrapPercent = computed(() => Math.max(0, Math.min(100, Math.round(bootstrap.value?.progress_percent || 0))))
const displayedMatrixRows = computed(() => {
  if (groupBy.value === 'platform_group' || groupBy.value === 'platform_group_model') return matrixRows.value.filter((row) => Number(row.group_id || 0) > 0)
  return matrixRows.value
})
const zoomedMatrixRows = computed(() => displayedMatrixRows.value.map((row) => ({ ...row, buckets: sliceByZoom(row.buckets || [], zoom.value) })))
const visibleTrend = computed(() => sliceByZoom(snapshot.value?.trend || [], zoom.value))
const lineSeries = computed(() => ({
  error: lineChartPoints(visibleTrend.value.map((point) => Number(point.metrics.error_rate || 0) * 100), 760, 180),
  cache: lineChartPoints(visibleTrend.value.map((point) => Number(point.metrics.cache_rate || 0) * 100), 760, 180),
  ttft: lineChartPoints(visibleTrend.value.map((point) => point.metrics.ttft.p50_ms), 760, 180)
}))
const activeRowsEmpty = computed(() => activeTab.value === MonitorDetailTab.MODELS ? modelRows.value.length === 0 : activeTab.value === MonitorDetailTab.ERRORS ? errorRows.value.length === 0 : userRows.value.length === 0)
const refreshSeconds = computed(() => bootstrap.value?.active ? 10 : snapshot.value?.config.refresh_interval_seconds || 300)

function isAbortError(caught: unknown): boolean {
  const candidate = caught as { name?: string; code?: string }
  return candidate?.name === 'AbortError' || candidate?.name === 'CanceledError' || candidate?.code === 'ERR_CANCELED'
}

function syncQuery(): void {
  void router.replace({ query: {
    range: filter.range,
    platform: filter.platforms.join(',') || undefined,
    group: filter.groupIds.join(',') || undefined,
    model: filter.models.join(',') || undefined,
    group_by: groupBy.value,
    health_mode: healthMode.value,
    trend_view: trendView.value === MonitorTrendView.LINE ? MonitorTrendView.LINE : undefined,
    tab: activeTab.value
  } })
}

function currentFilter(): MonitorFilter {
  return { range: filter.range, platforms: [...filter.platforms], groupIds: [...filter.groupIds], models: [...filter.models] }
}

async function loadTab(signal?: AbortSignal, id = sequence): Promise<void> {
  tabLoading.value = true
  try {
    if (activeTab.value === MonitorDetailTab.MODELS) modelRows.value = (await monitorAPI.getModels(currentFilter(), false, signal)).items || []
    else if (activeTab.value === MonitorDetailTab.ERRORS) errorRows.value = (await monitorAPI.getErrors(currentFilter(), false, signal)).items || []
    else userRows.value = (await monitorAPI.getUsers(currentFilter(), false, signal)).items || []
  } catch (caught) {
    if (!isAbortError(caught)) error.value = (caught as { message?: string }).message || '明细暂时无法加载'
  } finally {
    if (id === sequence) tabLoading.value = false
  }
}

async function loadMain(signal: AbortSignal, id: number): Promise<void> {
  const [nextSnapshot, nextMatrix] = await Promise.all([
    monitorAPI.getSnapshot(currentFilter(), false, signal),
    monitorAPI.getMatrix(currentFilter(), groupBy.value, false, signal)
  ])
  if (id !== sequence) return
  snapshot.value = nextSnapshot
  matrixRows.value = nextMatrix.items || []
  countdown.value = refreshSeconds.value
  await loadTab(signal, id)
}

async function reload(includeDimensions = false, silent = true): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  const id = ++sequence
  refreshing.value = true
  if (!silent) loading.value = true
  error.value = ''
  try {
    const tasks: Array<Promise<void>> = [loadMain(controller.signal, id)]
    if (includeDimensions) {
      const rangeOnly: MonitorFilter = { range: filter.range, platforms: [], groupIds: [], models: [] }
      tasks.push(monitorAPI.getDimensions(rangeOnly, false, controller.signal).then((result) => { if (id === sequence) dimensions.value = result }))
    }
    await Promise.all(tasks)
  } catch (caught) {
    if (!isAbortError(caught)) error.value = (caught as { message?: string }).message || '实时健康数据暂时无法加载'
  } finally {
    if (id === sequence) { loading.value = false; refreshing.value = false; tabLoading.value = false }
  }
}

function clearDimensions(): void {
  filter.platforms = []
  filter.groupIds = []
  filter.models = []
}

function drillModel(row: MonitorModelRow): void {
  filter.platforms = [row.platform]
  filter.models = [row.model]
}

function toggleError(category: string): void {
  const next = new Set(expandedErrors.value)
  if (next.has(category)) next.delete(category)
  else next.add(category)
  expandedErrors.value = next
}

function rowKey(row: MonitorMatrixRow): string {
  return [row.platform, row.group_id || 0, row.model || ''].join(':')
}

function bucketTitle(row: MonitorMatrixRow, index: number): string {
  const bucket = row.buckets[index]
  if (!bucket) return '该时间段无数据'
  const values = [
    new Date(bucket.bucket_start).toLocaleString(),
    `成功率 ${successRate(bucket.metrics)}`,
    `首字 ${latencySummary(bucket.metrics.ttft)}`,
    `缓存率 ${formatMonitorPercent(bucket.metrics.cache_rate)}`,
    `错误率 ${formatMonitorPercent(bucket.metrics.error_rate)}`
  ]
  if (showThroughput.value) values.push(`TPS ${formatThroughput(tokensPerSecond(bucket.metrics.tpm))}`, `RPM ${formatThroughput(bucket.metrics.rpm)}`)
  return values.join('\n')
}

function onZoom(event: WheelEvent): void {
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0.5
  zoom.value = zoomWindow(zoom.value, event.deltaY, ratio)
}

function resetZoom(): void {
  zoom.value = { start: 0, span: 1 }
}

function formatTime(value: string | undefined): string {
  if (!value) return '等待首批数据'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function startTimer(): void {
  if (timer != null) window.clearInterval(timer)
  timer = window.setInterval(() => {
    if (!autoRefresh.value || document.hidden || loading.value || refreshing.value) return
    countdown.value -= 1
    if (countdown.value <= 0) void reload(false, true)
  }, 1000)
}

watch(() => filter.range, () => { zoom.value = { start: 0, span: 1 }; syncQuery(); void reload(true, true) })
watch([() => filter.platforms.slice(), () => filter.groupIds.slice(), () => filter.models.slice()], () => { syncQuery(); void reload(false, true) })
watch(groupBy, () => { syncQuery(); void reload(false, true) })
watch(activeTab, () => { syncQuery(); void loadTab() })
watch([healthMode, trendView], syncQuery)
watch([groupOptions, modelOptions], () => {
  if (groupOptions.value.length) {
    const allowed = new Set(groupOptions.value.map((item) => item.value))
    filter.groupIds = filter.groupIds.filter((id) => allowed.has(String(id)))
  }
  if (modelOptions.value.length) {
    const allowed = new Set(modelOptions.value.map((item) => item.value))
    filter.models = filter.models.filter((model) => allowed.has(model))
  }
})
onMounted(() => { void reload(true, false); startTimer() })
onBeforeUnmount(() => { controller?.abort(); if (timer != null) window.clearInterval(timer) })
</script>

<template>
  <section class="realtime-monitor">
    <header class="realtime-heading">
      <div><p>实时聚合 · 请求级健康洞察</p><h1>服务状态</h1><span>以成功率、首字延迟、缓存效率和吞吐观测平台、分组与模型的真实服务质量。</span></div>
      <div class="live-status">
        <i :class="{ refreshing }" /><div><span>{{ refreshing ? '正在更新' : '数据更新至' }}</span><strong>{{ refreshing ? '聚合新数据…' : formatTime(snapshot?.coverage.data_through) }}</strong></div><button
          type="button"
          class="button button--secondary"
          :disabled="loading"
          @click="reload(true, false)"
        >
          刷新
        </button>
      </div>
    </header>

    <aside
      v-if="bootstrap?.active"
      class="bootstrap"
      role="status"
    >
      <div><strong>首次历史数据回填中</strong><span>90 分钟至 30 天窗口会逐步变完整，不影响当前已有数据查询。</span></div><em>{{ bootstrapPercent }}%</em><div
        role="progressbar"
        :aria-valuenow="bootstrapPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <i :style="{ width: `${bootstrapPercent}%` }" />
      </div>
    </aside>
    <aside
      v-else-if="snapshot && !snapshot.coverage.coverage_complete"
      class="coverage-note"
    >
      当前范围为部分覆盖：{{ formatTime(snapshot.coverage.coverage_start) }} 至 {{ formatTime(snapshot.coverage.data_through) }}。
    </aside>

    <section
      class="realtime-toolbar"
      aria-label="实时监控查询条件"
    >
      <div
        class="range-tabs"
        role="group"
        aria-label="监控时间范围"
      >
        <button
          v-for="option in rangeOptions"
          :key="option.value"
          type="button"
          :class="{ active: filter.range === option.value }"
          @click="filter.range = option.value"
        >
          {{ option.label }}
        </button>
      </div>
      <MonitorFilterMenu
        v-model="filter.platforms"
        label="平台"
        :options="platformOptions"
      />
      <MonitorFilterMenu
        v-model="selectedGroupIds"
        label="分组"
        :options="groupOptions"
      />
      <MonitorFilterMenu
        v-model="filter.models"
        label="模型"
        :options="modelOptions"
      />
      <button
        type="button"
        class="clear-filter"
        :disabled="!hasDimensionFilter"
        @click="clearDimensions"
      >
        清空筛选
      </button>
      <label><span>矩阵维度</span><select
        v-model="groupBy"
        aria-label="矩阵分组方式"
      ><option
        v-for="option in groupByOptions"
        :key="option.value"
        :value="option.value"
      >{{ option.label }}</option></select></label>
      <div
        class="view-tabs"
        role="group"
        aria-label="趋势视图"
      >
        <button
          type="button"
          :class="{ active: trendView === MonitorTrendView.PULSE }"
          @click="trendView = MonitorTrendView.PULSE"
        >
          脉冲
        </button><button
          type="button"
          :class="{ active: trendView === MonitorTrendView.LINE }"
          @click="trendView = MonitorTrendView.LINE"
        >
          曲线
        </button>
      </div>
      <label class="refresh-toggle"><input
        v-model="autoRefresh"
        type="checkbox"
      ><span>{{ autoRefresh ? `${countdown}s 自动刷新` : '自动刷新已暂停' }}</span></label>
    </section>

    <div
      v-if="error"
      class="monitor-alert"
      role="alert"
    >
      <span>{{ error }}</span><button
        type="button"
        @click="reload(true, false)"
      >
        重试
      </button>
    </div>
    <div
      v-if="loading && !snapshot"
      class="realtime-state"
    >
      正在聚合健康数据…
    </div>
    <template v-else-if="snapshot">
      <section
        class="health-kpis"
        aria-label="健康指标摘要"
      >
        <article :class="`kpi-${healthClass(snapshot.health, MonitorHealthMode.SUCCESS)}`">
          <span>成功率</span><strong>{{ formatMonitorPercent(1 - snapshot.metrics.error_rate) }}</strong><small>错误率 {{ formatMonitorPercent(snapshot.metrics.error_rate) }}</small>
        </article>
        <article :class="`kpi-${healthClass(snapshot.health, MonitorHealthMode.TTFT)}`">
          <span>首字延迟 P50</span><strong>{{ formatMonitorMs(snapshot.metrics.ttft.p50_ms) }}</strong><small>{{ latencySummary(snapshot.metrics.ttft) }}</small>
        </article>
        <article v-if="showThroughput">
          <span>Tokens / 秒</span><strong>{{ formatThroughput(tokensPerSecond(snapshot.metrics.tpm)) }}</strong><small>由 TPM 换算</small>
        </article>
        <article :class="`kpi-${healthClass(snapshot.health, MonitorHealthMode.CACHE)}`">
          <span>缓存命中率</span><strong>{{ formatMonitorPercent(snapshot.metrics.cache_rate) }}</strong><small>按可缓存 Token 计算</small>
        </article>
        <article v-if="showThroughput">
          <span>RPM</span><strong>{{ formatThroughput(snapshot.metrics.rpm) }}</strong><small>每分钟请求吞吐</small>
        </article>
      </section>

      <section class="visual-panel">
        <header>
          <div><h2>{{ trendView === MonitorTrendView.PULSE ? '服务健康脉冲' : '错误 / 缓存 / TTFT 趋势' }}</h2><p>{{ trendView === MonitorTrendView.PULSE ? '每个色块代表一个时间桶；滚轮可围绕指针缩放横轴。' : '三条曲线独立归一化，保留趋势方向；悬停数据请结合下方明细。' }}</p></div><div>
            <select
              v-if="trendView === MonitorTrendView.PULSE"
              v-model="healthMode"
              aria-label="脉冲健康口径"
            >
              <option
                v-for="option in healthOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select><button
              type="button"
              :disabled="zoom.span === 1"
              @click="resetZoom"
            >
              重置缩放
            </button>
          </div>
        </header>
        <div
          v-if="trendView === MonitorTrendView.PULSE"
          class="pulse-matrix"
          @wheel="onZoom"
        >
          <div class="pulse-header">
            <span>维度</span><span>成功率</span><span>TTFT</span><span v-if="showThroughput">TPS</span><span>缓存</span><span>时间脉冲</span>
          </div>
          <div
            v-for="row in zoomedMatrixRows"
            :key="rowKey(row)"
            class="pulse-row"
          >
            <strong :title="matrixRowLabel(row)"><i :class="healthClass(row.health, healthMode)" />{{ matrixRowLabel(row) }}</strong><span>{{ successRate(row.metrics) }}</span><span :title="latencySummary(row.metrics.ttft)">{{ formatMonitorMs(row.metrics.ttft.p50_ms) }}</span><span v-if="showThroughput">{{ formatThroughput(tokensPerSecond(row.metrics.tpm)) }}</span><span>{{ formatMonitorPercent(row.metrics.cache_rate) }}</span><div class="pulse-track">
              <i
                v-for="(bucket, index) in row.buckets"
                :key="`${bucket.bucket_start}-${index}`"
                :class="healthClass(bucket.health, healthMode)"
                :title="bucketTitle(row, index)"
                tabindex="0"
              />
            </div>
          </div>
          <div
            v-if="zoomedMatrixRows.length === 0"
            class="inline-state"
          >
            当前筛选范围没有矩阵数据。
          </div>
        </div>
        <div
          v-else
          class="line-chart"
          @wheel="onZoom"
        >
          <div class="chart-legend">
            <span class="error">错误率</span><span class="cache">缓存率</span><span class="ttft">TTFT P50</span>
          </div><svg
            viewBox="0 0 760 180"
            role="img"
            aria-label="错误率、缓存率与首字延迟趋势"
          ><line
            v-for="line in 5"
            :key="line"
            x1="0"
            :y1="line * 30"
            x2="760"
            :y2="line * 30"
            class="grid-line"
          /><polyline
            :points="lineSeries.error"
            class="line-error"
          /><polyline
            :points="lineSeries.cache"
            class="line-cache"
          /><polyline
            :points="lineSeries.ttft"
            class="line-ttft"
          /></svg><div class="chart-axis">
            <span>{{ formatTime(visibleTrend[0]?.bucket_start) }}</span><span>{{ formatTime(visibleTrend[visibleTrend.length - 1]?.bucket_start) }}</span>
          </div><div
            v-if="visibleTrend.length === 0"
            class="inline-state"
          >
            当前范围暂无趋势数据。
          </div>
        </div>
      </section>

      <section class="monitor-details">
        <header>
          <nav
            role="tablist"
            aria-label="监控明细"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === MonitorDetailTab.MODELS"
              :class="{ active: activeTab === MonitorDetailTab.MODELS }"
              @click="activeTab = MonitorDetailTab.MODELS"
            >
              模型表现
            </button><button
              type="button"
              role="tab"
              :aria-selected="activeTab === MonitorDetailTab.ERRORS"
              :class="{ active: activeTab === MonitorDetailTab.ERRORS }"
              @click="activeTab = MonitorDetailTab.ERRORS"
            >
              错误分布
            </button><button
              type="button"
              role="tab"
              :aria-selected="activeTab === MonitorDetailTab.USERS"
              :class="{ active: activeTab === MonitorDetailTab.USERS }"
              @click="activeTab = MonitorDetailTab.USERS"
            >
              用户排行
            </button>
          </nav><span>{{ tabLoading ? '明细更新中…' : '点击模型可直接下钻筛选' }}</span>
        </header>
        <div class="details-scroll">
          <table v-if="activeTab === MonitorDetailTab.MODELS">
            <thead>
              <tr>
                <th>平台 / 模型</th><th>成功率</th><th>TTFT</th><th v-if="showThroughput">
                  TPS
                </th><th>缓存率</th><th v-if="showThroughput">
                  RPM
                </th>
              </tr>
            </thead><tbody>
              <tr
                v-for="row in modelRows"
                :key="`${row.platform}:${row.model}`"
                class="clickable"
                @click="drillModel(row)"
              >
                <td><i :class="healthClass(row.health, MonitorHealthMode.OVERALL)" /><span>{{ row.platform }}</span><strong>{{ row.model === '__other__' ? '其他模型' : row.model }}</strong></td><td><strong>{{ successRate(row.metrics) }}</strong><small>错误 {{ formatMonitorPercent(row.metrics.error_rate) }}</small></td><td><strong>{{ formatMonitorMs(row.metrics.ttft.p50_ms) }}</strong><small>{{ latencySummary(row.metrics.ttft) }}</small></td><td v-if="showThroughput">
                  {{ formatThroughput(tokensPerSecond(row.metrics.tpm)) }}
                </td><td>{{ formatMonitorPercent(row.metrics.cache_rate) }}</td><td v-if="showThroughput">
                  {{ formatThroughput(row.metrics.rpm) }}
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-else-if="activeTab === MonitorDetailTab.ERRORS"
            class="error-list"
          >
            <article
              v-for="row in errorRows"
              :key="row.category"
              :class="{ ignored: row.ignored }"
            >
              <button
                type="button"
                @click="toggleError(row.category)"
              >
                <span><strong>{{ row.category }}</strong><em v-if="row.ignored">不计入健康分</em></span><i><b :style="{ width: `${Math.max(2, row.rate * 100)}%` }" /></i><span>{{ formatMonitorPercent(row.rate) }} · {{ row.count }}</span><span>{{ expandedErrors.has(row.category) ? '收起' : '展开' }}</span>
              </button><div
                v-if="expandedErrors.has(row.category)"
                class="error-details"
              >
                <article
                  v-for="(detail, index) in row.details || []"
                  :key="`${row.category}-${index}`"
                >
                  <header><span>{{ detail.platform || '—' }} / {{ detail.model || '—' }}</span><span>HTTP {{ detail.status_code || '—' }} · 上游 {{ detail.upstream_status_code || '—' }} · ×{{ detail.count }}</span></header><p>{{ detail.message || detail.error_type || '后端未返回错误说明' }}</p>
                </article><p v-if="!(row.details || []).length">
                  当前权限范围仅提供分类聚合，不返回错误正文。
                </p>
              </div>
            </article>
          </div>
          <table v-else>
            <thead>
              <tr>
                <th>排名</th><th>用户</th><th>成功率</th><th>TTFT</th><th v-if="showThroughput">
                  TPS
                </th><th>缓存率</th><th v-if="showThroughput">
                  RPM
                </th>
              </tr>
            </thead><tbody>
              <tr
                v-for="row in userRows"
                :key="row.user_id || row.display_label"
                :class="{ self: row.is_self }"
              >
                <td><strong>#{{ row.rank }}</strong></td><td><strong>{{ row.display_label }}</strong><small v-if="row.is_self">当前账号</small></td><td><strong>{{ successRate(row.metrics) }}</strong><small>错误 {{ formatMonitorPercent(row.metrics.error_rate) }}</small></td><td><strong>{{ formatMonitorMs(row.metrics.ttft.p50_ms) }}</strong><small>{{ latencySummary(row.metrics.ttft) }}</small></td><td v-if="showThroughput">
                  {{ formatThroughput(tokensPerSecond(row.metrics.tpm)) }}
                </td><td>{{ formatMonitorPercent(row.metrics.cache_rate) }}</td><td v-if="showThroughput">
                  {{ formatThroughput(row.metrics.rpm) }}
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-if="tabLoading"
            class="table-state"
          >
            正在加载明细…
          </div><div
            v-else-if="activeRowsEmpty"
            class="table-state"
          >
            {{ bootstrap?.active ? '历史回填中，数据会逐步出现。' : '当前筛选范围没有明细。' }}
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.realtime-monitor { padding-bottom: 52px; }.realtime-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; }.live-status { min-width: 300px; padding: 10px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 9px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; }.live-status > i { width: 7px; height: 7px; background: var(--success); border-radius: 50%; }.live-status > i.refreshing { background: var(--accent); animation: pulse 1s infinite alternate; }.live-status div { display: grid; gap: 3px; }.live-status span { color: var(--text-secondary); font-size: var(--font-caption); }.live-status strong { font-size: var(--font-meta); }.bootstrap { margin-top: 20px; padding: 13px 15px; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px 14px; color: var(--accent); background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border-subtle)); border-radius: 10px; }.bootstrap > div:first-child { display: grid; gap: 4px; }.bootstrap strong { font-size: var(--font-meta); }.bootstrap span { color: var(--text-secondary); font-size: var(--font-meta); }.bootstrap em { font-size: var(--font-meta); font-style: normal; font-weight: 800; }.bootstrap > div:last-child { grid-column: 1 / -1; height: 4px; overflow: hidden; background: color-mix(in srgb, var(--accent) 16%, var(--surface-raised)); border-radius: 4px; }.bootstrap > div:last-child i { height: 100%; display: block; background: var(--accent); }.coverage-note, .monitor-alert { margin-top: 17px; padding: 10px 12px; color: var(--warning); background: color-mix(in srgb, var(--warning) 8%, var(--surface-raised)); border-left: 3px solid var(--warning); font-size: var(--font-meta); }.monitor-alert { display: flex; justify-content: space-between; color: var(--danger); border-left-color: var(--danger); }.monitor-alert button { color: inherit; background: transparent; border: 0; cursor: pointer; }
.realtime-toolbar { margin: 22px 0 14px; padding: 9px; display: flex; align-items: center; gap: 6px; overflow: visible; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.range-tabs, .view-tabs { padding: 3px; display: flex; background: var(--surface-canvas); border-radius: 7px; }.range-tabs button, .view-tabs button { min-height: 30px; padding: 0 8px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 5px; cursor: pointer; white-space: nowrap; font-size: var(--font-caption); }.range-tabs button.active, .view-tabs button.active { color: var(--text-primary); background: var(--accent-soft); }.clear-filter { min-height: 34px; padding: 0 7px; color: var(--accent); background: transparent; border: 0; cursor: pointer; font-size: var(--font-caption); }.clear-filter:disabled { color: var(--text-secondary); opacity: .45; }.realtime-toolbar > label { display: grid; gap: 3px; color: var(--text-secondary); font-size: var(--font-caption); }.realtime-toolbar select { min-height: 34px; padding: 0 8px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; }.refresh-toggle { margin-left: auto; display: flex !important; grid-auto-flow: column; align-items: center; white-space: nowrap; }.realtime-state { min-height: 380px; display: grid; place-content: center; color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: 14px; }
.health-kpis { display: grid; grid-template-columns: repeat(5, 1fr); border-block: 1px solid var(--border-subtle); }.health-kpis article { position: relative; padding: 16px 17px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); }.health-kpis article:last-child { border-right: 0; }.health-kpis article::before { content: ''; position: absolute; top: 0; left: 17px; width: 26px; height: 2px; background: var(--border-strong); }.health-kpis article[class*='healthy']::before, .health-kpis .kpi-score-8::before, .health-kpis .kpi-score-9::before, .health-kpis .kpi-score-10::before { background: var(--success); }.health-kpis article[class*='warning']::before, .health-kpis .kpi-score-5::before, .health-kpis .kpi-score-6::before, .health-kpis .kpi-score-7::before { background: var(--warning); }.health-kpis article[class*='critical']::before, .health-kpis .kpi-score-0::before, .health-kpis .kpi-score-1::before, .health-kpis .kpi-score-2::before, .health-kpis .kpi-score-3::before, .health-kpis .kpi-score-4::before { background: var(--danger); }.health-kpis span, .health-kpis small { color: var(--text-secondary); font-size: var(--font-caption); }.health-kpis strong { font-size: 20px; }
.visual-panel, .monitor-details { margin-top: 14px; overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }.visual-panel > header, .monitor-details > header { padding: 13px 15px; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--border-subtle); }.visual-panel h2 { margin: 0; font-size: 12px; }.visual-panel header p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.visual-panel header > div:last-child { display: flex; gap: 6px; }.visual-panel header select, .visual-panel header button { min-height: 30px; padding: 0 8px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 6px; cursor: pointer; font-size: var(--font-caption); }.pulse-matrix { max-height: 390px; overflow: auto; }.pulse-header, .pulse-row { min-width: 900px; padding: 0 13px; display: grid; grid-template-columns: minmax(180px, 1.2fr) 70px 70px 60px 65px minmax(240px, 2.2fr); align-items: center; gap: 8px; }.pulse-header { min-height: 34px; position: sticky; top: 0; z-index: 2; color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-caption); }.pulse-row { min-height: 44px; border-top: 1px solid var(--border-subtle); }.pulse-row > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-meta); }.pulse-row > strong i, .monitor-details td > i { width: 7px; height: 7px; margin-right: 6px; display: inline-block; border-radius: 50%; }.pulse-row > span { color: var(--text-secondary); font-size: var(--font-meta); }.pulse-track { min-width: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(3px, 1fr); gap: 2px; }.pulse-track i { height: 16px; border-radius: 2px; outline-offset: 2px; }.state-healthy, .score-8, .score-9, .score-10 { background: var(--success) !important; }.state-warning, .score-5, .score-6, .score-7 { background: var(--warning) !important; }.state-critical, .score-0, .score-1, .score-2, .score-3, .score-4 { background: var(--danger) !important; }.state-unknown { background: var(--border-strong) !important; }.inline-state { min-height: 180px; display: grid; place-content: center; color: var(--text-secondary); font-size: var(--font-meta); }.line-chart { position: relative; padding: 15px; }.line-chart svg { width: 100%; height: 250px; overflow: visible; }.grid-line { stroke: var(--border-subtle); stroke-width: 1; stroke-dasharray: 4 5; }.line-chart polyline { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; }.line-error { stroke: var(--danger); }.line-cache { stroke: var(--success); }.line-ttft { stroke: #38a3ff; }.chart-legend { display: flex; gap: 13px; color: var(--text-secondary); font-size: var(--font-caption); }.chart-legend span::before { content: ''; width: 6px; height: 6px; margin-right: 5px; display: inline-block; border-radius: 50%; }.chart-legend .error::before { background: var(--danger); }.chart-legend .cache::before { background: var(--success); }.chart-legend .ttft::before { background: #38a3ff; }.chart-axis { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: var(--font-caption); }
.monitor-details > header { align-items: center; }.monitor-details nav { display: flex; gap: 3px; }.monitor-details nav button { min-height: 32px; padding: 0 11px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: var(--font-meta); }.monitor-details nav button.active { color: var(--text-primary); background: var(--accent-soft); }.monitor-details > header > span { color: var(--text-secondary); font-size: var(--font-caption); }.details-scroll { max-height: 520px; position: relative; overflow: auto; }.details-scroll table { width: 100%; min-width: 800px; border-collapse: collapse; }.details-scroll th, .details-scroll td { padding: 11px 13px; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }.details-scroll th { position: sticky; top: 0; z-index: 1; color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-caption); }.details-scroll tr:last-child td { border-bottom: 0; }.details-scroll tr.clickable { cursor: pointer; }.details-scroll tr.clickable:hover { background: var(--surface-canvas); }.details-scroll td > span, .details-scroll td > strong, .details-scroll td > small { display: block; }.details-scroll td > span, .details-scroll td > small { color: var(--text-secondary); font-size: var(--font-caption); }.details-scroll td > strong { margin-top: 3px; }.details-scroll tr.self { background: var(--accent-soft); }.error-list { padding: 10px; display: grid; gap: 7px; }.error-list > article { overflow: hidden; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.error-list > article.ignored { opacity: .65; }.error-list > article > button { width: 100%; min-height: 49px; padding: 8px 10px; display: grid; grid-template-columns: minmax(120px, 1fr) 1.5fr auto auto; align-items: center; gap: 10px; color: var(--text-primary); text-align: left; background: transparent; border: 0; cursor: pointer; }.error-list button span:first-child { display: flex; align-items: center; gap: 6px; }.error-list button strong, .error-list button span { font-size: var(--font-meta); }.error-list button em { padding: 2px 4px; color: var(--text-secondary); background: var(--surface-raised); border-radius: 4px; font-size: var(--font-caption); font-style: normal; }.error-list button > i { height: 5px; overflow: hidden; background: var(--border-subtle); border-radius: 5px; }.error-list button b { height: 100%; display: block; background: var(--danger); }.error-details { padding: 10px; display: grid; gap: 7px; border-top: 1px solid var(--border-subtle); }.error-details article { padding: 9px; background: var(--surface-raised); border-radius: 7px; }.error-details header { display: flex; justify-content: space-between; gap: 10px; color: var(--text-secondary); font-size: var(--font-caption); }.error-details p { margin: 6px 0 0; font-size: var(--font-meta); line-height: 1.5; }.table-state { min-height: 150px; display: grid; place-content: center; color: var(--text-secondary); font-size: var(--font-meta); }
@keyframes pulse { from { opacity: .35; } to { opacity: 1; } }
@media (max-width: 1120px) { .realtime-toolbar { flex-wrap: wrap; }.refresh-toggle { margin-left: 0; }.health-kpis { grid-template-columns: repeat(3, 1fr); }.health-kpis article:nth-child(3) { border-right: 0; }.health-kpis article:nth-child(n+4) { border-top: 1px solid var(--border-subtle); } }
@media (max-width: 760px) { .realtime-heading { align-items: flex-start; flex-direction: column; }.live-status { width: 100%; }.range-tabs { width: 100%; overflow: auto; }.range-tabs button { flex: 1; }.health-kpis { grid-template-columns: 1fr 1fr; }.health-kpis article:nth-child(3) { border-right: 1px solid var(--border-subtle); }.health-kpis article:nth-child(even) { border-right: 0; }.health-kpis article:nth-child(n+3) { border-top: 1px solid var(--border-subtle); }.visual-panel > header, .monitor-details > header { flex-direction: column; }.error-list > article > button { grid-template-columns: 1fr auto; }.error-list button > i { grid-column: 1 / -1; grid-row: 2; } }
</style>
