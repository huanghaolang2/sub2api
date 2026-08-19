import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import HomeView from '../HomeView.vue'

const mocks = vi.hoisted(() => ({
  app: {
    publicSettingsLoaded: true,
    cachedPublicSettings: {
      site_name: 'Fixture',
      site_subtitle: '',
      home_content: '<section data-admin-widget="billing"><button onclick="window.adminWidget()">Open</button></section>',
      compact_home_enabled: false,
    },
    siteName: 'Fixture',
    siteLogo: '',
    docUrl: '',
    apiBaseUrl: '',
    fetchPublicSettings: vi.fn(),
  },
  auth: { isAdmin: false, isAuthenticated: false },
}))

vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.app }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }))

describe('public home compatibility', () => {
  it('keeps administrator-authored custom HTML attributes instead of silently reducing the existing capability', () => {
    const wrapper = mount(HomeView, {
      global: { stubs: { PublicShell: { template: '<div><slot /></div>' }, RouterLink: { template: '<a><slot /></a>' } } },
    })

    const widget = wrapper.get('[data-admin-widget="billing"]')
    expect(widget.get('button').attributes('onclick')).toBe('window.adminWidget()')
    expect(mocks.app.fetchPublicSettings).not.toHaveBeenCalled()
  })
})
