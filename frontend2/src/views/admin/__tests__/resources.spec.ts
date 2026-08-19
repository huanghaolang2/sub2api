import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, AdminGroup, Proxy } from '@/types'
import type { Channel } from '@shared-api/admin/channels'
import type { ChannelMonitor } from '@shared-api/admin/channelMonitor'
import type { ChannelMonitorTemplate } from '@shared-api/admin/channelMonitorTemplate'
import GroupsView from '../GroupsView.vue'
import ChannelsView from '../ChannelsView.vue'
import ChannelMonitorView from '../ChannelMonitorView.vue'
import AccountsView from '../AccountsView.vue'
import ProxiesView from '../ProxiesView.vue'

const api = vi.hoisted(() => ({
  groupsList: vi.fn(), groupsAll: vi.fn(), groupsUsage: vi.fn(), groupsCapacity: vi.fn(), groupGet: vi.fn(),
  channelsList: vi.fn(), channelGet: vi.fn(),
  monitorsList: vi.fn(), monitorGet: vi.fn(), monitorDuplicate: vi.fn(),
  templatesList: vi.fn(), templateGet: vi.fn(),
  accountsListWithEtag: vi.fn(), accountsList: vi.fn(), accountGet: vi.fn(), accountUsage: vi.fn(), accountToday: vi.fn(),
  proxiesList: vi.fn(), proxiesAll: vi.fn(), proxyGet: vi.fn()
}))

vi.mock('@shared-api/admin/groups', () => ({
  list: api.groupsList,
  getAllIncludingInactive: api.groupsAll,
  getUsageSummary: api.groupsUsage,
  getCapacitySummary: api.groupsCapacity,
  getById: api.groupGet,
  create: vi.fn(), update: vi.fn(), duplicate: vi.fn(), toggleStatus: vi.fn(), deleteGroup: vi.fn()
}))
vi.mock('@shared-api/admin/channels', () => ({
  list: api.channelsList,
  getById: api.channelGet,
  create: vi.fn(), update: vi.fn(), remove: vi.fn(), syncPricingModels: vi.fn(), getModelDefaultPricing: vi.fn()
}))
vi.mock('@shared-api/admin/channelMonitor', () => ({
  list: api.monitorsList,
  get: api.monitorGet,
  duplicate: api.monitorDuplicate,
  create: vi.fn(), update: vi.fn(), del: vi.fn(), runNow: vi.fn(), listHistory: vi.fn()
}))
vi.mock('@shared-api/admin/channelMonitorTemplate', () => ({
  list: api.templatesList,
  get: api.templateGet,
  create: vi.fn(), update: vi.fn(), del: vi.fn(), apply: vi.fn(), listAssociatedMonitors: vi.fn()
}))
vi.mock('@shared-api/admin/accounts', () => ({
  listWithEtag: api.accountsListWithEtag,
  list: api.accountsList,
  getById: api.accountGet,
  getBatchUsage: api.accountUsage,
  getBatchTodayStats: api.accountToday,
  create: vi.fn(), update: vi.fn(), checkMixedChannelRisk: vi.fn(), toggleStatus: vi.fn(), setSchedulable: vi.fn(), duplicate: vi.fn(), deleteAccount: vi.fn(),
  batchClearError: vi.fn(), batchDelete: vi.fn(), batchRefresh: vi.fn(), batchUpdateCredentials: vi.fn(), bulkUpdate: vi.fn(), probeUpstreamBillingBatch: vi.fn(), exportData: vi.fn()
}))
vi.mock('@shared-api/admin/proxies', () => ({
  list: api.proxiesList,
  getAllWithCount: api.proxiesAll,
  getById: api.proxyGet,
  create: vi.fn(), update: vi.fn(), toggleStatus: vi.fn(), deleteProxy: vi.fn(), batchCreate: vi.fn(), batchDelete: vi.fn(), exportData: vi.fn(), importData: vi.fn()
}))
vi.mock('@/api', () => ({ totpAPI: { stepUp: vi.fn() } }))

const storage = new Map<string, string>()
const localStorageMock: Storage = {
  get length() { return storage.size },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key) => { storage.delete(key) },
  setItem: (key, value) => { storage.set(key, String(value)) }
}

function group(overrides: Partial<AdminGroup> = {}): AdminGroup {
  return {
    id: 5, name: '生产组', description: '主调度组', platform: 'openai', status: 'active', subscription_type: 'standard', is_exclusive: false,
    rate_multiplier: 1, rpm_limit: 120, model_pricing: [], sort_order: 1, account_count: 2, active_account_count: 2, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-18T00:00:00Z',
    ...overrides
  } as unknown as AdminGroup
}

function channel(): Channel {
  return {
    id: 6, name: '默认渠道', description: '生产价格', status: 'active', billing_model_source: 'channel_mapped', restrict_models: true,
    group_ids: [5], model_pricing: [], model_mapping: {}, apply_pricing_to_account_stats: false, account_stats_pricing_rules: [], features_config: {}, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-18T00:00:00Z'
  }
}

function monitor(): ChannelMonitor {
  return {
    id: 7, name: '生产监控', provider: 'openai', api_mode: 'responses', endpoint: 'https://api.example.test/v1', api_key_masked: 'sk-***', primary_model: 'gpt-5.5', extra_models: [], group_name: '生产', enabled: true,
    interval_seconds: 60, jitter_seconds: 5, last_checked_at: '2026-08-18T00:00:00Z', created_by: 1, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-18T00:00:00Z', primary_status: 'operational', primary_latency_ms: 120, availability_7d: 99.9,
    extra_models_status: [], template_id: null, extra_headers: {}, body_override_mode: 'off', body_override: null
  }
}

function template(): ChannelMonitorTemplate {
  return { id: 8, name: 'Responses 模板', provider: 'openai', api_mode: 'responses', description: '', extra_headers: {}, body_override_mode: 'off', body_override: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-18T00:00:00Z', associated_monitors: 1 }
}

function account(): Account {
  return {
    id: 9, name: 'Codex 账号', platform: 'openai', type: 'oauth', status: 'active', schedulable: true, credentials: {}, extra: {}, proxy_id: null, group_ids: [5], groups: [group()], concurrency: 4, current_concurrency: 1,
    priority: 1, rate_multiplier: 1, notes: '', expires_at: null, auto_pause_on_expired: true, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-18T00:00:00Z'
  } as unknown as Account
}

function proxy(): Proxy {
  return { id: 10, name: '东京出口', protocol: 'https', host: 'proxy.example.test', port: 443, username: null, status: 'active', account_count: 2, expires_at: null, fallback_mode: 'direct', expiry_warn_days: 7, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-18T00:00:00Z' }
}

const commonStubs = {
  ConsoleShell: { template: '<main><slot /></main>' },
  PageState: { template: '<section><slot /></section>' },
  GroupEditorDialog: true, GroupSortDialog: true, GroupDetailDialog: true, GroupCompositeRoutesDialog: true, GroupUserOverridesDialog: true,
  ChannelEditorDialog: true,
  ChannelMonitorEditorDialog: true, ChannelMonitorActivityDialog: true, MonitorTemplateDialog: true, MonitorTemplateApplyDialog: true,
  AccountEditorDialog: true, AccountOAuthDialog: true, AccountWorkspaceDialog: true, AccountBulkDialog: true, AccountToolsDialog: true, AccountRuntimeCatalogDialog: true, TotpStepUpDialog: true,
  ProxyEditorDialog: true, ProxyDetailDialog: true, ProxyBatchDialog: true
}

async function mountView(component: Parameters<typeof mount>[0]) {
  const wrapper = mount(component, { global: { plugins: [createPinia()], stubs: commonStubs } })
  await flushPromises()
  return wrapper
}

describe('admin resource management views', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
    api.groupsList.mockResolvedValue({ items: [group()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.groupsAll.mockResolvedValue([group()])
    api.groupsUsage.mockResolvedValue([{ group_id: 5, today_cost: 2, yesterday_cost: 1, total_cost: 20 }])
    api.groupsCapacity.mockResolvedValue([{ group_id: 5, concurrency_used: 1, concurrency_max: 4, sessions_used: 1, sessions_max: 4, rpm_used: 20, rpm_max: 120 }])
    api.groupGet.mockResolvedValue(group())
    api.channelsList.mockImplementation((page: number, pageSize: number) => Promise.resolve({ items: [channel()], total: 1, page, page_size: pageSize }))
    api.channelGet.mockResolvedValue(channel())
    api.monitorsList.mockResolvedValue({ items: [monitor()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.monitorGet.mockResolvedValue(monitor())
    api.monitorDuplicate.mockResolvedValue(monitor())
    api.templatesList.mockResolvedValue({ items: [template()] })
    api.templateGet.mockResolvedValue(template())
    api.accountsListWithEtag.mockResolvedValue({ etag: 'fixture-etag', notModified: false, data: { items: [account()], total: 1, page: 1, page_size: 20, pages: 1 } })
    api.accountsList.mockResolvedValue({ items: [account()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.accountGet.mockResolvedValue(account())
    api.accountUsage.mockResolvedValue({ usage: {}, errors: {} })
    api.accountToday.mockResolvedValue({ stats: {} })
    api.proxiesList.mockResolvedValue({ items: [proxy()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.proxiesAll.mockResolvedValue([proxy()])
    api.proxyGet.mockResolvedValue(proxy())
  })

  it('uses server filters and fetches the full group detail before editing', async () => {
    const wrapper = await mountView(GroupsView)
    expect(api.groupsList).toHaveBeenCalledWith(1, 20, expect.objectContaining({ sort_by: 'sort_order', sort_order: 'asc' }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.groupsUsage).toHaveBeenCalled()
    await wrapper.find('.resource-toolbar__filters select').setValue('openai')
    await flushPromises()
    expect(api.groupsList).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ platform: 'openai' }), expect.anything())
    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    expect(api.groupGet).toHaveBeenCalledWith(5)
    wrapper.unmount()
  })

  it('renders nullable pricing, yesterday usage, and authorization type without breaking the list', async () => {
    const runtimeGroup = group({ model_pricing: null as unknown as AdminGroup['model_pricing'] })
    api.groupsList.mockResolvedValue({ items: [runtimeGroup], total: 1, page: 1, page_size: 20, pages: 1 })

    const wrapper = await mountView(GroupsView)

    expect(wrapper.text()).toContain('0 组模型价格')
    expect(wrapper.text()).toContain('$1.00 昨日')
    expect(wrapper.text()).toContain('公共')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    wrapper.unmount()
  })

  it('exposes named filters and keyboard-operable sort actions', async () => {
    const wrapper = await mountView(GroupsView)

    expect(wrapper.find('[aria-label="平台筛选"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="状态筛选"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="授权类型筛选"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="每页条数"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="停用 生产组"]').exists()).toBe(true)

    await wrapper.get('button[aria-label="按更新时间排序"]').trigger('click')
    await flushPromises()
    expect(api.groupsList).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ sort_by: 'updated_at', sort_order: 'asc' }),
      expect.anything()
    )
    wrapper.unmount()
  })

  it('loads channel references and fetches the full channel contract before editing', async () => {
    const wrapper = await mountView(ChannelsView)
    expect(api.channelsList).toHaveBeenCalledWith(1, 20, expect.objectContaining({ sort_by: 'created_at', sort_order: 'desc' }), expect.anything())
    expect(api.groupsAll).toHaveBeenCalled()
    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    expect(api.channelGet).toHaveBeenCalledWith(6)
    wrapper.unmount()
  })

  it('loads monitor and template workspaces and duplicates a monitor server-side', async () => {
    const wrapper = await mountView(ChannelMonitorView)
    expect(api.monitorsList).toHaveBeenCalledWith(expect.objectContaining({ page: 1, page_size: 20 }), expect.anything())
    expect(api.templatesList).toHaveBeenCalled()
    await wrapper.findAll('button').find((button) => button.text() === '复制')!.trigger('click')
    await flushPromises()
    expect(api.monitorDuplicate).toHaveBeenCalledWith(7)
    wrapper.unmount()
  })

  it('uses ETag account queries, batch usage, and full-detail editing', async () => {
    const wrapper = await mountView(AccountsView)
    expect(api.accountsListWithEtag).toHaveBeenCalledWith(1, 20, expect.objectContaining({ sort_by: 'created_at', sort_order: 'desc' }), expect.objectContaining({ etag: null, signal: expect.any(AbortSignal) }))
    expect(api.accountUsage).toHaveBeenCalledWith([9], false)
    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    expect(api.accountGet).toHaveBeenCalledWith(9)
    wrapper.unmount()
  })

  it('uses server-side proxy filters and full-detail editing', async () => {
    const wrapper = await mountView(ProxiesView)
    expect(api.proxiesList).toHaveBeenCalledWith(1, 20, expect.objectContaining({ sort_by: 'created_at', sort_order: 'desc' }), expect.anything())
    await wrapper.findAll('.resource-toolbar__filters select')[0].setValue('https')
    await flushPromises()
    expect(api.proxiesList).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ protocol: 'https' }), expect.anything())
    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    expect(api.proxyGet).toHaveBeenCalledWith(10)
    wrapper.unmount()
  })
})
