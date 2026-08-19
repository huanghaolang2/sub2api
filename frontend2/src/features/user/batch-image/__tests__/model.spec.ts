import { describe, expect, it } from 'vitest'
import type { BatchImageJob } from '@shared-api/batchImage'
import type { ApiKey } from '@/types'
import {
  aggregateJob,
  applyChildCounts,
  batchErrorMessage,
  batchPendingCount,
  estimateOutputs,
  failedRetryItems,
  keyAllowsBatchImage,
  normalizeOutputCount,
  recoveredOriginalCustomIds,
  referenceImageLimit,
  toJobRow,
  uniqueCustomId,
  unresolvedFailedRetryItems,
  visibleJobRows
} from '../model'

const key = { id: 7, name: 'Gemini 批量', status: 'active', group: { platform: 'gemini', allow_batch_image_generation: true } } as ApiKey
const job = { id: 'batch_root', task_name: '主任务', parent_batch_id: null, status: 'completed', model: 'gemini-3-pro-image', provider: 'vertex', item_count: 3, success_count: 1, fail_count: 2, estimated_cost: 0.3, hold_amount: 0.3, actual_cost: 0.1, created_at: 1 } as BatchImageJob

describe('batch image model', () => {
  it('restricts access keys and applies model-specific reference limits', () => {
    expect(keyAllowsBatchImage(key)).toBe(true)
    expect(referenceImageLimit('gemini-2.5-flash-image')).toBe(3)
    expect(referenceImageLimit('gemini-3-pro-image')).toBe(14)
  })

  it('normalizes output counts and stable unique custom ids', () => {
    expect(normalizeOutputCount(8)).toBe(4)
    expect(estimateOutputs([{ output_count: 4 }, { output_count: 2 }])).toBe(6)
    const used = new Set(['img_001'])
    expect(uniqueCustomId('img 001', used, 0)).toBe('img_001_2')
  })

  it('groups retry children and aggregates recovered outputs and costs', () => {
    const root = toJobRow(job, key)
    const child = toJobRow({ ...job, id: 'batch_retry', parent_batch_id: 'batch_root', item_count: 2, success_count: 2, fail_count: 0, actual_cost: 0.2 }, key)
    const rows = applyChildCounts([root, child])
    expect(rows[0]?.child_count).toBe(1)
    expect(visibleJobRows(rows, new Set(['batch_root']))[1]?.is_child).toBe(true)
    expect(aggregateJob(rows[0]!, rows)).toMatchObject({ success_count: 3, fail_count: 0, actual_cost: 0.3 })
  })

  it('builds failed-only retry items and maps backend errors with references', () => {
    expect(failedRetryItems([{ custom_id: 'a', status: 'failed', prompt_preview: '重试我', mime_type: null, file_extension: null, image_count: 0 }])).toHaveLength(1)
    expect(batchErrorMessage({ code: 'BATCH_IMAGE_TOO_MANY_OUTPUT_IMAGES', requestId: 'req-1' }, '失败')).toContain('200 张')
    expect(batchErrorMessage({ code: 'BATCH_IMAGE_TOO_MANY_OUTPUT_IMAGES', requestId: 'req-1' }, '失败')).toContain('req-1')
  })

  it('keeps unfinished outputs visible until a task reaches terminal state', () => {
    expect(batchPendingCount({ status: 'running', item_count: 4, success_count: 1, fail_count: 0 })).toBe(3)
    expect(batchPendingCount({ status: 'completed', item_count: 4, success_count: 4, fail_count: 0 })).toBe(0)
  })

  it('marks failures recovered by child retries and retries only unresolved prompts', () => {
    const items = [
      { batch_id: 'root', custom_id: 'a', status: 'failed', prompt_preview: 'A', mime_type: null, file_extension: null, image_count: 0 },
      { batch_id: 'root', custom_id: 'b', status: 'failed', prompt_preview: 'B', mime_type: null, file_extension: null, image_count: 0 },
      { batch_id: 'child', custom_id: 'a_retry_demo', status: 'succeeded', prompt_preview: 'A', mime_type: 'image/png', file_extension: 'png', image_count: 1 }
    ]
    expect(recoveredOriginalCustomIds(items, 'root')).toEqual(new Set(['a']))
    expect(unresolvedFailedRetryItems(items, 'root')).toEqual([expect.objectContaining({ prompt: 'B' })])
  })
})
