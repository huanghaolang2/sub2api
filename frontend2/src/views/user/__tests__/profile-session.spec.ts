import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileView from '../ProfileView.vue'

const mocks = vi.hoisted(() => ({
  revokeAllSessions: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
  fetchPublicSettings: vi.fn(),
  confirm: vi.fn(),
  replace: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@shared-api/auth', () => ({
  isWeChatWebOAuthEnabled: vi.fn(() => false),
  revokeAllSessions: mocks.revokeAllSessions,
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({
  user: { id: 2, email: 'user@example.test', username: 'User' },
  refreshUser: mocks.refreshUser,
  logout: mocks.logout,
}) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({
  cachedPublicSettings: { passkey_enabled: true },
  fetchPublicSettings: mocks.fetchPublicSettings,
  showSuccess: mocks.showSuccess,
  showError: mocks.showError,
}) }))
vi.mock('@/stores/confirm', () => ({
  ConfirmTone: { DANGER: 'danger' },
  useConfirmStore: () => ({ ask: mocks.confirm }),
}))

describe('profile session security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.refreshUser.mockResolvedValue(undefined)
    mocks.fetchPublicSettings.mockResolvedValue(undefined)
    mocks.confirm.mockResolvedValue(true)
    mocks.revokeAllSessions.mockResolvedValue({ message: 'ok' })
    mocks.logout.mockResolvedValue(undefined)
  })

  it('confirms, revokes every server session, clears the local session, and returns to login', async () => {
    const wrapper = mount(ProfileView, {
      global: { stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: { template: '<section><slot /></section>' },
        ProfileOverviewPanel: true,
        ProfilePasswordPanel: true,
        ProfileBalanceNotifyPanel: true,
        ProfileTotpPanel: true,
        ProfilePasskeyPanel: true,
      } },
    })
    await flushPromises()
    await wrapper.findAll('nav button').find((item) => item.text() === '安全与通知')!.trigger('click')
    await wrapper.findAll('button').find((item) => item.text() === '退出所有设备')!.trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: '吊销全部会话', tone: 'danger' }))
    expect(mocks.revokeAllSessions).toHaveBeenCalledOnce()
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith('/login')
    wrapper.unmount()
  })
})
