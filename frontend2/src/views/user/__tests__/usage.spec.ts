import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import zh from '@shared-i18n/locales/zh'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiKey, Group, PublicSettings, UsageLog, UserErrorRequest } from '@/types'
import { BillingModeFilter, ErrorColumnKey, UsageRequestFilter } from '@/features/user/usage/model'
import UsageView from '../UsageView.vue'

const storageValues = new Map<string, string>()
const localStorageMock: Storage = {
  get length() { return storageValues.size },
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(key) ?? null,
  key: (index) => Array.from(storageValues.keys())[index] ?? null,
  removeItem: (key) => { storageValues.delete(key) },
  setItem: (key, value) => { storageValues.set(key, String(value)) }
}

// Match the JIT flag used by the production Vite configuration.
vi.hoisted(() => { vi.stubGlobal('__INTLIFY_JIT_COMPILATION__', true) })

const api = vi.hoisted(() => ({
  query: vi.fn(),
  getStats: vi.fn(),
  getDashboardModels: vi.fn(),
  getDashboardSnapshotV2: vi.fn(),
  listMyErrorRequests: vi.fn(),
  getMyErrorDetail: vi.fn(),
  listKeys: vi.fn(),
  getAvailable: vi.fn(),
  getPublicSettings: vi.fn()
}))

vi.mock('@shared-api/usage', () => ({
  query: api.query,
  getStats: api.getStats,
  getDashboardModels: api.getDashboardModels,
  getDashboardSnapshotV2: api.getDashboardSnapshotV2,
  listMyErrorRequests: api.listMyErrorRequests,
  getMyErrorDetail: api.getMyErrorDetail
}))
vi.mock('@shared-api/keys', () => ({ list: api.listKeys }))
vi.mock('@shared-api/groups', () => ({ getAvailable: api.getAvailable }))
vi.mock('@shared-api/auth', () => ({ getPublicSettings: api.getPublicSettings }))

function group(): Group {
  return { id: 11, name: '企业组', platform: 'openai', status: 'active' } as Group
}

function log(): UsageLog {
  return {
    id: 81,
    user_id: 2,
    api_key_id: 7,
    account_id: null,
    request_id: 'req-81',
    model: 'gpt-5.5',
    group_id: 11,
    subscription_id: null,
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_tokens: 0,
    cache_read_tokens: 30,
    cache_creation_5m_tokens: 0,
    cache_creation_1h_tokens: 0,
    input_cost: 0.01,
    output_cost: 0.02,
    cache_creation_cost: 0,
    cache_read_cost: 0.001,
    total_cost: 0.031,
    actual_cost: 0.025,
    rate_multiplier: 0.8,
    long_context_billing_applied: false,
    billing_type: 0,
    request_type: 'sync',
    stream: false,
    duration_ms: 900,
    first_token_ms: 190,
    image_count: 0,
    image_size: null,
    image_input_size: null,
    image_output_size: null,
    image_size_source: null,
    image_size_breakdown: null,
    image_input_tokens: 0,
    image_input_cost: 0,
    image_output_tokens: 0,
    image_output_cost: 0,
    user_agent: 'Fixture',
    cache_ttl_overridden: false,
    billing_mode: 'token',
    created_at: '2026-08-18T00:00:00Z',
    api_key: { id: 7, name: '生产 Key' } as ApiKey,
    group: group()
  }
}

function errorRow(): UserErrorRequest {
  return {
    id: 91,
    created_at: '2026-08-18T00:00:00Z',
    model: 'gpt-5.5',
    inbound_endpoint: '/v1/responses',
    status_code: 429,
    category: 'rate_limit',
    platform: 'openai',
    message: 'rate limited',
    key_name: '生产 Key',
    key_deleted: false
  }
}

async function mountView() {
  const wrapper = mount(UsageView, {
    global: {
      plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh', messages: { zh } })],
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: { template: '<section><slot /></section>' },
        SurfaceDialog: true,
        ErrorDetailDialog: true
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('user usage workbench', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
    localStorage.clear()
    api.query.mockResolvedValue({ items: [log()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.getStats.mockResolvedValue({ total_requests: 1, total_input_tokens: 100, total_output_tokens: 20, total_cache_tokens: 30, total_cache_read_tokens: 30, total_cache_creation_tokens: 0, total_tokens: 150, total_cost: 0.031, total_actual_cost: 0.025, average_duration_ms: 900, endpoints: [] })
    api.getDashboardModels.mockResolvedValue({ models: [], start_date: '', end_date: '' })
    api.getDashboardSnapshotV2.mockResolvedValue({ generated_at: '', start_date: '', end_date: '', granularity: 'day', trend: [], groups: [] })
    api.listMyErrorRequests.mockResolvedValue({ items: [errorRow()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.listKeys.mockResolvedValue({ items: [{ id: 7, name: '生产 Key' } as ApiKey], total: 1, page: 1, page_size: 100, pages: 1 })
    api.getAvailable.mockResolvedValue([group()])
    api.getPublicSettings.mockResolvedValue({
      allow_user_view_error_requests: true,
      table_default_page_size: 20,
      table_page_size_options: [10, 20, 50]
    } as unknown as PublicSettings)
  })

  it('queries logs, statistics, models, and chart snapshot through shared APIs', async () => {
    const wrapper = await mountView()
    expect(api.query).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      page_size: 20,
      sort_by: 'created_at',
      sort_order: 'desc',
      timezone: expect.any(String)
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.getStats).toHaveBeenCalled()
    expect(api.getDashboardModels).toHaveBeenCalledWith(expect.objectContaining({ model_source: 'requested' }))
    expect(api.getDashboardSnapshotV2).toHaveBeenCalledWith(expect.objectContaining({ include_trend: true, include_group_stats: true }))

    const requestType = wrapper.findAll('.filter-panel select')[2]
    await requestType.setValue(UsageRequestFilter.STREAM)
    await flushPromises()
    expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ request_type: 'stream', stream: true }), expect.anything())

    const billingMode = wrapper.findAll('.filter-panel select')[4]
    await billingMode.setValue(BillingModeFilter.IMAGE)
    await flushPromises()
    expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ billing_mode: 'image' }), expect.anything())
    wrapper.unmount()
  })

  it('loads permission-gated errors with server filters and sorting', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.log-tabs button')[1].trigger('click')
    await flushPromises()
    expect(api.listMyErrorRequests).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      page_size: 20,
      sort_by: 'created_at',
      sort_order: 'desc'
    }))

    const statusSelect = wrapper.findAll('.error-filter-panel select')[2]
    await statusSelect.setValue('429')
    await flushPromises()
    expect(api.listMyErrorRequests).toHaveBeenLastCalledWith(expect.objectContaining({ status_code: 429 }))

    const statusHeader = wrapper.findAll('.error-table th button').find((button) => button.text().startsWith('状态码'))
    await statusHeader!.trigger('click')
    await flushPromises()
    expect(api.listMyErrorRequests).toHaveBeenLastCalledWith(expect.objectContaining({ sort_by: 'status_code', sort_order: 'asc' }))
    wrapper.unmount()
  })

  it('persists independent error-column preferences', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.log-tabs button')[1].trigger('click')
    await flushPromises()
    await wrapper.find('.error-filter-panel .column-picker > button').trigger('click')
    const messageColumn = wrapper.findAll('.column-picker > div label').find((label) => label.text() === '错误消息')
    await messageColumn!.find('input').setValue(false)
    expect(JSON.parse(localStorage.getItem('frontend2-usage-error-hidden-columns-v1') || '[]')).toContain(ErrorColumnKey.MESSAGE)
    wrapper.unmount()
  })
})
