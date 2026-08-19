import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmailVerifyView from '../EmailVerifyView.vue'

function createStorageMock(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size }, clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

const mocks = vi.hoisted(() => ({
  route: { query: {} as Record<string, unknown> },
  replace: vi.fn(),
  getPublicSettings: vi.fn(),
  sendVerifyCode: vi.fn(),
  sendPendingOAuthVerifyCode: vi.fn(),
  post: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  setPending: vi.fn(),
  clearPending: vi.fn(),
  showSuccess: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('@/api/client', () => ({ apiClient: { post: mocks.post } }))
vi.mock('@/api/auth', () => ({
  getPublicSettings: mocks.getPublicSettings,
  isOAuthLoginCompletion: (value: { access_token?: string }) => Boolean(value.access_token),
  persistOAuthTokenContext: vi.fn(),
  sendPendingOAuthVerifyCode: mocks.sendPendingOAuthVerifyCode,
  sendVerifyCode: mocks.sendVerifyCode,
}))
vi.mock('@shared-utils/oauthAffiliate', () => ({ clearAllAffiliateReferralCodes: vi.fn() }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: mocks.showSuccess }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({
  pendingAuthSession: null,
  register: mocks.register,
  setToken: mocks.setToken,
  setPendingAuthSession: mocks.setPending,
  clearPendingAuthSession: mocks.clearPending,
}) }))

const global = { stubs: {
  PublicAuthLayout: { template: '<main><slot /><footer><slot name="footer" /></footer></main>' },
  CaptchaChallenge: { template: '<div />', methods: { reset: vi.fn(), verifyAction: vi.fn() } },
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
} }

describe('email verification recovery', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: createStorageMock() })
    vi.clearAllMocks()
    mocks.route.query = {}
    mocks.getPublicSettings.mockResolvedValue({
      email_verify_enabled: true,
      registration_email_suffix_whitelist: [],
      registration_email_domain_quota_enabled: false,
      turnstile_enabled: false,
      tencent_captcha_enabled: false,
      aliyun_captcha_enabled: false,
    })
    mocks.sendVerifyCode.mockResolvedValue({ message: 'sent', countdown: 60 })
    mocks.sendPendingOAuthVerifyCode.mockResolvedValue({ message: 'sent', countdown: 60 })
    mocks.register.mockResolvedValue({ id: 2 })
    mocks.setToken.mockResolvedValue(undefined)
  })

  it('applies the direct-registration email suffix policy on a recovered deep link', async () => {
    mocks.route.query = { email: 'blocked@example.test' }
    mocks.getPublicSettings.mockResolvedValue({
      email_verify_enabled: true,
      registration_email_suffix_whitelist: ['@allowed.test'],
      registration_email_domain_quota_enabled: false,
      turnstile_enabled: false,
      tencent_captcha_enabled: false,
      aliyun_captcha_enabled: false,
    })
    const wrapper = mount(EmailVerifyView, { global })
    await flushPromises()
    await wrapper.get('input[type="password"]').setValue('secret12')
    await wrapper.get('input[maxlength="6"]').setValue('123456')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('@allowed.test')
    expect(mocks.register).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('restores the pending OAuth token field for code delivery and account creation', async () => {
    sessionStorage.setItem('register_data', JSON.stringify({
      email: 'oauth@example.test', password: 'secret12', pending_provider: 'linuxdo',
      pending_oauth_token: 'pending-oauth', pending_auth_token_field: 'pending_oauth_token',
      pending_redirect: '/app/usage',
    }))
    mocks.post.mockResolvedValue({ data: { access_token: 'oauth-token', redirect: '/app/usage' } })
    const wrapper = mount(EmailVerifyView, { global })
    await flushPromises()
    expect(mocks.sendPendingOAuthVerifyCode).toHaveBeenCalledWith(expect.objectContaining({
      email: 'oauth@example.test', pending_oauth_token: 'pending-oauth',
    }))
    await wrapper.get('input[maxlength="6"]').setValue('123456')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(mocks.post).toHaveBeenCalledWith('/auth/oauth/pending/create-account', expect.objectContaining({
      pending_oauth_token: 'pending-oauth', email: 'oauth@example.test', verify_code: '123456',
    }))
    expect(mocks.setToken).toHaveBeenCalledWith('oauth-token')
    wrapper.unmount()
  })
})
