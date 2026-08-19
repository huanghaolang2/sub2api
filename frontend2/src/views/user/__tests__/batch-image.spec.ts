import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchImageJob, BatchImageItem } from '@shared-api/batchImage'
import type { ApiKey, Group, PublicSettings } from '@/types'
import BatchImageCreateDialog from '@/components/user/batch-image/BatchImageCreateDialog.vue'
import BatchImageDetailDialog from '@/components/user/batch-image/BatchImageDetailDialog.vue'
import { toJobRow } from '@/features/user/batch-image/model'
import { useConfirmStore } from '@/stores/confirm'
import BatchImageView from '../BatchImageView.vue'

const api = vi.hoisted(() => ({
  listKeys: vi.fn(), getPublicSettings: vi.fn(), listJobs: vi.fn(), listModels: vi.fn(),
  submit: vi.fn(), getJob: vi.fn(), listItems: vi.fn(), cancel: vi.fn(), download: vi.fn(),
  getContent: vi.fn(), deleteJob: vi.fn(), saveBlob: vi.fn()
}))

vi.mock('@shared-api/keys', () => ({ list: api.listKeys }))
vi.mock('@shared-api/auth', () => ({ getPublicSettings: api.getPublicSettings }))
vi.mock('@shared-api/batchImage', () => ({
  listBatchImageJobs: api.listJobs,
  listBatchImageModels: api.listModels,
  submitBatchImageJob: api.submit,
  getBatchImageJob: api.getJob,
  listBatchImageItems: api.listItems,
  cancelBatchImageJob: api.cancel,
  downloadBatchImageZip: api.download,
  getBatchImageItemContent: api.getContent,
  deleteBatchImageJobRecord: api.deleteJob,
  saveBlob: api.saveBlob
}))

const geminiGroup = { id: 202, name: 'Gemini 图片', platform: 'gemini', status: 'active', allow_batch_image_generation: true } as Group
const openaiGroup = { id: 101, name: 'OpenAI', platform: 'openai', status: 'active' } as Group
const allowedKey = { id: 702, key: 'sk-gemini-a', name: 'Gemini A', status: 'active', group_id: 202, group: geminiGroup } as ApiKey
const secondKey = { id: 703, key: 'sk-gemini-b', name: 'Gemini B', status: 'active', group_id: 202, group: geminiGroup } as ApiKey
const disallowedKey = { id: 701, key: 'sk-openai', name: 'OpenAI Key', status: 'active', group_id: 101, group: openaiGroup } as ApiKey

function job(overrides: Partial<BatchImageJob> = {}): BatchImageJob {
  return {
    id: 'batch-root', object: 'batch.image', task_name: '夜景系列', parent_batch_id: null,
    status: 'completed', model: 'gemini-3-pro-image', provider: 'vertex', item_count: 3,
    success_count: 1, fail_count: 2, estimated_cost: 0.15, hold_amount: 0.15,
    actual_cost: 0.05, created_at: 1_776_000_000, submitted_at: 1_776_000_001,
    settled_at: 1_776_000_100, downloaded_at: null, ...overrides
  }
}

function failedItem(): BatchImageItem {
  return { custom_id: 'night_02', status: 'failed', prompt_preview: '霓虹雨夜街道', mime_type: null, file_extension: null, image_count: 0, error: { code: 'PROVIDER_ERROR', message: 'capacity' } }
}

const surfaceStub = { template: '<section><slot /><footer><slot name="footer" /></footer></section>' }

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/app/batch-image', component: BatchImageView }, { path: '/app/keys', component: { template: '<div />' } }]
  })
  await router.push('/app/batch-image')
  await router.isReady()
  const wrapper = mount(BatchImageView, {
    global: {
      plugins: [createPinia(), router],
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        BatchImageCreateDialog: true,
        BatchImageDetailDialog: true,
        BatchImageGuideDialog: true
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('batch image workbench', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listKeys.mockResolvedValue({ items: [disallowedKey, allowedKey, secondKey], total: 3, page: 1, page_size: 100, pages: 1 })
    api.getPublicSettings.mockResolvedValue({ api_base_url: 'https://api.example.test', table_default_page_size: 20 } as unknown as PublicSettings)
    api.listJobs.mockImplementation(async (key: string) => key === allowedKey.key
      ? { object: 'list', data: [job(), job({ id: 'batch-child', task_name: '夜景系列 · 重试', parent_batch_id: 'batch-root', item_count: 1, success_count: 1, fail_count: 0, estimated_cost: 0.05, hold_amount: 0.05, actual_cost: 0.05 })], has_more: false }
      : { object: 'list', data: [job({ id: 'batch-b', task_name: '产品图', success_count: 3, fail_count: 0 })], has_more: false })
    api.listModels.mockResolvedValue({ object: 'list', data: [{ id: 'gemini-3-pro-image', object: 'model', provider: 'vertex' }] })
    api.listItems.mockResolvedValue({ object: 'list', data: [failedItem()], has_more: false })
    api.submit.mockResolvedValue(job({ id: 'batch-retry-new', task_name: '夜景系列 · 失败项重试', parent_batch_id: 'batch-root', status: 'queued', item_count: 1, success_count: 0, fail_count: 0, actual_cost: null }))
    api.getJob.mockResolvedValue(job())
    api.cancel.mockResolvedValue(job({ status: 'cancelled' }))
    api.download.mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }))
    api.getContent.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    api.deleteJob.mockResolvedValue(undefined)
  })

  it('loads only authorized Gemini keys and keeps cross-key query options', async () => {
    const wrapper = await mountView()
    expect(api.listJobs).toHaveBeenCalledTimes(2)
    expect(api.listJobs).not.toHaveBeenCalledWith(disallowedKey.key, expect.anything())
    expect(api.listJobs).toHaveBeenCalledWith(allowedKey.key, expect.objectContaining({ limit: 20, cursor: '0' }))
    expect(wrapper.text()).toContain('夜景系列')
    expect(wrapper.text()).toContain('产品图')
    expect(wrapper.text()).toContain('1 次重试')
    expect(wrapper.text()).not.toContain('夜景系列 · 重试')

    await wrapper.find('.expand-button').trigger('click')
    expect(wrapper.text()).toContain('夜景系列 · 重试')

    await wrapper.findAll('.batch-toolbar select')[1]!.setValue('completed')
    await flushPromises()
    expect(api.listJobs).toHaveBeenLastCalledWith(secondKey.key, expect.objectContaining({ status: 'completed' }))
    wrapper.unmount()
  })

  it('downloads selected terminal jobs and retries only failed prompts as a child', async () => {
    const wrapper = await mountView()
    const rowCheckboxes = wrapper.findAll('tbody .check-cell input')
    await rowCheckboxes[0]!.setValue(true)
    await wrapper.find('.bulk-bar button').trigger('click')
    await flushPromises()
    expect(api.download).toHaveBeenCalledWith(allowedKey.key, 'batch-root')
    expect(api.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'batch-root.zip')

    const retryButton = wrapper.findAll('.actions-cell button').find((button) => button.text() === '重试失败项')
    await retryButton!.trigger('click')
    await flushPromises()
    expect(api.listItems).toHaveBeenCalledWith(allowedKey.key, 'batch-root')
    expect(api.submit).toHaveBeenCalledWith(allowedKey.key, expect.objectContaining({
      parent_batch_id: 'batch-root',
      items: [expect.objectContaining({ prompt: '霓虹雨夜街道' })]
    }), expect.stringContaining('sub2api-ui-retry-batch-root-'))
    wrapper.unmount()
  })

  it('submits the complete create contract with model, output count, format, and idempotency', async () => {
    const pinia = createPinia()
    const wrapper = mount(BatchImageCreateDialog, {
      props: { show: true, apiKeys: [allowedKey], endpointBase: 'https://api.example.test' },
      global: { plugins: [pinia], stubs: { SurfaceDialog: surfaceStub } }
    })
    await flushPromises()
    expect(api.listModels).toHaveBeenCalledWith(allowedKey.key)
    await wrapper.find('textarea').setValue('电影感山谷晨雾')
    await wrapper.find('input[placeholder^="custom_id"]').setValue('scene_001')
    await wrapper.find('select[aria-label="每条 Prompt 输出数量"]').setValue('3')
    await wrapper.find('.prompt-controls > button').trigger('click')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.submit).toHaveBeenCalledWith(allowedKey.key, expect.objectContaining({
      model: 'gemini-3-pro-image',
      image_size: '1K',
      response_mime_type: 'image/png',
      items: [{ custom_id: 'scene_001', prompt: '电影感山谷晨雾', output_count: 3, reference_images: [] }]
    }), expect.stringContaining('sub2api-ui-'))
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })

  it('loads detail items and requires confirmation before cancelling a running job', async () => {
    const pinia = createPinia()
    const running = job({ id: 'batch-running', task_name: '运行任务', status: 'running', actual_cost: null, success_count: 0, fail_count: 0 })
    api.getJob.mockResolvedValue(running)
    api.listItems.mockResolvedValue({ object: 'list', data: [{ ...failedItem(), status: 'pending', error: null }], has_more: false })
    const wrapper = mount(BatchImageDetailDialog, {
      props: { show: true, job: toJobRow(running, allowedKey), allJobs: [toJobRow(running, allowedKey)], apiKey: allowedKey },
      global: { plugins: [pinia], stubs: { SurfaceDialog: surfaceStub, Teleport: true } }
    })
    await flushPromises()
    expect(api.getJob).toHaveBeenCalledWith(allowedKey.key, 'batch-running')
    expect(api.listItems).toHaveBeenCalledWith(allowedKey.key, 'batch-running')
    expect(wrapper.text()).toContain('等待处理')

    const cancelButton = wrapper.findAll('footer button').find((button) => button.text() === '取消任务')
    void cancelButton!.trigger('click')
    await flushPromises()
    expect(api.cancel).not.toHaveBeenCalled()
    useConfirmStore(pinia).confirm()
    await flushPromises()
    expect(api.cancel).toHaveBeenCalledWith(allowedKey.key, 'batch-running')
    wrapper.unmount()
  })
})
