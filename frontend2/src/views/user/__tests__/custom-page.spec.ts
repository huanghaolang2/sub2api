import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CustomPageView from '../CustomPageView.vue'

const mocks = vi.hoisted(() => ({
  route: { params: { id: 'guide' } },
  app: {
    siteName: 'Sub2API',
    publicSettingsLoaded: true,
    cachedPublicSettings: { custom_menu_items: [] as Array<Record<string, unknown>> },
    fetchPublicSettings: vi.fn()
  },
  auth: { isAdmin: false, user: { id: 27 }, token: 'session-token' },
  admin: { loaded: true, customMenuItems: [] as Array<Record<string, unknown>>, fetch: vi.fn() },
  embeddedUrl: vi.fn()
}))

vi.mock('vue-router', () => ({ useRoute: () => mocks.route }))
vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ locale: ref('zh-CN') })
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.app }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => mocks.admin }))
vi.mock('@shared-api/client', () => ({ buildApiUrl: (path: string) => `/api/v1${path}` }))
vi.mock('@shared-utils/embedded-url', () => ({
  detectTheme: () => 'light',
  buildEmbeddedUrl: mocks.embeddedUrl
}))

const shellStub = { template: '<main><slot /></main>' }

describe('CustomPageView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.route.params.id = 'guide'
    mocks.auth.isAdmin = false
    mocks.app.publicSettingsLoaded = true
    mocks.app.cachedPublicSettings = {
      custom_menu_items: [{
        id: 'guide', label: '接入指南', icon_svg: '<svg viewBox="0 0 24 24"><path d="M4 5h16"/><script>bad()</script></svg>', url: 'md:getting-started',
        page_slug: 'getting-started', visibility: 'user', sort_order: 1
      }]
    }
    mocks.admin.loaded = true
    mocks.admin.customMenuItems = []
    mocks.embeddedUrl.mockReturnValue('https://example.test/embedded')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      '# 快速开始',
      '正文<script>window.pwned = true</script>',
      '## 发送请求',
      '![流程图](assets/diagram.png?rev=2)',
      '```bash',
      'curl https://api.example.test',
      '```'
    ].join('\n'))))
  })

  it('renders sanitized Markdown, rewrites relative assets and exposes the TOC and copy action', async () => {
    const wrapper = mount(CustomPageView, { global: { stubs: { ConsoleShell: shellStub } } })
    await flushPromises()
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/v1/pages/getting-started', {
      headers: { Authorization: 'Bearer session-token' }
    })
    expect(wrapper.text()).toContain('接入指南')
    expect(wrapper.text()).toContain('快速开始')
    expect(wrapper.text()).toContain('发送请求')
    expect(document.title).toBe('接入指南 · Sub2API')
    expect(wrapper.find('.custom-heading__icon svg').exists()).toBe(true)
    expect(wrapper.find('.custom-heading__icon script').exists()).toBe(false)
    expect(wrapper.find('.markdown-content script').exists()).toBe(false)
    expect(wrapper.get('.markdown-content img').attributes('src')).toBe(
      '/api/v1/pages/getting-started/images/assets/diagram.png?rev=2'
    )
    expect(wrapper.findAll('.markdown-layout aside nav button').map((item) => item.text())).toEqual([
      '快速开始', '发送请求'
    ])
    expect(wrapper.get('.custom-copy-button').text()).toBe('复制')
    wrapper.unmount()
  })

  it('does not expose an administrator-only custom item to a regular user', async () => {
    mocks.route.params.id = 'admin-runbook'
    mocks.app.cachedPublicSettings = {
      custom_menu_items: [{
        id: 'admin-runbook', label: '运维手册', icon_svg: '', url: 'md:getting-started',
        page_slug: 'getting-started', visibility: 'admin', sort_order: 1
      }]
    }

    const wrapper = mount(CustomPageView, { global: { stubs: { ConsoleShell: shellStub } } })
    await flushPromises()

    expect(wrapper.text()).toContain('页面不存在或对当前用户不可见')
    expect(fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('passes identity, token, theme and locale to an embedded page and keeps a new-window fallback', async () => {
    mocks.route.params.id = 'status-lab'
    mocks.app.cachedPublicSettings = {
      custom_menu_items: [{
        id: 'status-lab', label: '状态实验室', icon_svg: '',
        url: 'https://status.example.test/console', visibility: 'user', sort_order: 2
      }]
    }
    mocks.embeddedUrl.mockReturnValue('https://status.example.test/console?user_id=27&theme=light&locale=zh-CN')

    const wrapper = mount(CustomPageView, { global: { stubs: { ConsoleShell: shellStub } } })
    await flushPromises()

    expect(mocks.embeddedUrl).toHaveBeenCalledWith(
      'https://status.example.test/console', 27, 'session-token', 'light', 'zh-CN'
    )
    expect(wrapper.get('iframe').attributes('src')).toContain('user_id=27')
    expect(wrapper.get('a[target="_blank"]').attributes('href')).toContain('status.example.test')
    expect(fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
