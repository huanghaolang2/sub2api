import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/types'
import AccountCredentialWizard from '../AccountCredentialWizard.vue'
import AccountOAuthDialog from '../AccountOAuthDialog.vue'
import AccountPlatformConfigEditor from '../AccountPlatformConfigEditor.vue'

const api = vi.hoisted(() => ({
  generateAuthUrl: vi.fn(),
  exchangeCode: vi.fn(),
  refreshOpenAIToken: vi.fn(),
  applyOAuthCredentials: vi.fn(),
  getAntigravityDefaultModelMapping: vi.fn(),
  antigravityGenerate: vi.fn(),
  antigravityExchange: vi.fn(),
  antigravityRefresh: vi.fn(),
  geminiGenerate: vi.fn(),
  geminiExchange: vi.fn(),
  geminiCapabilities: vi.fn(),
  grokGenerate: vi.fn(),
  grokExchange: vi.fn(),
  grokRefresh: vi.fn(),
  grokCapabilities: vi.fn(),
  grokSSO: vi.fn(),
  grokPassword: vi.fn()
}))

vi.mock('@shared-api/admin/accounts', () => ({
  generateAuthUrl: api.generateAuthUrl,
  exchangeCode: api.exchangeCode,
  refreshOpenAIToken: api.refreshOpenAIToken,
  applyOAuthCredentials: api.applyOAuthCredentials,
  getAntigravityDefaultModelMapping: api.getAntigravityDefaultModelMapping
}))
vi.mock('@shared-api/admin/antigravity', () => ({ generateAuthUrl: api.antigravityGenerate, exchangeCode: api.antigravityExchange, refreshAntigravityToken: api.antigravityRefresh }))
vi.mock('@shared-api/admin/gemini', () => ({ generateAuthUrl: api.geminiGenerate, exchangeCode: api.geminiExchange, getCapabilities: api.geminiCapabilities }))
vi.mock('@shared-api/admin/grok', () => ({ generateAuthUrl: api.grokGenerate, exchangeCode: api.grokExchange, refreshGrokToken: api.grokRefresh, getCapabilities: api.grokCapabilities, validateSSOToken: api.grokSSO, authorizePassword: api.grokPassword }))

const surfaceStub = { props: ['show', 'title'], template: '<section v-if="show"><h2>{{ title }}</h2><slot /><slot name="footer" /></section>' }

function account(): Account {
  return {
    id: 801,
    name: 'Codex 主账号',
    platform: 'openai',
    type: 'oauth',
    status: 'active',
    schedulable: true,
    credentials: { email: 'existing@example.test', model_mapping: { 'gpt-*': 'gpt-5.5' }, header_overrides: { 'x-fixture': 'keep' } },
    credentials_status: { has_access_token: true, has_refresh_token: true },
    extra: { openai_passthrough: true },
    proxy_id: 2,
    group_ids: [],
    groups: [],
    concurrency: 4,
    priority: 0,
    rate_multiplier: 1,
    notes: '',
    expires_at: null,
    auto_pause_on_expired: false
  } as unknown as Account
}

describe('account platform and authorization editors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.generateAuthUrl.mockResolvedValue({ auth_url: 'https://auth.example.test/openai?state=fixture-state', session_id: 'fixture-session' })
    api.exchangeCode.mockResolvedValue({ access_token: 'new-access', refresh_token: 'new-refresh', email: 'new@example.test', name: 'New User', plan_type: 'team', sso_token: 'do-not-store' })
    api.applyOAuthCredentials.mockResolvedValue(account())
    api.getAntigravityDefaultModelMapping.mockResolvedValue({ 'claude-*': 'gemini-2.5-pro' })
  })

  it('edits explicit platform fields while preserving unknown credential and extra keys', async () => {
    const wrapper = mount(AccountPlatformConfigEditor, {
      props: { account: null, platform: 'openai', type: 'apikey', credentialsJson: JSON.stringify({ unknown_credential: 'keep', base_url: 'https://old.example.test', model_mapping: { 'gpt-*': 'gpt-5.5' } }), extraJson: JSON.stringify({ unknown_extra: 'keep' }) },
      global: { plugins: [createPinia()] }
    })
    await flushPromises()

    await wrapper.findAll('label').find((label) => label.text().startsWith('Base URL'))!.find('input').setValue('https://new.example.test')
    await wrapper.find('input[type="password"]').setValue('sk-replacement')
    await wrapper.findAll('label').find((label) => label.text().includes('长上下文计费'))!.find('input').setValue(true)
    await flushPromises()

    const credentials = JSON.parse(wrapper.emitted('update:credentialsJson')!.at(-1)![0] as string)
    const extra = JSON.parse(wrapper.emitted('update:extraJson')!.at(-1)![0] as string)
    expect(credentials).toMatchObject({ unknown_credential: 'keep', base_url: 'https://new.example.test', api_key: 'sk-replacement', model_mapping: { 'gpt-*': 'gpt-5.5' } })
    expect(extra).toMatchObject({ unknown_extra: 'keep', openai_long_context_billing_enabled: true })
  })

  it('exchanges a create-time authorization code and merges the result into the current form JSON', async () => {
    const wrapper = mount(AccountCredentialWizard, {
      props: { platform: 'openai', type: 'oauth', proxyId: 2, credentialsJson: JSON.stringify({ model_mapping: { 'gpt-*': 'gpt-5.5' } }), extraJson: JSON.stringify({ existing_extra: 'keep' }) },
      global: { plugins: [createPinia()] }
    })
    await wrapper.findAll('button').find((button) => button.text() === '生成授权链接')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('label').find((label) => label.text().startsWith('回调 code'))!.find('input').setValue('fixture-code')
    await wrapper.findAll('button').find((button) => button.text() === '验证并写入凭据')!.trigger('click')
    await flushPromises()

    expect(api.exchangeCode).toHaveBeenCalledWith('/admin/openai/exchange-code', expect.objectContaining({ session_id: 'fixture-session', code: 'fixture-code', state: 'fixture-state', proxy_id: 2 }))
    const credentials = JSON.parse(wrapper.emitted('update:credentialsJson')!.at(-1)![0] as string)
    const extra = JSON.parse(wrapper.emitted('update:extraJson')!.at(-1)![0] as string)
    expect(credentials).toMatchObject({ access_token: 'new-access', refresh_token: 'new-refresh', plan_type: 'team', model_mapping: { 'gpt-*': 'gpt-5.5' } })
    expect(credentials).not.toHaveProperty('sso_token')
    expect(extra).toMatchObject({ existing_extra: 'keep', email: 'new@example.test', name: 'New User' })
  })

  it('re-authorizes with platform-normalized tokens while retaining model mappings', async () => {
    const wrapper = mount(AccountOAuthDialog, {
      props: { show: false, account: account() },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })
    await wrapper.setProps({ show: true })
    await wrapper.findAll('button').find((button) => button.text() === '生成授权链接')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('label').find((label) => label.text().startsWith('回调 code'))!.find('input').setValue('fixture-code')
    await wrapper.findAll('button').find((button) => button.text() === '完成授权')!.trigger('click')
    await flushPromises()

    expect(api.applyOAuthCredentials).toHaveBeenCalledWith(801, {
      type: 'oauth',
      credentials: expect.objectContaining({ access_token: 'new-access', refresh_token: 'new-refresh', model_mapping: { 'gpt-*': 'gpt-5.5' }, header_overrides: { 'x-fixture': 'keep' } }),
      extra: { email: 'new@example.test', name: 'New User' }
    })
    expect(api.applyOAuthCredentials.mock.calls[0][1].credentials).not.toHaveProperty('sso_token')
  })
})
