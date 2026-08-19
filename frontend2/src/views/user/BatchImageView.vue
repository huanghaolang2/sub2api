<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import * as authAPI from '@shared-api/auth'
import * as batchAPI from '@shared-api/batchImage'
import * as keysAPI from '@shared-api/keys'
import type { BatchImageJob, BatchImageJobsListOptions } from '@shared-api/batchImage'
import type { ApiKey, PublicSettings } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import BatchImageCreateDialog from '@/components/user/batch-image/BatchImageCreateDialog.vue'
import BatchImageDetailDialog from '@/components/user/batch-image/BatchImageDetailDialog.vue'
import BatchImageGuideDialog from '@/components/user/batch-image/BatchImageGuideDialog.vue'
import {
  aggregateJob,
  applyChildCounts,
  batchCostLabel,
  batchErrorMessage,
  batchPendingCount,
  batchStatusLabel,
  batchStatusTone,
  BatchDownloadFilter,
  canDelete,
  canDownload,
  canRetry,
  formatBatchTime,
  keyAllowsBatchImage,
  toJobRow,
  unresolvedFailedRetryItems,
  visibleJobRows,
  type BatchImageJobRow
} from '@/features/user/batch-image/model'
import { useAppStore } from '@/stores/app'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'

const app = useAppStore()
const confirmDialog = useConfirmStore()

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '生成中' },
  { value: 'indexing', label: '索引中' },
  { value: 'processing_results', label: '整理结果' },
  { value: 'settling', label: '结算中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
  { value: 'output_deleted', label: '输出已删除' }
]
const pageSizes = [20, 50, 100]

const apiKeys = ref<ApiKey[]>([])
const publicSettings = ref<PublicSettings | null>(null)
const jobs = ref<BatchImageJobRow[]>([])
const loadingKeys = ref(true)
const loadingJobs = ref(false)
const pageError = ref('')
const actionBusy = ref(new Set<string>())
const selectedIds = ref(new Set<string>())
const expandedIds = ref(new Set<string>())
const createOpen = ref(false)
const guideOpen = ref(false)
const detailOpen = ref(false)
const detailJob = ref<BatchImageJobRow | null>(null)
let loadSequence = 0

const filters = reactive({ taskName: '', apiKeyId: '', status: '', downloaded: BatchDownloadFilter.ALL })
const pagination = reactive({ page: 1, pageSize: 20, hasMore: false })

const allowedKeys = computed(() => apiKeys.value.filter(keyAllowsBatchImage))
const filteredKeys = computed(() => {
  const keyId = Number(filters.apiKeyId || 0)
  return keyId ? allowedKeys.value.filter((key) => key.id === keyId) : allowedKeys.value
})
const endpointBase = computed(() => {
  const configured = publicSettings.value?.api_base_url?.trim()
  const root = configured || (typeof window === 'undefined' ? '' : window.location.origin)
  return root.replace(/\/+$/, '').replace(/\/v1$/, '') || '<你的 Sub2API API 端点>'
})
const visibleRows = computed(() => visibleJobRows(jobs.value, expandedIds.value))
const selectedRows = computed(() => jobs.value.filter((job) => selectedIds.value.has(job.id)))
const selectedDownloadableRows = computed(() => selectedRows.value.filter((job) => canDownload(displayJob(job))))
const selectedDeletableRows = computed(() => selectedRows.value.filter(canDelete))
const allVisibleSelected = computed(() => visibleRows.value.length > 0 && visibleRows.value.every((job) => selectedIds.value.has(job.id)))
const someVisibleSelected = computed(() => !allVisibleSelected.value && visibleRows.value.some((job) => selectedIds.value.has(job.id)))
const rootJobs = computed(() => jobs.value.filter((job) => !job.parent_batch_id).map(displayJob))
const summary = computed(() => ({
  total: rootJobs.value.length,
  active: rootJobs.value.filter((job) => !['completed', 'failed', 'cancelled', 'output_deleted'].includes(job.status)).length,
  success: rootJobs.value.reduce((total, job) => total + job.success_count, 0),
  failed: rootJobs.value.reduce((total, job) => total + job.fail_count, 0)
}))
const detailApiKey = computed(() => detailJob.value ? keyForJob(detailJob.value) : null)

function displayJob(job: BatchImageJobRow): BatchImageJobRow {
  return aggregateJob(job, jobs.value)
}

function keyForJob(job: Pick<BatchImageJobRow, 'api_key_id'>): ApiKey | null {
  return allowedKeys.value.find((key) => key.id === job.api_key_id) || null
}

function listOptions(): BatchImageJobsListOptions {
  return {
    limit: pagination.pageSize,
    cursor: String((pagination.page - 1) * pagination.pageSize),
    status: filters.status || undefined,
    taskName: filters.taskName.trim() || undefined,
    downloaded: filters.downloaded || undefined
  }
}

function isAbortError(caught: unknown): boolean {
  const candidate = caught as { name?: string; code?: string }
  return candidate?.name === 'AbortError' || candidate?.code === 'ERR_CANCELED'
}

function setBusy(id: string, busy: boolean): void {
  const next = new Set(actionBusy.value)
  if (busy) next.add(id)
  else next.delete(id)
  actionBusy.value = next
}

function upsertJob(job: BatchImageJob, key: ApiKey): void {
  const next = toJobRow(job, key)
  const current = jobs.value.find((item) => item.id === job.id)
  const rows = current
    ? jobs.value.map((item) => item.id === job.id ? { ...next, is_child: item.is_child } : item)
    : [next, ...jobs.value]
  jobs.value = applyChildCounts(rows.sort((left, right) => right.created_at - left.created_at).slice(0, pagination.pageSize))
}

function removeJob(id: string): void {
  jobs.value = applyChildCounts(jobs.value.filter((job) => job.id !== id))
  const next = new Set(selectedIds.value)
  next.delete(id)
  selectedIds.value = next
  if (detailJob.value?.id === id) closeDetail()
}

function markDownloaded(id: string): void {
  const timestamp = Math.floor(Date.now() / 1000)
  jobs.value = jobs.value.map((job) => job.id === id ? { ...job, downloaded_at: job.downloaded_at || timestamp } : job)
  if (detailJob.value?.id === id) detailJob.value = { ...detailJob.value, downloaded_at: detailJob.value.downloaded_at || timestamp }
}

async function loadSupport(): Promise<void> {
  loadingKeys.value = true
  pageError.value = ''
  const [keysResult, settingsResult] = await Promise.allSettled([
    keysAPI.list(1, 100, { status: 'active' }),
    authAPI.getPublicSettings()
  ])
  if (keysResult.status === 'fulfilled') apiKeys.value = keysResult.value.items
  else pageError.value = (keysResult.reason as { message?: string })?.message || 'API Key 加载失败'
  if (settingsResult.status === 'fulfilled') {
    publicSettings.value = settingsResult.value
    const configuredSize = Number(settingsResult.value.table_default_page_size)
    if (pageSizes.includes(configuredSize)) pagination.pageSize = configuredSize
  }
  loadingKeys.value = false
}

async function loadJobs(): Promise<void> {
  const sequence = ++loadSequence
  const keys = filteredKeys.value
  selectedIds.value = new Set()
  if (!keys.length) {
    jobs.value = []
    pagination.hasMore = false
    return
  }
  loadingJobs.value = true
  pageError.value = ''
  try {
    const options = listOptions()
    const results = await Promise.all(keys.map(async (key) => {
      const response = await batchAPI.listBatchImageJobs(key.key, options)
      return { hasMore: response.has_more, rows: (response.data || []).map((job) => toJobRow(job, key)) }
    }))
    if (sequence !== loadSequence) return
    jobs.value = applyChildCounts(results
      .flatMap((result) => result.rows)
      .sort((left, right) => right.created_at - left.created_at)
      .slice(0, pagination.pageSize))
    pagination.hasMore = results.some((result) => result.hasMore)
  } catch (caught) {
    if (!isAbortError(caught) && sequence === loadSequence) pageError.value = batchErrorMessage(caught, '批量图片任务加载失败')
  } finally {
    if (sequence === loadSequence) loadingJobs.value = false
  }
}

function applyFilters(): void {
  pagination.page = 1
  void loadJobs()
}

function resetFilters(): void {
  filters.taskName = ''
  filters.apiKeyId = ''
  filters.status = ''
  filters.downloaded = BatchDownloadFilter.ALL
  applyFilters()
}

function changePage(page: number): void {
  if (page < 1 || page === pagination.page) return
  pagination.page = page
  void loadJobs()
}

function changePageSize(event: Event): void {
  pagination.pageSize = Number((event.target as HTMLSelectElement).value) || 20
  pagination.page = 1
  try { window.localStorage.setItem('table-page-size', String(pagination.pageSize)) } catch { /* storage is optional */ }
  void loadJobs()
}

function toggleExpanded(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function toggleSelection(id: string, checked: boolean): void {
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

function toggleAllVisible(checked: boolean): void {
  const next = new Set(selectedIds.value)
  visibleRows.value.forEach((job) => checked ? next.add(job.id) : next.delete(job.id))
  selectedIds.value = next
}

function openDetail(job: BatchImageJobRow): void {
  detailJob.value = job
  detailOpen.value = true
}

function closeDetail(): void {
  detailOpen.value = false
  detailJob.value = null
}

async function downloadJob(job: BatchImageJobRow): Promise<void> {
  const shown = displayJob(job)
  const key = keyForJob(job)
  if (!key || !canDownload(shown) || actionBusy.value.has(`download:${job.id}`)) return
  setBusy(`download:${job.id}`, true)
  try {
    const blob = await batchAPI.downloadBatchImageZip(key.key, job.id)
    batchAPI.saveBlob(blob, `${job.id}.zip`)
    markDownloaded(job.id)
    app.showSuccess(`“${job.task_name}”结果 ZIP 已开始下载`)
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '结果下载失败'))
  } finally {
    setBusy(`download:${job.id}`, false)
  }
}

async function retryJob(job: BatchImageJobRow): Promise<void> {
  const shown = displayJob(job)
  const key = keyForJob(job)
  if (!key || !canRetry(shown) || actionBusy.value.has(`retry:${job.id}`)) return
  setBusy(`retry:${job.id}`, true)
  try {
    const detailJobs = job.parent_batch_id
      ? [job]
      : [job, ...jobs.value.filter((candidate) => candidate.parent_batch_id === job.id)]
    const itemResults = await Promise.all(detailJobs.map(async (candidate) => {
      const response = await batchAPI.listBatchImageItems(key.key, candidate.id)
      return (response.data || []).map((item) => ({ ...item, batch_id: candidate.id }))
    }))
    const items = unresolvedFailedRetryItems(itemResults.flat(), job.id)
    if (!items.length) {
      app.showError('失败项没有保留 Prompt，无法自动重试；请使用原 Prompt 新建任务。')
      return
    }
    const child = await batchAPI.submitBatchImageJob(key.key, {
      model: job.model,
      task_name: `${job.task_name} · 失败项重试`,
      parent_batch_id: job.parent_batch_id || job.id,
      provider: job.provider,
      image_size: '1K',
      response_mime_type: 'image/png',
      items
    }, `sub2api-ui-retry-${job.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
    upsertJob(child, key)
    if (child.parent_batch_id) expandedIds.value = new Set([...expandedIds.value, child.parent_batch_id])
    app.showSuccess(`已仅重试 ${items.length} 个失败项`)
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '失败项重试提交失败'))
  } finally {
    setBusy(`retry:${job.id}`, false)
  }
}

async function deleteJob(job: BatchImageJobRow): Promise<void> {
  const key = keyForJob(job)
  if (!key || !canDelete(job) || actionBusy.value.has(`delete:${job.id}`)) return
  const confirmed = await confirmDialog.ask({
    title: '删除任务记录',
    message: `将删除“${job.task_name}”的任务记录。已下载到本地的文件不受影响，但控制台中将无法恢复。`,
    confirmText: '删除记录',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  setBusy(`delete:${job.id}`, true)
  try {
    await batchAPI.deleteBatchImageJobRecord(key.key, job.id)
    removeJob(job.id)
    app.showSuccess('任务记录已删除')
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '任务记录删除失败'))
  } finally {
    setBusy(`delete:${job.id}`, false)
  }
}

async function bulkDownload(): Promise<void> {
  if (!selectedDownloadableRows.value.length || actionBusy.value.has('bulk-download')) return
  setBusy('bulk-download', true)
  try {
    for (const job of selectedDownloadableRows.value) {
      const key = keyForJob(job)
      if (!key) continue
      const blob = await batchAPI.downloadBatchImageZip(key.key, job.id)
      batchAPI.saveBlob(blob, `${job.id}.zip`)
      markDownloaded(job.id)
    }
    app.showSuccess(`已开始下载 ${selectedDownloadableRows.value.length} 个结果包`)
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '批量下载中断，已开始的下载不受影响'))
  } finally {
    setBusy('bulk-download', false)
  }
}

async function bulkDelete(): Promise<void> {
  const rows = [...selectedDeletableRows.value]
  if (!rows.length || actionBusy.value.has('bulk-delete')) return
  const confirmed = await confirmDialog.ask({
    title: '批量删除任务记录',
    message: `将删除选中的 ${rows.length} 条终态任务记录；运行中的任务会保留。此操作不可撤销。`,
    confirmText: `删除 ${rows.length} 条`,
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  setBusy('bulk-delete', true)
  try {
    for (const job of rows) {
      const key = keyForJob(job)
      if (!key) continue
      await batchAPI.deleteBatchImageJobRecord(key.key, job.id)
      removeJob(job.id)
    }
    app.showSuccess(`已删除 ${rows.length} 条任务记录`)
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '批量删除中断，已删除的记录无法恢复'))
  } finally {
    setBusy('bulk-delete', false)
  }
}

function handleCreated(job: BatchImageJob, key: ApiKey): void {
  createOpen.value = false
  upsertJob(job, key)
  const row = jobs.value.find((item) => item.id === job.id)
  if (row) openDetail(row)
}

function handleUpdated(job: BatchImageJob): void {
  const existing = jobs.value.find((item) => item.id === job.id)
  const key = existing ? keyForJob(existing) : detailApiKey.value
  if (!key) return
  upsertJob(job, key)
  if (detailJob.value?.id === job.id) detailJob.value = { ...toJobRow(job, key), child_count: detailJob.value.child_count }
}

function handleChildCreated(job: BatchImageJob, key: ApiKey): void {
  upsertJob(job, key)
  if (job.parent_batch_id) expandedIds.value = new Set([...expandedIds.value, job.parent_batch_id])
}

onMounted(async () => {
  try {
    const storedSize = Number(window.localStorage.getItem('table-page-size'))
    if (pageSizes.includes(storedSize)) pagination.pageSize = storedSize
  } catch { /* storage is optional */ }
  await loadSupport()
  if (!pageError.value) await loadJobs()
})
</script>

<template>
  <ConsoleShell>
    <section class="batch-page">
      <header class="page-heading batch-heading">
        <div>
          <p>Gemini 批处理 · 冻结与实际结算分离</p>
          <h1>批量图片工作台</h1>
          <span>建立 Prompt 清单、跟踪父子重试任务，并集中预览、下载和清理结果。</span>
        </div>
        <div class="heading-actions">
          <button type="button" class="button button--secondary" @click="guideOpen = true">接入指南</button>
          <button type="button" class="button button--primary" :disabled="allowedKeys.length === 0" @click="createOpen = true">＋ 创建任务</button>
        </div>
      </header>

      <section class="batch-metrics" aria-label="批量图片任务摘要">
        <div><span>当前页主任务</span><strong>{{ summary.total }}</strong><small>重试任务聚合到主任务</small></div>
        <div><span>进行中</span><strong>{{ summary.active }}</strong><small>排队、生成、整理或结算</small></div>
        <div><span>成功图片</span><strong>{{ summary.success }}</strong><small>包含失败项重试结果</small></div>
        <div><span>仍失败</span><strong>{{ summary.failed }}</strong><small>可从任务行直接重试</small></div>
      </section>

      <section v-if="!loadingKeys && allowedKeys.length === 0" class="permission-state" role="status">
        <div><span>当前账号还不能提交批量图片</span><strong>需要一个运行中的 Gemini API Key，且其分组已开启“批量图片生成”。</strong><p>页面与接入指南仍可访问；配置完成后刷新即可开始使用。</p></div>
        <RouterLink class="button button--primary" to="/app/keys">检查 API Key</RouterLink>
      </section>

      <section class="batch-toolbar" aria-label="筛选批量图片任务">
        <label class="search-field"><span>任务名称</span><input v-model="filters.taskName" type="search" placeholder="按任务名称搜索" @keyup.enter="applyFilters"></label>
        <label><span>API Key</span><select v-model="filters.apiKeyId" @change="applyFilters"><option value="">全部可用 Key</option><option v-for="key in allowedKeys" :key="key.id" :value="String(key.id)">{{ key.name }}</option></select></label>
        <label><span>任务状态</span><select v-model="filters.status" @change="applyFilters"><option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <label><span>下载状态</span><select v-model="filters.downloaded" @change="applyFilters"><option :value="BatchDownloadFilter.ALL">全部</option><option :value="BatchDownloadFilter.DOWNLOADED">已下载</option><option :value="BatchDownloadFilter.NOT_DOWNLOADED">未下载</option></select></label>
        <button type="button" class="toolbar-button" @click="applyFilters">查询</button>
        <button type="button" class="toolbar-button" @click="resetFilters">清空</button>
        <button type="button" class="toolbar-button toolbar-button--refresh" :disabled="loadingJobs || loadingKeys" @click="loadJobs">{{ loadingJobs ? '同步中…' : '刷新任务' }}</button>
      </section>

      <section v-if="selectedIds.size" class="bulk-bar" aria-label="批量操作">
        <div><strong>已选 {{ selectedIds.size }} 条</strong><span>{{ selectedDownloadableRows.length }} 条可下载 · {{ selectedDeletableRows.length }} 条可删除</span></div>
        <button type="button" :disabled="!selectedDownloadableRows.length || actionBusy.has('bulk-download')" @click="bulkDownload">{{ actionBusy.has('bulk-download') ? '下载中…' : '批量下载' }}</button>
        <button type="button" class="danger" :disabled="!selectedDeletableRows.length || actionBusy.has('bulk-delete')" @click="bulkDelete">{{ actionBusy.has('bulk-delete') ? '删除中…' : '批量删除' }}</button>
        <button type="button" @click="selectedIds = new Set()">取消选择</button>
      </section>

      <div v-if="loadingKeys || loadingJobs" class="batch-state" role="status">正在核对 Key 权限并加载任务…</div>
      <div v-else-if="pageError" class="batch-state batch-state--error" role="alert"><strong>任务列表暂时无法加载</strong><span>{{ pageError }}</span><button type="button" class="button button--secondary" @click="loadSupport().then(loadJobs)">重新加载</button></div>
      <div v-else-if="allowedKeys.length > 0 && visibleRows.length === 0" class="batch-state"><strong>没有符合条件的批量图片任务</strong><span>可以清空筛选，或创建第一个任务。</span><button type="button" class="button button--primary" @click="createOpen = true">创建任务</button></div>
      <div v-else-if="visibleRows.length" class="batch-table-wrap">
        <table>
          <thead><tr><th class="check-cell"><input type="checkbox" aria-label="选择当前页全部任务" :checked="allVisibleSelected" :indeterminate="someVisibleSelected" @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"></th><th>任务</th><th>模型 / 服务</th><th>API Key</th><th>状态</th><th>结果</th><th>费用</th><th>下载</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="job in visibleRows" :key="job.id" :class="{ 'child-row': job.is_child }">
              <td class="check-cell"><input type="checkbox" :aria-label="`选择任务 ${job.task_name}`" :checked="selectedIds.has(job.id)" @change="toggleSelection(job.id, ($event.target as HTMLInputElement).checked)"></td>
              <td class="task-cell"><div><button v-if="job.child_count" type="button" class="expand-button" :aria-expanded="expandedIds.has(job.id)" :aria-label="`${expandedIds.has(job.id) ? '收起' : '展开'}重试任务`" @click="toggleExpanded(job.id)">{{ expandedIds.has(job.id) ? '−' : '+' }}</button><span v-else-if="job.is_child" class="child-mark">↳</span><span v-else class="empty-mark"></span><button type="button" class="task-link" @click="openDetail(job)"><strong>{{ job.task_name }}</strong><code>{{ job.id }}</code></button></div><small>{{ job.is_child ? `失败项重试 · 父任务 ${job.parent_batch_id}` : `${job.item_count} 个 Prompt${job.child_count ? ` · ${job.child_count} 次重试` : ''}` }}</small></td>
              <td class="model-cell"><strong>{{ job.model }}</strong><small>{{ job.provider || '自动选择' }}</small></td>
              <td><strong>{{ job.api_key_name }}</strong></td>
              <td><span :class="['status-pill', `status-pill--${batchStatusTone(displayJob(job))}`]">{{ batchStatusLabel(displayJob(job)) }}</span><small>{{ formatBatchTime(job.created_at) }}</small></td>
              <td class="result-cell"><strong>{{ displayJob(job).success_count }} 成功</strong><span v-if="displayJob(job).fail_count">{{ displayJob(job).fail_count }} 失败</span><small v-else-if="batchPendingCount(displayJob(job))">{{ batchPendingCount(displayJob(job)) }} 张处理中</small><small v-else>全部完成</small></td>
              <td><strong>{{ batchCostLabel(displayJob(job)) }}</strong><small v-if="displayJob(job).actual_cost == null">预估 {{ displayJob(job).estimated_cost.toFixed(2) }}</small><small v-else>预估 {{ displayJob(job).estimated_cost.toFixed(2) }}</small></td>
              <td><span :class="['download-state', { done: job.downloaded_at }]">{{ job.downloaded_at ? '已下载' : '未下载' }}</span><small v-if="job.downloaded_at">{{ formatBatchTime(job.downloaded_at) }}</small></td>
              <td class="actions-cell"><div><button type="button" @click="openDetail(job)">详情</button><button type="button" :disabled="!canDownload(displayJob(job)) || actionBusy.has(`download:${job.id}`)" @click="downloadJob(job)">{{ actionBusy.has(`download:${job.id}`) ? '准备中…' : '下载' }}</button><button v-if="canRetry(displayJob(job))" type="button" :disabled="actionBusy.has(`retry:${job.id}`)" @click="retryJob(job)">{{ actionBusy.has(`retry:${job.id}`) ? '提交中…' : '重试失败项' }}</button><button v-if="canDelete(job)" type="button" class="danger" :disabled="actionBusy.has(`delete:${job.id}`)" @click="deleteJob(job)">删除</button></div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="visibleRows.length" class="pagination-bar">
        <p>第 {{ pagination.page }} 页<span v-if="pagination.hasMore"> · 还有更多结果</span></p>
        <label>每页 <select :value="pagination.pageSize" @change="changePageSize"><option v-for="size in pageSizes" :key="size" :value="size">{{ size }}</option></select> 条</label>
        <nav aria-label="批量图片任务分页"><button type="button" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">上一页</button><button type="button" :disabled="!pagination.hasMore" @click="changePage(pagination.page + 1)">下一页</button></nav>
      </footer>
    </section>

    <BatchImageCreateDialog :show="createOpen" :api-keys="allowedKeys" :endpoint-base="endpointBase" @close="createOpen = false" @saved="handleCreated" />
    <BatchImageDetailDialog :show="detailOpen" :job="detailJob" :all-jobs="jobs" :api-key="detailApiKey" @close="closeDetail" @updated="handleUpdated" @child-created="handleChildCreated" @downloaded="markDownloaded" />
    <BatchImageGuideDialog :show="guideOpen" :endpoint-base="endpointBase" @close="guideOpen = false" />
  </ConsoleShell>
</template>

<style scoped>
.batch-page { min-width: 0; display: grid; gap: 18px; }
.batch-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
.batch-heading > div:first-child { display: grid; gap: 7px; }
.batch-heading p, .batch-heading h1, .batch-heading span { margin: 0; }
.batch-heading p { color: var(--accent); font-size: var(--font-meta); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.batch-heading h1 { font-size: clamp(30px, 3.6vw, 48px); letter-spacing: -.045em; }
.batch-heading span { color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.heading-actions { display: flex; gap: 8px; }
.batch-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 14px; }
.batch-metrics > div { min-width: 0; padding: 18px 20px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); }
.batch-metrics > div:last-child { border-right: 0; }
.batch-metrics span, .batch-metrics small { color: var(--text-secondary); font-size: var(--font-meta); }
.batch-metrics strong { font-size: 25px; font-variant-numeric: tabular-nums; }
.permission-state { padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; gap: 18px; background: color-mix(in srgb, var(--warning) 8%, var(--surface-raised)); border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border-subtle)); border-radius: 13px; }
.permission-state div { display: grid; gap: 5px; }
.permission-state span { color: var(--warning); font-size: var(--font-meta); font-weight: 750; letter-spacing: .04em; }
.permission-state strong { font-size: 13px; }
.permission-state p { margin: 0; color: var(--text-secondary); font-size: var(--font-body-sm); }
.batch-toolbar { padding: 14px; display: grid; grid-template-columns: minmax(190px, 1.4fr) repeat(3, minmax(132px, .8fr)) auto auto auto; align-items: end; gap: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }
.batch-toolbar label { min-width: 0; display: grid; gap: 6px; color: var(--text-secondary); font-size: var(--font-meta); font-weight: 680; }
.batch-toolbar input, .batch-toolbar select { width: 100%; min-height: 38px; padding: 0 10px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; font: inherit; font-size: var(--font-body-sm); }
.toolbar-button { min-height: 38px; padding: 0 12px; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); font-weight: 650; white-space: nowrap; }
.toolbar-button:hover { color: var(--text-primary); border-color: var(--accent); }
.toolbar-button--refresh { margin-left: auto; }
.bulk-bar { min-height: 50px; padding: 9px 13px; display: flex; align-items: center; gap: 8px; background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-subtle)); border-radius: 11px; }
.bulk-bar > div { margin-right: auto; display: grid; gap: 2px; }
.bulk-bar strong { font-size: var(--font-body-sm); }.bulk-bar span { color: var(--text-secondary); font-size: var(--font-meta); }
.bulk-bar button { min-height: 32px; padding: 0 10px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; font-size: var(--font-meta); }
.bulk-bar button.danger { color: var(--danger); }
.batch-state { min-height: 300px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 14px; text-align: center; }
.batch-state strong { color: var(--text-primary); font-size: 16px; }.batch-state span { max-width: 560px; font-size: var(--font-body-sm); line-height: 1.6; }.batch-state--error strong, .batch-state--error span { color: var(--danger); }
.batch-table-wrap { width: 100%; min-width: 0; overflow: auto; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 14px; }
table { width: 100%; min-width: 1280px; border-collapse: collapse; }
th, td { padding: 12px 13px; text-align: left; vertical-align: middle; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }
th { color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-meta); font-weight: 720; letter-spacing: .02em; }
tbody tr:last-child td { border-bottom: 0; }.child-row { background: color-mix(in srgb, var(--accent) 4%, transparent); }
.check-cell { width: 42px; text-align: center; }.check-cell input { width: 15px; height: 15px; accent-color: var(--accent); }
.task-cell { min-width: 245px; }.task-cell > div { display: flex; align-items: center; gap: 7px; }.task-cell > small { margin: 5px 0 0 29px; display: block; color: var(--text-secondary); font-size: var(--font-meta); }
.expand-button, .child-mark, .empty-mark { width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center; }.expand-button { color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 6px; cursor: pointer; }.child-mark { color: var(--accent); }
.task-link { min-width: 0; padding: 0; display: grid; gap: 3px; text-align: left; background: transparent; border: 0; cursor: pointer; }.task-link strong { max-width: 230px; overflow: hidden; color: var(--text-primary); text-overflow: ellipsis; white-space: nowrap; }.task-link code { color: var(--text-secondary); font-size: var(--font-meta); }
.model-cell { min-width: 190px; }.model-cell strong, .model-cell small, td > strong, td > small { display: block; }.model-cell small, td > small { margin-top: 4px; color: var(--text-secondary); font-size: var(--font-meta); }
.status-pill { width: max-content; padding: 5px 8px; display: block; border-radius: 999px; font-size: var(--font-meta); font-weight: 750; }.status-pill--success { color: var(--success); background: color-mix(in srgb, var(--success) 11%, transparent); }.status-pill--warning { color: var(--warning); background: color-mix(in srgb, var(--warning) 11%, transparent); }.status-pill--danger { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }.status-pill--active { color: var(--accent); background: var(--accent-soft); }.status-pill--muted { color: var(--text-secondary); background: var(--surface-canvas); }
.result-cell span { display: block; color: var(--danger); }.result-cell small { color: var(--success); }.download-state { color: var(--text-secondary); }.download-state.done { color: var(--success); }
.actions-cell { min-width: 245px; }.actions-cell > div { display: flex; flex-wrap: wrap; gap: 5px; }.actions-cell button { min-height: 30px; padding: 0 8px; color: var(--accent); background: transparent; border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; font-size: var(--font-meta); }.actions-cell button.danger { color: var(--danger); }.actions-cell button:disabled, .bulk-bar button:disabled { opacity: .4; cursor: not-allowed; }
.pagination-bar { min-height: 48px; padding: 0 4px; display: flex; align-items: center; gap: 20px; color: var(--text-secondary); font-size: var(--font-meta); }.pagination-bar p { margin-right: auto; }.pagination-bar label { display: flex; align-items: center; gap: 5px; }.pagination-bar select { min-height: 30px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 6px; }.pagination-bar nav { display: flex; gap: 6px; }.pagination-bar button { min-height: 32px; padding: 0 11px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; }.pagination-bar button:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 1360px) { .batch-toolbar { grid-template-columns: repeat(4, minmax(140px, 1fr)); }.toolbar-button--refresh { margin-left: 0; }.batch-metrics { grid-template-columns: 1fr 1fr; }.batch-metrics > div:nth-child(2) { border-right: 0; }.batch-metrics > div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); } }
@media (max-width: 720px) { .batch-heading, .permission-state { align-items: stretch; flex-direction: column; }.heading-actions { display: grid; grid-template-columns: 1fr 1fr; }.batch-toolbar { grid-template-columns: 1fr 1fr; }.search-field { grid-column: 1 / -1; }.bulk-bar { align-items: stretch; flex-wrap: wrap; }.bulk-bar > div { width: 100%; }.batch-metrics { grid-template-columns: 1fr; }.batch-metrics > div { border-right: 0; border-bottom: 1px solid var(--border-subtle); }.batch-metrics > div:last-child { border-bottom: 0; } }
</style>
