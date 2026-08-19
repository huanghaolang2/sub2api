import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiKey, Group, PublicSettings } from '@/types'
import KeyEditorDialog from '@/components/user/keys/KeyEditorDialog.vue'
import { KeyColumnKey, KeyEditorMode, KeyStatusFilter } from '@/features/user/keys/model'
import KeysView from '../KeysView.vue'

const storage = new Map<string, string>()
const localStorageMock: Storage = {
  get length() { return storage.size },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key) => { storage.delete(key) },
  setItem: (key, value) => { storage.set(key, String(value)) }
}

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteKey: vi.fn(),
  toggleStatus: vi.fn(),
  getAvailable: vi.fn(),
  getUserGroupRates: vi.fn(),
  getPublicSettings: vi.fn(),
  getDashboardApiKeysUsage: vi.fn()
}))

vi.mock('@shared-api/keys', () => ({
  list: api.list,
  create: api.create,
  update: api.update,
  deleteKey: api.deleteKey,
  toggleStatus: api.toggleStatus
}))
vi.mock('@shared-api/groups', () => ({ getAvailable: api.getAvailable, getUserGroupRates: api.getUserGroupRates }))
vi.mock('@shared-api/auth', () => ({ getPublicSettings: api.getPublicSettings }))
vi.mock('@shared-api/usage', () => ({ getDashboardApiKeysUsage: api.getDashboardApiKeysUsage }))

function group(): Group {
  return {
    id: 11,
    name: 'OpenAI 企业组',
    description: '低延迟企业池',
    platform: 'openai',
    rate_multiplier: 1,
    is_exclusive: true,
    status: 'active',
    subscription_type: 'standard',
    peak_rate_enabled: false,
    peak_start: '00:00',
    peak_end: '00:00',
    peak_rate_multiplier: 1,
    allow_messages_dispatch: true
  } as Group
}

function apiKey(): ApiKey {
  return {
    id: 701,
    user_id: 2,
    key: 'sk-fixture-1234567890abcdefghijklmnop',
    name: '生产 Key',
    group_id: 11,
    group: group(),
    status: 'active',
    ip_whitelist: [],
    ip_blacklist: [],
    last_used_at: '2026-08-18T10:43:00Z',
    last_used_ip: '127.0.0.1',
    quota: 100,
    quota_used: 12.5,
    expires_at: null,
    created_at: '2026-07-11T09:10:00Z',
    updated_at: '2026-08-18T10:43:00Z',
    current_concurrency: 1,
    rate_limit_5h: 5,
    rate_limit_1d: 10,
    rate_limit_7d: 30,
    usage_5h: 1,
    usage_1d: 2,
    usage_7d: 3,
    window_5h_start: null,
    window_1d_start: null,
    window_7d_start: null,
    reset_5h_at: '2026-08-18T15:00:00Z',
    reset_1d_at: '2026-08-19T00:00:00Z',
    reset_7d_at: '2026-08-25T00:00:00Z'
  }
}

function settings(): PublicSettings {
  return {
    table_default_page_size: 20,
    table_page_size_options: [10, 20, 50],
    api_base_url: 'https://api.example.test',
    site_name: 'Sub2API',
    custom_endpoints: [],
    hide_ccs_import_button: false
  } as unknown as PublicSettings
}

async function mountView() {
  const wrapper = mount(KeysView, {
    global: {
      plugins: [createPinia()],
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: { template: '<section><slot /><slot name="empty-action" /></section>' },
        SurfaceDialog: true,
        KeyEditorDialog: true,
        KeyUseDialog: true
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('user API Key workbench', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    storage.clear()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    api.list.mockResolvedValue({ items: [apiKey()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.getAvailable.mockResolvedValue([group()])
    api.getUserGroupRates.mockResolvedValue({ 11: 0.82 })
    api.getPublicSettings.mockResolvedValue(settings())
    api.getDashboardApiKeysUsage.mockResolvedValue({ stats: { 701: { api_key_id: 701, today_actual_cost: 1.2, total_actual_cost: 18.3 } } })
    api.update.mockResolvedValue(apiKey())
    api.toggleStatus.mockResolvedValue({ ...apiKey(), status: 'inactive' })
    api.create.mockResolvedValue(apiKey())
  })

  afterEach(() => vi.useRealTimers())

  it('uses shared server filters, sorting, pagination, and batch usage contracts', async () => {
    const wrapper = await mountView()
    expect(api.list).toHaveBeenCalledWith(1, 20, expect.objectContaining({
      sort_by: KeyColumnKey.CREATED_AT,
      sort_order: 'desc'
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.getDashboardApiKeysUsage).toHaveBeenCalledWith([701], expect.objectContaining({ signal: expect.any(AbortSignal) }))

    const statusSelect = wrapper.findAll('.key-toolbar select')[0]
    await statusSelect.setValue(KeyStatusFilter.INACTIVE)
    await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ status: KeyStatusFilter.INACTIVE }), expect.anything())

    const search = wrapper.find<HTMLInputElement>('.search-field input')
    await search.setValue('production')
    await vi.advanceTimersByTimeAsync(321)
    await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ search: 'production' }), expect.anything())
    wrapper.unmount()
  })

  it('persists optional columns and changes a row group through the shared update API', async () => {
    const wrapper = await mountView()
    const columnButton = wrapper.findAll('button').find((button) => button.text().startsWith('显示字段'))
    expect(columnButton).toBeDefined()
    await columnButton!.trigger('click')
    const keyColumn = wrapper.findAll('.column-menu label').find((label) => label.text() === 'API Key')
    expect(keyColumn).toBeDefined()
    await keyColumn!.find('input').setValue(false)
    expect(JSON.parse(localStorage.getItem('frontend2-api-key-hidden-columns-v1') || '[]')).toContain(KeyColumnKey.KEY)

    await wrapper.find('.group-cell select').setValue('11')
    expect(api.update).not.toHaveBeenCalled()
    api.getAvailable.mockResolvedValue([{ ...group(), id: 12, name: '备用组' }])
    wrapper.unmount()

    const secondWrapper = await mountView()
    const select = secondWrapper.find('.group-cell select')
    await select.setValue('12')
    await flushPromises()
    expect(api.update).toHaveBeenCalledWith(701, { group_id: 12 })
    secondWrapper.unmount()
  })

  it('submits the complete create contract from the editor', async () => {
    const wrapper = mount(KeyEditorDialog, {
      props: { show: true, mode: KeyEditorMode.CREATE, apiKey: null, groups: [group()], userGroupRates: { 11: 0.82 } },
      global: {
        plugins: [createPinia()],
        stubs: { SurfaceDialog: { template: '<section><slot /><slot name="footer" /></section>' } }
      }
    })
    await flushPromises()
    const fields = wrapper.findAll('.field')
    await fields.find((field) => field.text().includes('Key 名称'))!.find('input').setValue('自动化生产 Key')
    await fields.find((field) => field.text().includes('访问分组'))!.find('select').setValue('11')
    const form = wrapper.find('#key-editor-form')
    await form.trigger('submit')
    await flushPromises()
    expect(api.create).toHaveBeenCalledWith('自动化生产 Key', 11, undefined, [], [], 0, undefined, {
      rate_limit_5h: 0,
      rate_limit_1d: 0,
      rate_limit_7d: 0
    })
    expect(wrapper.emitted('saved')?.[0]?.[1]).toBe(KeyEditorMode.CREATE)
    wrapper.unmount()
  })
})
