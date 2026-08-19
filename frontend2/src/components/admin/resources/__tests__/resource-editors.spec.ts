import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminGroup } from '@/types'
import AccountToolsDialog from '@/components/admin/accounts/AccountToolsDialog.vue'
import GroupCompositeRoutesDialog from '@/components/admin/groups/GroupCompositeRoutesDialog.vue'
import GroupEditorDialog from '@/components/admin/groups/GroupEditorDialog.vue'
import GroupUserOverridesDialog from '@/components/admin/groups/GroupUserOverridesDialog.vue'
import ChannelMonitorEditorDialog from '@/components/admin/monitor/ChannelMonitorEditorDialog.vue'
import ChannelPricingEditor from '../ChannelPricingEditor.vue'
import { BillingModeOption, GroupOverrideMode, emptyPricingDraft } from '@/features/admin/resources/model'

const api = vi.hoisted(() => ({
  syncPricingModels: vi.fn(),
  getModelDefaultPricing: vi.fn(),
  getModelsListCandidates: vi.fn(),
  getLiveCapability: vi.fn(),
  getAntigravityDefaultModelMapping: vi.fn(),
  refreshOpenAIToken: vi.fn(),
  refreshAntigravityToken: vi.fn(),
  refreshGrokToken: vi.fn(),
  authorizeGrokPassword: vi.fn(),
  createAccount: vi.fn(),
  getGroupRateMultipliers: vi.fn(),
  getGroupRPMOverrides: vi.fn(),
  batchSetGroupRateMultipliers: vi.fn(),
  batchSetGroupRPMOverrides: vi.fn(),
  clearGroupRateMultipliers: vi.fn(),
  clearGroupRPMOverrides: vi.fn(),
  listCompositeRoutes: vi.fn(),
  listUsers: vi.fn()
}))

vi.mock('@shared-api/admin/channels', () => ({
  syncPricingModels: api.syncPricingModels,
  getModelDefaultPricing: api.getModelDefaultPricing
}))
vi.mock('@shared-api/admin/groups', () => ({
  getModelsListCandidates: api.getModelsListCandidates,
  getLiveCapability: api.getLiveCapability,
  getGroupRateMultipliers: api.getGroupRateMultipliers,
  getGroupRPMOverrides: api.getGroupRPMOverrides,
  batchSetGroupRateMultipliers: api.batchSetGroupRateMultipliers,
  batchSetGroupRPMOverrides: api.batchSetGroupRPMOverrides,
  clearGroupRateMultipliers: api.clearGroupRateMultipliers,
  clearGroupRPMOverrides: api.clearGroupRPMOverrides,
  listCompositeRoutes: api.listCompositeRoutes,
  createCompositeRoute: vi.fn(),
  updateCompositeRoute: vi.fn(),
  deleteCompositeRoute: vi.fn(),
  previewCompositeRoute: vi.fn()
}))
vi.mock('@shared-api/admin/users', () => ({ list: api.listUsers }))
vi.mock('@shared-api/admin/accounts', () => ({
  getAntigravityDefaultModelMapping: api.getAntigravityDefaultModelMapping,
  refreshOpenAIToken: api.refreshOpenAIToken,
  create: api.createAccount,
  syncUpstreamModelsPreview: vi.fn(),
  importData: vi.fn(),
  previewFromCrs: vi.fn(),
  syncFromCrs: vi.fn(),
  importCodexSession: vi.fn(),
  createOpenAICodexPAT: vi.fn(),
  batchCreate: vi.fn()
}))
vi.mock('@shared-api/admin/antigravity', () => ({ refreshAntigravityToken: api.refreshAntigravityToken }))
vi.mock('@shared-api/admin/grok', () => ({ createFromSSO: vi.fn(), refreshGrokToken: api.refreshGrokToken, authorizePassword: api.authorizeGrokPassword }))

const surfaceStub = {
  props: ['show', 'title'],
  template: '<section v-if="show"><h2>{{ title }}</h2><slot /><slot name="footer" /></section>'
}

function group(): AdminGroup {
  return {
    id: 5,
    name: '生产组',
    platform: 'openai',
    status: 'active',
    subscription_type: 'standard',
    is_exclusive: false,
    rate_multiplier: 1,
    rpm_limit: 0,
    model_pricing: [],
    sort_order: 0
  } as unknown as AdminGroup
}

describe('admin resource editors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.syncPricingModels.mockResolvedValue({ models: ['gpt-5.5', 'gpt-5.6-sol'] })
    api.getModelDefaultPricing.mockResolvedValue({ found: true, input_price: 0.0000015, output_price: 0.000012, image_input_price: 0.000003 })
    api.getModelsListCandidates.mockResolvedValue(['gpt-5.5', 'gpt-5.6-sol'])
    api.getLiveCapability.mockResolvedValue({ supported: true })
    api.getAntigravityDefaultModelMapping.mockResolvedValue({ 'claude-*': 'gemini-2.5-pro' })
    api.refreshOpenAIToken.mockResolvedValue({ access_token: 'openai-access', refresh_token: 'openai-refresh', email: 'openai@example.test' })
    api.refreshAntigravityToken.mockResolvedValue({ access_token: 'ag-access', refresh_token: 'ag-refresh', email: 'ag@example.test' })
    api.refreshGrokToken.mockResolvedValue({ access_token: 'grok-access', refresh_token: 'grok-refresh', email: 'grok@example.test' })
    api.authorizeGrokPassword.mockResolvedValue({ access_token: 'grok-password-access', refresh_token: 'grok-password-refresh', email: 'person@example.test', password: 'must-not-persist', sso_token: 'must-not-persist' })
    api.createAccount.mockResolvedValue({ id: 901, name: 'Grok 批量账号' })
    api.getGroupRateMultipliers.mockResolvedValue([])
    api.getGroupRPMOverrides.mockResolvedValue([])
    api.batchSetGroupRateMultipliers.mockResolvedValue({ message: 'ok' })
    api.batchSetGroupRPMOverrides.mockResolvedValue({ message: 'ok' })
    api.clearGroupRateMultipliers.mockResolvedValue({ message: 'ok' })
    api.clearGroupRPMOverrides.mockResolvedValue({ message: 'ok' })
    api.listCompositeRoutes.mockResolvedValue([])
    api.listUsers.mockResolvedValue({ items: [{ id: 81, email: 'rpm@example.test', username: 'RPM User', notes: '', status: 'active' }], total: 1 })
  })

  it('syncs catalog models and converts default token prices to per-million editor values', async () => {
    const draft = emptyPricingDraft('openai')
    draft.modelsText = 'gpt-5.5'
    draft.billing_mode = BillingModeOption.TOKEN
    const wrapper = mount(ChannelPricingEditor, { props: { modelValue: [draft] }, global: { plugins: [createPinia()] } })

    await wrapper.findAll('button').find((button) => button.text() === '拉取平台模型')!.trigger('click')
    await flushPromises()
    expect(api.syncPricingModels).toHaveBeenCalledWith('openai')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject([{ modelsText: 'gpt-5.5\ngpt-5.6-sol' }])

    await wrapper.setProps({ modelValue: [{ ...draft, modelsText: 'gpt-5.5\ngpt-5.6-sol' }] })
    await wrapper.findAll('button').find((button) => button.text() === '读取目录参考价')!.trigger('click')
    await flushPromises()
    expect(api.getModelDefaultPricing).toHaveBeenCalledWith('gpt-5.5')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject([{ input_price: 1.5, output_price: 12, image_input_price: 3 }])
  })

  it('loads group model candidates and checks server Live capability before enabling it', async () => {
    const wrapper = mount(GroupEditorDialog, {
      props: { show: false, group: null, groups: [group()] },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub, ChannelPricingEditor: true } }
    })
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(api.getModelsListCandidates).toHaveBeenCalledWith(0, 'openai')
    await wrapper.find('input[required]').setValue('新分组')

    await wrapper.findAll('[role="tab"]').find((button) => button.text() === '路由与协议')!.trigger('click')
    const customList = wrapper.findAll('label').find((label) => label.text().includes('使用自定义模型列表'))!
    await customList.find('input').setValue(true)
    await flushPromises()
    expect(wrapper.text()).toContain('gpt-5.6-sol')
    await wrapper.findAll('.model-candidate-grid label').find((label) => label.text() === 'gpt-5.5')!.find('input').setValue(true)

    const live = wrapper.findAll('label').find((label) => label.text().includes('允许 OpenAI Live'))!
    await live.find('input').setValue(true)
    await flushPromises()
    expect(api.getLiveCapability).toHaveBeenCalled()

    await wrapper.find('#group-editor-form').trigger('submit')
    const payload = wrapper.emitted('submit')?.[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({ allow_live: true, models_list_config: { enabled: true, models: ['gpt-5.5'] } })
  })

  it('submits the complete monitor request snapshot while keeping the API key write-only', async () => {
    const wrapper = mount(ChannelMonitorEditorDialog, {
      props: { show: true, monitor: null, templates: [] },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })
    const labels = wrapper.findAll('label')
    await labels.find((label) => label.text().startsWith('名称'))!.find('input').setValue('生产探测')
    await labels.find((label) => label.text().startsWith('端点 URL'))!.find('input').setValue('https://api.example.test/v1')
    await labels.find((label) => label.text().startsWith('API Key'))!.find('input').setValue('sk-monitor')
    await labels.find((label) => label.text().startsWith('主模型'))!.find('input').setValue('gpt-5.5')
    await labels.find((label) => label.text().includes('额外模型'))!.find('textarea').setValue('gpt-5.6-sol\ngpt-5.6-terra')
    await wrapper.find('#monitor-editor-form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      name: '生产探测',
      endpoint: 'https://api.example.test/v1',
      api_key: 'sk-monitor',
      primary_model: 'gpt-5.5',
      extra_models: ['gpt-5.6-sol', 'gpt-5.6-terra'],
      extra_headers: {},
      body_override_mode: 'off',
      body_override: null
    })
  })

  it('adds a searched user to RPM overrides and saves through the dedicated RPM contract', async () => {
    vi.useFakeTimers()
    api.getGroupRPMOverrides.mockResolvedValue([{ user_id: 7, user_name: '旧用户', user_email: 'old@example.test', user_notes: '', user_status: 'active', rpm_override: 90 }])
    const wrapper = mount(GroupUserOverridesDialog, {
      props: { show: false, group: group(), mode: GroupOverrideMode.RPM },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(api.getGroupRPMOverrides).toHaveBeenCalledWith(5)

    const addSection = wrapper.findAll('fieldset').find((field) => field.text().includes('添加用户覆盖'))!
    const inputs = addSection.findAll('input')
    await inputs[1].setValue('120')
    await inputs[0].setValue('rpm@example.test')
    await vi.advanceTimersByTimeAsync(281)
    await flushPromises()
    await addSection.find('.override-user-results button').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '保存全部')!.trigger('click')
    await flushPromises()

    expect(api.batchSetGroupRPMOverrides).toHaveBeenCalledWith(5, [
      { user_id: 7, rpm_override: 90 },
      { user_id: 81, rpm_override: 120 }
    ])
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('rejects a zero user rate multiplier before calling the backend', async () => {
    api.getGroupRateMultipliers.mockResolvedValue([{
      user_id: 7,
      user_name: '倍率用户',
      user_email: 'rate@example.test',
      user_notes: '',
      user_status: 'active',
      rate_multiplier: 1,
      rpm_override: null
    }])
    const wrapper = mount(GroupUserOverridesDialog, {
      props: { show: false, group: group(), mode: GroupOverrideMode.RATE },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })

    await wrapper.setProps({ show: true })
    await flushPromises()
    await wrapper.find('tbody input').setValue('0')
    await wrapper.findAll('button').find((button) => button.text() === '保存全部')!.trigger('click')
    await flushPromises()

    expect(api.batchSetGroupRateMultipliers).not.toHaveBeenCalled()
  })

  it('only offers composite-route target platforms supported by the backend', async () => {
    const compositeGroup = { ...group(), platform: 'composite' } as AdminGroup
    const wrapper = mount(GroupCompositeRoutesDialog, {
      props: { show: false, group: compositeGroup },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })

    await wrapper.setProps({ show: true })
    await flushPromises()
    const targetPlatform = wrapper.findAll('label').find((label) => label.text().startsWith('目标平台'))!
    expect(targetPlatform.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'antigravity',
      'grok'
    ])
  })

  it('exposes the backend Antigravity default mapping in account platform tools', async () => {
    const wrapper = mount(AccountToolsDialog, {
      props: { show: true, groups: [], proxies: [] },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })
    await wrapper.findAll('.resource-tabs button').find((button) => button.text() === '模型预览')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '读取 Antigravity 默认映射')!.trigger('click')
    await flushPromises()
    expect(api.getAntigravityDefaultModelMapping).toHaveBeenCalled()
    expect(wrapper.text()).toContain('gemini-2.5-pro')
  })

  it('batch-authorizes Grok email/password rows without persisting passwords or SSO secrets', async () => {
    const wrapper = mount(AccountToolsDialog, {
      props: { show: true, groups: [group()], proxies: [] },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })
    await wrapper.findAll('.resource-tabs button').find((button) => button.text() === '批量授权')!.trigger('click')
    const platform = wrapper.findAll('label').find((label) => label.text().startsWith('平台'))!.find('select')
    await platform.setValue('grok')
    await flushPromises()
    const method = wrapper.findAll('label').find((label) => label.text().startsWith('授权方式'))!.find('select')
    await method.setValue('email_password')
    await wrapper.findAll('label').find((label) => label.text().includes('邮箱与密码'))!.find('textarea').setValue('person@example.test----super-secret')
    await wrapper.findAll('button').find((button) => button.text() === '验证并批量创建')!.trigger('click')
    await flushPromises()

    expect(api.authorizeGrokPassword).toHaveBeenCalledWith('person@example.test----super-secret', null)
    expect(api.createAccount).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'grok',
      type: 'oauth',
      credentials: expect.objectContaining({ access_token: 'grok-password-access', refresh_token: 'grok-password-refresh' })
    }))
    const credentials = api.createAccount.mock.calls[0][0].credentials
    expect(credentials).not.toHaveProperty('password')
    expect(credentials).not.toHaveProperty('sso_token')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
})
