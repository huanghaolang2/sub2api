<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import * as batchAPI from '@shared-api/batchImage'
import type { BatchImageItem, BatchImageJob } from '@shared-api/batchImage'
import type { ApiKey } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import {
  aggregateJob,
  batchCostLabel,
  batchErrorMessage,
  batchStatusLabel,
  batchStatusTone,
  canCancel,
  canDownload,
  canRetry,
  childrenByParent,
  formatBatchTime,
  itemStatusLabel,
  recoveredOriginalCustomIds,
  TERMINAL_BATCH_STATUSES,
  unresolvedFailedRetryItems,
  type BatchImageJobRow
} from '@/features/user/batch-image/model'
import { useAppStore } from '@/stores/app'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useModalInteraction } from '@/composables/useModalInteraction'

interface DetailItem extends BatchImageItem {
  batch_id: string
  source_task_name: string
}

const props = defineProps<{ show: boolean; job: BatchImageJobRow | null; allJobs: BatchImageJobRow[]; apiKey: ApiKey | null }>()
const emit = defineEmits<{ close: []; updated: [job: BatchImageJob]; childCreated: [job: BatchImageJob, key: ApiKey]; downloaded: [batchId: string] }>()
const app = useAppStore()
const confirmDialog = useConfirmStore()

const current = ref<BatchImageJob | null>(null)
const items = ref<DetailItem[]>([])
const loading = ref(false)
const refreshing = ref(false)
const loadingItems = ref(false)
const actionBusy = ref('')
const error = ref('')
const previewUrls = ref<Record<string, string>>({})
const previewLoading = ref(new Set<string>())
const previewErrors = ref(new Set<string>())
const previewItem = ref<DetailItem | null>(null)
const previewDialog = ref<HTMLElement | null>(null)
useModalInteraction(() => Boolean(previewItem.value), previewDialog, () => { previewItem.value = null })
let pollTimer: number | null = null
let sequence = 0

const displayJob = computed(() => props.job ? aggregateJob({ ...props.job, ...(current.value || {}) }, props.allJobs) : null)
const childJobs = computed(() => props.job ? childrenByParent(props.allJobs).get(props.job.parent_batch_id || props.job.id) || [] : [])
const detailRootId = computed(() => props.job?.parent_batch_id || props.job?.id || '')
const recoveredIds = computed(() => recoveredOriginalCustomIds(items.value, detailRootId.value))

function previewKey(item: DetailItem): string {
  return `${item.batch_id}:${item.custom_id}:0`
}

function jobsForDetail(): BatchImageJobRow[] {
  if (!props.job) return []
  if (props.job.parent_batch_id) return [props.job]
  return [props.job, ...childJobs.value]
}

async function refreshJob(silent = false): Promise<void> {
  if (!props.job || !props.apiKey) return
  if (!silent) refreshing.value = true
  try {
    const result = await batchAPI.getBatchImageJob(props.apiKey.key, props.job.id)
    current.value = result
    emit('updated', result)
    if (TERMINAL_BATCH_STATUSES.has(result.status)) stopPolling()
  } catch (caught) {
    if (!silent) app.showError(batchErrorMessage(caught, '任务状态刷新失败'))
  } finally {
    refreshing.value = false
  }
}

async function loadItems(): Promise<void> {
  if (!props.apiKey || !props.job) return
  loadingItems.value = true
  try {
    const results = await Promise.all(jobsForDetail().map(async (job) => {
      const response = await batchAPI.listBatchImageItems(props.apiKey!.key, job.id)
      return (response.data || []).map((item) => ({ ...item, batch_id: job.id, source_task_name: job.id === props.job?.id ? `主任务 · ${job.task_name}` : `重试任务 · ${job.task_name}` }))
    }))
    items.value = results.flat()
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '图片明细加载失败'))
  } finally {
    loadingItems.value = false
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([refreshJob(), loadItems()])
}

async function cancel(): Promise<void> {
  if (!current.value || !props.apiKey || !canCancel(current.value)) return
  const confirmed = await confirmDialog.ask({ title: '取消批量图片任务', message: '已被系统索引为成功的图片仍会结算，其余冻结金额会释放。确定取消？', confirmText: '确认取消', tone: ConfirmTone.DANGER })
  if (!confirmed) return
  actionBusy.value = 'cancel'
  try {
    const result = await batchAPI.cancelBatchImageJob(props.apiKey.key, current.value.id)
    current.value = result
    emit('updated', result)
    app.showSuccess('任务已取消，系统将结算已成功图片并释放剩余冻结金额。')
    stopPolling()
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '取消任务失败'))
  } finally {
    actionBusy.value = ''
  }
}

async function retryFailed(): Promise<void> {
  if (!displayJob.value || !props.apiKey || !canRetry(displayJob.value)) return
  const sourceBatchId = current.value?.id || props.job?.id || ''
  actionBusy.value = 'retry'
  try {
    const retryItems = unresolvedFailedRetryItems(items.value, sourceBatchId)
    if (!retryItems.length) {
      app.showError('失败项没有保留 Prompt，无法自动重试；请提供原 Prompt 后新建任务。')
      return
    }
    const source = current.value || props.job!
    const child = await batchAPI.submitBatchImageJob(props.apiKey.key, {
      model: source.model,
      task_name: `${source.task_name} · 失败项重试`,
      parent_batch_id: source.parent_batch_id || source.id,
      provider: source.provider,
      image_size: '1K',
      response_mime_type: 'image/png',
      items: retryItems
    }, `sub2api-ui-retry-${source.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
    app.showSuccess(`已仅重试 ${retryItems.length} 个失败项。`)
    emit('childCreated', child, props.apiKey)
    emit('close')
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '失败项重试提交失败'))
  } finally {
    actionBusy.value = ''
  }
}

async function download(): Promise<void> {
  if (!displayJob.value || !props.apiKey || !canDownload(displayJob.value)) return
  actionBusy.value = 'download'
  try {
    const blob = await batchAPI.downloadBatchImageZip(props.apiKey.key, displayJob.value.id)
    batchAPI.saveBlob(blob, `${displayJob.value.id}.zip`)
    emit('downloaded', displayJob.value.id)
    app.showSuccess('结果 ZIP 已开始下载。')
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '结果下载失败'))
  } finally {
    actionBusy.value = ''
  }
}

async function loadPreview(item: DetailItem): Promise<void> {
  if (!props.apiKey || !['succeeded', 'success'].includes(item.status) || item.image_count <= 0) return
  const key = previewKey(item)
  const nextLoading = new Set(previewLoading.value)
  nextLoading.add(key)
  previewLoading.value = nextLoading
  try {
    if (previewUrls.value[key]) URL.revokeObjectURL(previewUrls.value[key])
    const blob = await batchAPI.getBatchImageItemContent(props.apiKey.key, item.batch_id, item.custom_id, 0)
    previewUrls.value = { ...previewUrls.value, [key]: URL.createObjectURL(blob) }
    const nextErrors = new Set(previewErrors.value)
    nextErrors.delete(key)
    previewErrors.value = nextErrors
  } catch (caught) {
    const nextErrors = new Set(previewErrors.value)
    nextErrors.add(key)
    previewErrors.value = nextErrors
    app.showError(batchErrorMessage(caught, '图片预览加载失败'))
  } finally {
    const next = new Set(previewLoading.value)
    next.delete(key)
    previewLoading.value = next
  }
}

function openPreview(item: DetailItem): void {
  if (previewUrls.value[previewKey(item)]) previewItem.value = item
}

function itemResult(item: DetailItem): string {
  if (isRecoveredFailure(item)) return '已由重试任务生成成功，不再计入未解决失败'
  if (item.error) return `${item.error.code || 'ITEM_FAILED'} · ${item.error.message || '生成失败'}`
  if (['succeeded', 'success'].includes(item.status)) return `${item.image_count} 张可下载`
  return item.status === 'failed' ? '没有可用图片' : '等待生成结果'
}

function isRecoveredFailure(item: DetailItem): boolean {
  return item.batch_id === detailRootId.value && item.status === 'failed' && recoveredIds.value.has(item.custom_id)
}

function detailItemStatus(item: DetailItem): string {
  return isRecoveredFailure(item) ? '已由重试恢复' : itemStatusLabel(item)
}

function startPolling(): void {
  stopPolling()
  pollTimer = window.setInterval(() => {
    if (!current.value || TERMINAL_BATCH_STATUSES.has(current.value.status) || document.hidden) return
    void refreshJob(true)
  }, 8000)
}

function stopPolling(): void {
  if (pollTimer != null) window.clearInterval(pollTimer)
  pollTimer = null
}

function cleanupPreviews(): void {
  Object.values(previewUrls.value).forEach((url) => URL.revokeObjectURL(url))
  previewUrls.value = {}
  previewLoading.value = new Set()
  previewErrors.value = new Set()
  previewItem.value = null
}

function close(): void {
  stopPolling()
  cleanupPreviews()
  emit('close')
}

watch([() => props.show, () => props.job?.id], async ([show]) => {
  const id = ++sequence
  if (!show || !props.job) { stopPolling(); return }
  loading.value = true
  error.value = ''
  current.value = { ...props.job }
  items.value = []
  cleanupPreviews()
  try {
    await Promise.all([refreshJob(true), loadItems()])
    if (id === sequence && current.value && !TERMINAL_BATCH_STATUSES.has(current.value.status)) startPolling()
  } catch (caught) {
    if (id === sequence) error.value = batchErrorMessage(caught, '任务详情加载失败')
  } finally {
    if (id === sequence) loading.value = false
  }
}, { immediate: true })
onBeforeUnmount(() => { stopPolling(); cleanupPreviews() })
</script>

<template>
  <SurfaceDialog :show="show" :title="displayJob?.task_name || '任务详情'" :description="displayJob ? `${displayJob.id} · ${displayJob.model}` : ''" :width="DialogWidth.WIDE" @close="close">
    <div v-if="loading" class="detail-state">正在加载任务状态与图片明细…</div>
    <div v-else-if="error" class="detail-state detail-state--error">{{ error }}</div>
    <div v-else-if="displayJob" class="batch-detail">
      <section class="detail-kpis"><div><span>状态</span><strong :class="`tone-${batchStatusTone(displayJob)}`">{{ batchStatusLabel(displayJob) }}</strong></div><div><span>结果</span><strong>{{ displayJob.success_count }} 成功 / {{ displayJob.fail_count }} 失败</strong></div><div><span>费用</span><strong>{{ batchCostLabel(displayJob) }}</strong></div><div><span>下载</span><strong>{{ displayJob.downloaded_at ? formatBatchTime(displayJob.downloaded_at) : '尚未下载' }}</strong></div></section>
      <section class="detail-context"><span>服务 {{ displayJob.provider }}</span><span>共 {{ displayJob.item_count }} 项</span><span>创建 {{ formatBatchTime(displayJob.created_at) }}</span><span v-if="displayJob.parent_batch_id">重试子任务 · 父任务 {{ displayJob.parent_batch_id }}</span><span v-else-if="childJobs.length">已聚合 {{ childJobs.length }} 个失败项重试任务</span><button type="button" :disabled="refreshing" @click="refreshAll">{{ refreshing ? '刷新中…' : '刷新状态与明细' }}</button></section>
      <div class="detail-table-wrap"><table><thead><tr><th>来源 / custom_id</th><th>Prompt</th><th>状态</th><th>图片</th><th>预览</th><th>结果 / 错误</th></tr></thead><tbody><tr v-for="item in items" :key="`${item.batch_id}:${item.custom_id}`" :class="{ 'recovered-row': isRecoveredFailure(item) }"><td><small>{{ item.source_task_name }}</small><code>{{ item.custom_id }}</code></td><td><p :title="item.prompt_preview || ''">{{ item.prompt_preview || '—' }}</p></td><td><span :class="isRecoveredFailure(item) ? 'item-recovered' : `item-${item.status}`">{{ detailItemStatus(item) }}</span></td><td>{{ item.image_count }}</td><td><div class="preview-cell"><button v-if="previewUrls[previewKey(item)]" type="button" @click="openPreview(item)"><img :src="previewUrls[previewKey(item)]" alt=""><span>放大</span></button><button v-else-if="['succeeded', 'success'].includes(item.status) && item.image_count > 0" type="button" :disabled="previewLoading.has(previewKey(item))" @click="loadPreview(item)">{{ previewLoading.has(previewKey(item)) ? '加载中…' : previewErrors.has(previewKey(item)) ? '重试预览' : '按需预览' }}</button><span v-else>—</span></div></td><td><span :class="{ 'error-copy': item.error && !isRecoveredFailure(item) }">{{ itemResult(item) }}</span></td></tr></tbody></table><div v-if="loadingItems" class="table-state">正在加载图片明细…</div><div v-else-if="items.length === 0" class="table-state">任务尚未产生图片明细。</div></div>
    </div>
    <template #footer><button type="button" class="button button--secondary" :disabled="!displayJob || !canCancel(displayJob) || actionBusy === 'cancel'" @click="cancel">{{ actionBusy === 'cancel' ? '取消中…' : '取消任务' }}</button><button v-if="displayJob && canRetry(displayJob)" type="button" class="button button--secondary" :disabled="actionBusy === 'retry'" @click="retryFailed">{{ actionBusy === 'retry' ? '提交重试…' : '仅重试失败项' }}</button><button type="button" class="button button--primary" :disabled="!displayJob || !canDownload(displayJob) || actionBusy === 'download'" @click="download">{{ actionBusy === 'download' ? '准备 ZIP…' : '下载 ZIP' }}</button></template>

    <Teleport to="body"><div v-if="previewItem" ref="previewDialog" class="image-preview-overlay" role="dialog" aria-modal="true" tabindex="-1" :aria-label="`${previewItem.custom_id} 图片预览`"><header><div><strong>{{ previewItem.custom_id }}</strong><span>页面仅缓存本次会话的临时预览；正式文件请下载 ZIP。</span></div><button type="button" aria-label="关闭图片预览" @click="previewItem = null">×</button></header><div><img :src="previewUrls[previewKey(previewItem)]" :alt="previewItem.custom_id"></div></div></Teleport>
  </SurfaceDialog>
</template>

<style scoped>
.detail-state { min-height: 320px; display: grid; place-content: center; color: var(--text-secondary); }.detail-state--error { color: var(--danger); }.batch-detail { display: grid; gap: 12px; }.detail-kpis { display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--border-subtle); }.detail-kpis div { padding: 12px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); }.detail-kpis div:last-child { border-right: 0; }.detail-kpis span { color: var(--text-secondary); font-size: var(--font-caption); }.detail-kpis strong { font-size: var(--font-meta); }.tone-success { color: var(--success); }.tone-warning { color: var(--warning); }.tone-danger { color: var(--danger); }.detail-context { padding: 9px 10px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; background: var(--surface-canvas); border-radius: 8px; }.detail-context span { padding-right: 7px; color: var(--text-secondary); border-right: 1px solid var(--border-subtle); font-size: var(--font-caption); }.detail-context button { margin-left: auto; color: var(--accent); background: transparent; border: 0; cursor: pointer; font-size: var(--font-caption); }.detail-table-wrap { max-height: 430px; position: relative; overflow: auto; border: 1px solid var(--border-subtle); border-radius: 10px; }.detail-table-wrap table { width: 100%; min-width: 920px; border-collapse: collapse; }.detail-table-wrap th, .detail-table-wrap td { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }.detail-table-wrap th { position: sticky; top: 0; z-index: 1; color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-caption); }.detail-table-wrap td:first-child small, .detail-table-wrap td:first-child code { display: block; }.detail-table-wrap td:first-child small { margin-bottom: 4px; color: var(--text-secondary); font-size: var(--font-caption); }.detail-table-wrap td p { max-width: 260px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.item-succeeded, .item-success { color: var(--success); }.item-failed, .item-cancelled, .error-copy { color: var(--danger); }.item-recovered { color: var(--text-secondary); }.recovered-row { color: var(--text-secondary); background: var(--surface-canvas); opacity: .72; }.preview-cell { width: 64px; min-height: 44px; display: grid; place-content: center; }.preview-cell button { position: relative; min-width: 58px; min-height: 34px; overflow: hidden; color: var(--accent); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 6px; cursor: pointer; font-size: var(--font-caption); }.preview-cell img { width: 58px; height: 42px; display: block; object-fit: cover; }.preview-cell button span { position: absolute; right: 2px; bottom: 2px; padding: 2px 3px; color: white; background: rgb(0 0 0 / 62%); border-radius: 3px; font-size: var(--font-caption); }.table-state { min-height: 120px; display: grid; place-content: center; color: var(--text-secondary); font-size: var(--font-meta); }
.image-preview-overlay { z-index: 130; position: fixed; inset: 0; padding: 24px; display: grid; grid-template-rows: auto minmax(0, 1fr); color: white; background: rgb(5 5 8 / 92%); backdrop-filter: blur(10px); }.image-preview-overlay header { padding-bottom: 15px; display: flex; justify-content: space-between; gap: 15px; }.image-preview-overlay header div { display: grid; gap: 5px; }.image-preview-overlay header span { color: rgb(255 255 255 / 60%); font-size: var(--font-meta); }.image-preview-overlay header button { width: 36px; height: 36px; color: white; background: rgb(255 255 255 / 10%); border: 0; border-radius: 8px; cursor: pointer; font-size: 22px; }.image-preview-overlay > div:last-child { min-height: 0; display: grid; place-content: center; overflow: auto; }.image-preview-overlay img { max-width: 100%; max-height: calc(100vh - 110px); object-fit: contain; }
@media (max-width: 680px) { .detail-kpis { grid-template-columns: 1fr 1fr; }.detail-kpis div:nth-child(2) { border-right: 0; }.detail-kpis div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); } }
</style>
