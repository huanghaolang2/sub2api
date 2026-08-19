import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminGroup, Announcement } from '@/types'
import { AnnouncementStatus } from '@/features/admin/governance/model'
import AnnouncementsView from '../AnnouncementsView.vue'
import SettingsView from '../SettingsView.vue'

const api = vi.hoisted(() => ({
  announcementList: vi.fn(),
  announcementGet: vi.fn(),
  groupList: vi.fn(),
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn(),
  emailTemplatesGet: vi.fn(),
  emailTemplateGet: vi.fn(),
  adminKeyGet: vi.fn(),
  overloadGet: vi.fn(),
  rate429Get: vi.fn(),
  panelRateLimitGet: vi.fn(),
  streamTimeoutGet: vi.fn(),
  rectifierGet: vi.fn(),
  betaPolicyGet: vi.fn(),
  webSearchGet: vi.fn(),
  upstreamProbeGet: vi.fn(),
  ollamaUsageGet: vi.fn(),
  updateCheck: vi.fn(),
  rollbackVersionsGet: vi.fn(),
}))

vi.mock('@shared-api/admin/announcements', () => ({
  default: {
    list: api.announcementList,
    getById: api.announcementGet,
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), getReadStatus: vi.fn(),
  },
}))
vi.mock('@shared-api/admin/groups', () => ({ getAll: api.groupList, default: { getAll: api.groupList } }))

vi.mock('@shared-api/admin/settings', () => {
  const settings = {
    getSettings: api.settingsGet,
    updateSettings: api.settingsUpdate,
    getEmailTemplates: api.emailTemplatesGet,
    getEmailTemplate: api.emailTemplateGet,
    updateEmailTemplate: vi.fn(), restoreOfficialEmailTemplate: vi.fn(), previewEmailTemplate: vi.fn(),
    getAdminApiKey: api.adminKeyGet,
    regenerateAdminApiKey: vi.fn(), deleteAdminApiKey: vi.fn(),
    getOverloadCooldownSettings: api.overloadGet,
    updateOverloadCooldownSettings: vi.fn(),
    getRateLimit429CooldownSettings: api.rate429Get,
    updateRateLimit429CooldownSettings: vi.fn(),
    getPanelRateLimitSettings: api.panelRateLimitGet,
    updatePanelRateLimitSettings: vi.fn(),
    getStreamTimeoutSettings: api.streamTimeoutGet,
    updateStreamTimeoutSettings: vi.fn(),
    getRectifierSettings: api.rectifierGet,
    updateRectifierSettings: vi.fn(),
    getBetaPolicySettings: api.betaPolicyGet,
    updateBetaPolicySettings: vi.fn(),
    getWebSearchEmulationConfig: api.webSearchGet,
    updateWebSearchEmulationConfig: vi.fn(), testWebSearchEmulation: vi.fn(), resetWebSearchUsage: vi.fn(),
    testSmtpConnection: vi.fn(), sendTestEmail: vi.fn(),
  }
  return { ...settings, default: settings }
})
vi.mock('@shared-api/admin/accounts', () => {
  const accounts = {
    getUpstreamBillingProbeSettings: api.upstreamProbeGet,
    updateUpstreamBillingProbeSettings: vi.fn(),
    getOllamaCloudUsageSettings: api.ollamaUsageGet,
    updateOllamaCloudUsageSettings: vi.fn(),
  }
  return { ...accounts, default: accounts }
})
vi.mock('@shared-api/admin/system', () => {
  const system = {
    checkUpdates: api.updateCheck,
    getRollbackVersions: api.rollbackVersionsGet,
    performUpdate: vi.fn(), rollback: vi.fn(), restartService: vi.fn(),
  }
  return { ...system, default: system }
})

const commonStubs = {
  ConsoleShell: { template: '<main><slot /></main>' },
  PageState: { template: '<section><slot /></section>' },
  SurfaceDialog: { template: '<section><slot /><slot name="footer" /></section>' },
  TotpStepUpDialog: true,
  RouterLink: { template: '<a><slot /></a>' },
}

function announcement(): Announcement {
  return {
    id: 31,
    title: '维护通知',
    content: '列表摘要',
    status: AnnouncementStatus.DRAFT,
    notify_mode: 'silent',
    targeting: { any_of: [] },
    starts_at: undefined,
    ends_at: undefined,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
  } as Announcement
}

function group(): AdminGroup {
  return { id: 7, name: '专业版', subscription_type: 'subscription', status: 'active' } as AdminGroup
}

async function mountView(component: Parameters<typeof mount>[0]) {
  const wrapper = mount(component, { global: { plugins: [createPinia()], stubs: commonStubs } })
  await flushPromises()
  return wrapper
}

describe('admin governance workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.announcementList.mockResolvedValue({ items: [announcement()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.announcementGet.mockResolvedValue({ ...announcement(), content: '完整公告正文' })
    api.groupList.mockResolvedValue([group()])

    const settings = {
      site_name: '旧站点名',
      registration_enabled: true,
      smtp_host: 'smtp.example.test',
      smtp_password_configured: true,
      openai_advanced_scheduler_effective_lb_top_k: 3,
    }
    api.settingsGet.mockResolvedValue(settings)
    api.settingsUpdate.mockImplementation(async (payload: Record<string, unknown>) => ({ ...settings, ...payload }))
    api.emailTemplatesGet.mockResolvedValue({ events: [], locales: [], placeholders: [] })
    api.adminKeyGet.mockResolvedValue({ exists: true, masked_key: 'sk-admin••••demo' })
    api.overloadGet.mockResolvedValue({ enabled: true, cooldown_minutes: 10 })
    api.rate429Get.mockResolvedValue({ enabled: true, cooldown_seconds: 60 })
    api.panelRateLimitGet.mockResolvedValue({ enabled: true, user_rpm: 120, heavy_rpm: 20, exempt_admin: true, public_ip_rpm: 30 })
    api.streamTimeoutGet.mockResolvedValue({ enabled: true, action: 'temp_unsched', temp_unsched_minutes: 5, threshold_count: 3, threshold_window_minutes: 10 })
    api.rectifierGet.mockResolvedValue({ enabled: true, thinking_signature_enabled: true, thinking_budget_enabled: true, apikey_signature_enabled: true, apikey_signature_patterns: ['sk-*'] })
    api.betaPolicyGet.mockResolvedValue({ rules: [] })
    api.webSearchGet.mockResolvedValue({ enabled: false, providers: [] })
    api.upstreamProbeGet.mockResolvedValue({ enabled: true, interval_minutes: 30 })
    api.ollamaUsageGet.mockResolvedValue({ enabled: true, interval_minutes: 60, debounce_minutes: 5 })
    api.updateCheck.mockResolvedValue({ current_version: '1.0.0', latest_version: '1.0.0', has_update: false, build_type: 'release', cached: false })
    api.rollbackVersionsGet.mockResolvedValue({ versions: [] })
  })

  it('uses server-side announcement filters and fetches the complete item before editing', async () => {
    const wrapper = await mountView(AnnouncementsView)
    expect(api.announcementList).toHaveBeenCalledWith(1, 20, expect.objectContaining({
      sort_by: 'created_at', sort_order: 'desc',
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))

    await wrapper.find('.resource-toolbar__filters select').setValue(AnnouncementStatus.DRAFT)
    await flushPromises()
    expect(api.announcementList).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ status: AnnouncementStatus.DRAFT }), expect.anything())

    await wrapper.findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
    await flushPromises()
    expect(api.announcementGet).toHaveBeenCalledWith(31)
    expect(wrapper.find<HTMLTextAreaElement>('textarea').element.value).toBe('完整公告正文')
    wrapper.unmount()
  })

  it('renders every returned settings field and submits only the changed business value', async () => {
    const wrapper = await mountView(SettingsView)
    expect(api.settingsGet).toHaveBeenCalledOnce()
    expect(api.overloadGet).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('site_name')
    expect(wrapper.text()).not.toContain('当前仅提供只读摘要')

    const siteField = wrapper.findAll('.settings-field').find((field) => field.text().includes('site_name'))
    expect(siteField).toBeDefined()
    await siteField!.find('input').setValue('新站点名')
    await wrapper.findAll('button').find((button) => button.text() === '保存系统设置')!.trigger('click')
    await flushPromises()

    expect(api.settingsUpdate).toHaveBeenCalledOnce()
    expect(api.settingsUpdate).toHaveBeenCalledWith({ site_name: '新站点名' })
    wrapper.unmount()
  })
})
