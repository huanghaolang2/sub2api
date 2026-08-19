import type { BatchImageItem, BatchImageJob, BatchImageStatus, BatchImageSubmitItem } from '@shared-api/batchImage'
import type { ApiKey } from '@/types'

export enum BatchDownloadFilter {
  ALL = '',
  DOWNLOADED = 'true',
  NOT_DOWNLOADED = 'false'
}

export enum BatchOutputMimeType {
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  WEBP = 'image/webp'
}

export interface BatchImageJobRow extends BatchImageJob {
  api_key_id: number
  api_key_name: string
  child_count: number
  is_child?: boolean
}

export interface BatchPromptRow extends BatchImageSubmitItem {
  local_id: string
}

export const TERMINAL_BATCH_STATUSES = new Set<BatchImageStatus>(['completed', 'failed', 'cancelled', 'output_deleted'])
export const BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM = 4
export const BATCH_IMAGE_MAX_OUTPUTS_PER_JOB = 200
export const BATCH_IMAGE_MAX_FILE_BYTES = 10 * 1024 * 1024

const statusLabels: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  indexing: '整理结果',
  processing_results: '整理结果',
  settling: '结算中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  output_deleted: '输出已删除'
}

const userErrorMessages: Record<string, string> = {
  API_KEY_REQUIRED: 'API Key 无效或已失效，请重新选择。',
  BATCH_IMAGE_NO_ACCOUNT_AVAILABLE: '当前没有兼容的上游生图账号，请联系管理员检查账号池。',
  BATCH_IMAGE_UNSUPPORTED_PROVIDER: '当前分组未配置兼容的批量生图服务商，请联系管理员。',
  BATCH_IMAGE_VERTEX_GCS_BUCKET_MISSING: 'Vertex 批量生图缺少托管 GCS 存储桶，请联系管理员。',
  VERTEX_MANAGED_GCS_BUCKET_MISSING: 'Vertex 批量生图缺少托管 GCS 存储桶，请联系管理员。',
  BATCH_IMAGE_PROVIDER_SUBMIT_FAILED: '上游任务提交失败，请联系管理员并提供错误编号。',
  BATCH_IMAGE_PROVIDER_MISSING_API_KEY: '上游账号缺少 API Key，请联系管理员。',
  BATCH_IMAGE_PROVIDER_MISSING_SERVICE_ACCOUNT: '上游账号缺少服务账号，请联系管理员。',
  BATCH_IMAGE_PROVIDER_UNSUPPORTED_ACCOUNT: '上游账号不支持所选批量生图能力，请联系管理员。',
  BATCH_IMAGE_QUEUE_FAILED: '任务队列暂时不可用，请稍后重试。',
  BATCH_IMAGE_QUEUE_NOT_CONFIGURED: '任务队列尚未配置，请联系管理员。',
  BATCH_IMAGE_BILLING_HOLD_FAILED: '预冻结金额失败，请检查余额后重试。',
  BATCH_IMAGE_GROUP_DISABLED: '所选分组已关闭批量生图。',
  BATCH_IMAGE_SETTLEMENT_PRICING_MISSING: '任务缺少结算价格，请联系管理员。',
  BATCH_IMAGE_INSUFFICIENT_BALANCE: '余额不足，无法冻结本次任务金额。',
  BATCH_IMAGE_INVALID_MODEL: '所选模型不可用，请刷新模型列表。',
  BATCH_IMAGE_INVALID_ITEMS: 'Prompt 列表无效，请检查后重试。',
  BATCH_IMAGE_DUPLICATE_CUSTOM_ID: 'custom_id 重复，请为每条 Prompt 使用唯一标识。',
  BATCH_IMAGE_PROMPT_TOO_LONG: '某条 Prompt 超过长度限制。',
  BATCH_IMAGE_INVALID_REFERENCE_IMAGE: '参考图格式或内容无效。',
  BATCH_IMAGE_TOO_MANY_REFERENCE_IMAGES: '参考图数量超过模型限制。',
  BATCH_IMAGE_REFERENCE_IMAGES_TOO_LARGE: '参考图总大小超过限制，请压缩或拆分任务。',
  BATCH_IMAGE_TOO_MANY_OUTPUT_IMAGES: '预计输出超过 200 张，请拆分任务。',
  BATCH_IMAGE_IDEMPOTENCY_CONFLICT: '幂等键对应的请求内容不一致，请重新提交。',
  BATCH_IMAGE_NOT_READY: '任务尚未完成，暂时不能执行该操作。',
  BATCH_IMAGE_OUTPUT_DELETED: '该任务的输出已删除。',
  BATCH_IMAGE_RESULT_MISSING: '任务结果文件缺失，请联系管理员。',
  BATCH_IMAGE_ITEM_FAILED: '该图片生成失败。',
  BATCH_IMAGE_ITEM_IMAGE_INDEX_OUT_OF_RANGE: '请求的图片序号不存在。',
  BATCH_IMAGE_DOWNLOAD_LIMITED: '下载过于频繁，请稍后重试。',
  BATCH_IMAGE_DOWNLOAD_TOO_LARGE: '结果包过大，请联系管理员协助下载。',
  BATCH_IMAGE_RECORD_DELETE_NOT_READY: '运行中的任务不能删除，请先取消或等待结束。',
  BATCH_IMAGE_DISABLED: '系统已关闭批量生图功能。'
}

export function keyAllowsBatchImage(key: ApiKey): boolean {
  return key.status === 'active' && key.group?.platform === 'gemini' && key.group?.allow_batch_image_generation === true
}

export function referenceImageLimit(model: string): number {
  const normalized = String(model || '').toLowerCase()
  if (normalized.includes('pro-image')) return 14
  if (normalized.includes('flash-image')) return 3
  return 0
}

export function normalizeOutputCount(value: unknown): number {
  const parsed = Math.floor(Number(value || 1))
  if (!Number.isFinite(parsed)) return 1
  return Math.min(BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM, Math.max(1, parsed))
}

export function uniqueCustomId(raw: string, used: Set<string>, index: number): string {
  const fallback = `img_${String(index + 1).padStart(3, '0')}`
  const base = raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || fallback
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}_${suffix++}`
  used.add(candidate)
  return candidate
}

export function estimateOutputs(rows: Array<Pick<BatchPromptRow, 'output_count'>>): number {
  return rows.reduce((total, row) => total + normalizeOutputCount(row.output_count), 0)
}

export function toJobRow(job: BatchImageJob, key: ApiKey): BatchImageJobRow {
  return { ...job, task_name: job.task_name || defaultTaskName(job.created_at), api_key_id: key.id, api_key_name: key.name || `API Key #${key.id}`, child_count: 0 }
}

export function applyChildCounts(rows: BatchImageJobRow[]): BatchImageJobRow[] {
  const counts = new Map<string, number>()
  rows.forEach((row) => { if (row.parent_batch_id) counts.set(row.parent_batch_id, (counts.get(row.parent_batch_id) || 0) + 1) })
  return rows.map((row) => ({ ...row, child_count: counts.get(row.id) || 0 }))
}

export function childrenByParent(rows: BatchImageJobRow[]): Map<string, BatchImageJobRow[]> {
  const grouped = new Map<string, BatchImageJobRow[]>()
  for (const row of rows) {
    if (!row.parent_batch_id) continue
    const children = grouped.get(row.parent_batch_id) || []
    children.push(row)
    grouped.set(row.parent_batch_id, children)
  }
  grouped.forEach((children) => children.sort((left, right) => left.created_at - right.created_at))
  return grouped
}

export function visibleJobRows(rows: BatchImageJobRow[], expanded: Set<string>): BatchImageJobRow[] {
  const grouped = childrenByParent(rows)
  const visible: BatchImageJobRow[] = []
  for (const row of rows.filter((item) => !item.parent_batch_id)) {
    visible.push(row)
    if (expanded.has(row.id)) visible.push(...(grouped.get(row.id) || []).map((child) => ({ ...child, is_child: true })))
  }
  return visible
}

export function aggregateJob(job: BatchImageJobRow, allRows: BatchImageJobRow[]): BatchImageJobRow {
  if (job.parent_batch_id) return job
  const children = childrenByParent(allRows).get(job.id) || []
  if (!children.length) return job
  const success = Math.min(job.item_count, job.success_count + children.reduce((total, child) => total + child.success_count, 0))
  const failures = Math.max(0, job.item_count - success)
  const actualValues = [job, ...children].map((item) => item.actual_cost)
  const sumMoney = (values: number[]): number => Number(values.reduce((total, value) => total + value, 0).toFixed(12))
  return {
    ...job,
    success_count: success,
    fail_count: failures,
    status: failures === 0 && TERMINAL_BATCH_STATUSES.has(job.status) ? 'completed' : job.status,
    estimated_cost: sumMoney([job.estimated_cost, ...children.map((child) => child.estimated_cost)]),
    hold_amount: sumMoney([job.hold_amount, ...children.map((child) => child.hold_amount)]),
    actual_cost: actualValues.every((value) => value != null) ? sumMoney(actualValues.map((value) => Number(value || 0))) : null
  }
}

export function canCancel(job: Pick<BatchImageJob, 'status'>): boolean {
  return !TERMINAL_BATCH_STATUSES.has(job.status)
}

export function canDownload(job: Pick<BatchImageJob, 'status' | 'success_count'>): boolean {
  return job.status === 'completed' && job.success_count > 0
}

export function canRetry(job: Pick<BatchImageJob, 'status' | 'fail_count'>): boolean {
  return TERMINAL_BATCH_STATUSES.has(job.status) && job.fail_count > 0
}

export function canDelete(job: Pick<BatchImageJob, 'status'>): boolean {
  return TERMINAL_BATCH_STATUSES.has(job.status)
}

export function batchPendingCount(job: Pick<BatchImageJob, 'status' | 'item_count' | 'success_count' | 'fail_count'>): number {
  if (TERMINAL_BATCH_STATUSES.has(job.status)) return 0
  return Math.max(0, job.item_count - job.success_count - job.fail_count)
}

export function batchStatusLabel(job: Pick<BatchImageJob, 'status' | 'success_count' | 'fail_count'>): string {
  if (job.status === 'completed' && job.fail_count > 0) return job.success_count > 0 ? '部分成功' : '全部失败'
  return statusLabels[job.status] || job.status
}

export function batchStatusTone(job: Pick<BatchImageJob, 'status' | 'success_count' | 'fail_count'>): string {
  if (job.status === 'completed' && job.fail_count === 0) return 'success'
  if (job.status === 'completed' && job.success_count > 0) return 'warning'
  if (job.status === 'failed' || job.status === 'cancelled') return 'danger'
  if (job.status === 'output_deleted') return 'muted'
  return 'active'
}

export function itemStatusLabel(item: BatchImageItem): string {
  if (item.status === 'succeeded' || item.status === 'success') return '生成成功'
  if (item.status === 'failed') return '生成失败'
  if (item.status === 'cancelled') return '已取消'
  return item.status === 'pending' ? '等待处理' : item.status
}

export function batchCostLabel(job: Pick<BatchImageJob, 'status' | 'hold_amount' | 'actual_cost'>): string {
  if (job.actual_cost != null) return formatMoney(job.actual_cost)
  if (job.status === 'failed' || job.status === 'cancelled') return formatMoney(0)
  return `冻结 ${formatMoney(job.hold_amount)}`
}

export function batchErrorMessage(caught: unknown, fallback: string): string {
  const error = caught as { code?: string | number; message?: string; requestId?: string; status?: number }
  const code = String(error?.code || '')
  const message = userErrorMessages[code] || error?.message || fallback
  const references = [code ? `错误码 ${code}` : '', error?.requestId ? `请求 ID ${error.requestId}` : '', !code && error?.status ? `HTTP ${error.status}` : ''].filter(Boolean)
  return references.length ? `${message}（${references.join('，')}）` : message
}

export function failedRetryItems(items: BatchImageItem[]): BatchImageSubmitItem[] {
  const stamp = Date.now().toString(36)
  return items.filter((item) => item.status === 'failed' && item.prompt_preview?.trim()).map((item) => ({
    custom_id: `${String(item.custom_id || 'item').replace(/[^\w.-]+/g, '_')}_retry_${stamp}`,
    prompt: String(item.prompt_preview).trim()
  }))
}

export function retrySourceCustomId(customId: string): string {
  return String(customId || '').replace(/(?:_retry_[a-z0-9]+)+$/i, '')
}

export function recoveredOriginalCustomIds(items: BatchImageItem[], rootBatchId: string): Set<string> {
  const recovered = new Set<string>()
  for (const item of items) {
    if (!item.batch_id || item.batch_id === rootBatchId || !['succeeded', 'success'].includes(item.status)) continue
    recovered.add(retrySourceCustomId(item.custom_id))
  }
  return recovered
}

export function unresolvedFailedRetryItems(items: BatchImageItem[], rootBatchId: string): BatchImageSubmitItem[] {
  const recovered = recoveredOriginalCustomIds(items, rootBatchId)
  const rootFailures = items.filter((item) => (!item.batch_id || item.batch_id === rootBatchId) && !recovered.has(item.custom_id))
  return failedRetryItems(rootFailures)
}

export function defaultTaskName(timestamp?: number): string {
  const date = timestamp ? new Date(timestamp * 1000) : new Date()
  const parts = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')]
  return `批量图片 ${parts.join('-')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatMoney(value: number | null | undefined): string {
  return `$${Number(value || 0).toFixed(2)}`
}

export function formatBatchTime(timestamp: number | null | undefined): string {
  return timestamp ? new Date(timestamp * 1000).toLocaleString('zh-CN') : '—'
}
