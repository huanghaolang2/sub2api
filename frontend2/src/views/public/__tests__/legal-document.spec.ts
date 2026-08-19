import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LegalDocumentView from '../LegalDocumentView.vue'

const mocks = vi.hoisted(() => ({
  route: { params: { documentId: 'terms' } },
  app: {
    cachedPublicSettings: null as null | Record<string, unknown>,
    fetchPublicSettings: vi.fn()
  }
}))

vi.mock('vue-router', () => ({ useRoute: () => mocks.route }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: ref('zh-CN') }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.app }))

const routerLinkStub = {
  props: ['to'],
  template: '<a :href="String(to)"><slot /></a>'
}

describe('LegalDocumentView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.route.params.documentId = 'terms'
    mocks.app.cachedPublicSettings = {
      site_name: 'Sub2API Fixture', site_logo: '/logo.svg', login_agreement_updated_at: '2026-08-18',
      login_agreement_documents: [{
        id: 'terms', title: '服务条款',
        content_md: '# 使用规则\n\n请合理使用。<script>window.pwned = true</script>\n\n[危险链接](javascript:alert(1))'
      }]
    }
    mocks.app.fetchPublicSettings.mockResolvedValue(mocks.app.cachedPublicSettings)
  })

  it('renders the configured document and removes executable markup', async () => {
    const wrapper = mount(LegalDocumentView, { global: { stubs: { RouterLink: routerLinkStub } } })
    await flushPromises()

    expect(wrapper.text()).toContain('Sub2API Fixture')
    expect(wrapper.text()).toContain('服务条款')
    expect(wrapper.text()).toContain('使用规则')
    expect(wrapper.text()).toContain('更新时间：2026-08-18')
    expect(wrapper.find('.legal-content script').exists()).toBe(false)
    expect(wrapper.get('.legal-content a').attributes('href')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps the built-in administrator compliance document publicly reachable', async () => {
    mocks.route.params.documentId = 'admin-compliance'
    const wrapper = mount(LegalDocumentView, { global: { stubs: { RouterLink: routerLinkStub } } })
    await flushPromises()

    expect(wrapper.text()).toContain('管理员合规确认')
    expect(wrapper.find('.legal-content').exists()).toBe(true)
    expect(wrapper.find('.legal-state').exists()).toBe(false)
    wrapper.unmount()
  })
})
