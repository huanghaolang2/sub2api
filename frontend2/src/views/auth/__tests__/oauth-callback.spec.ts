import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthProvider } from '@/features/public/model'
import OAuthProviderCallbackView from '../OAuthProviderCallbackView.vue'

function createStorageMock(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
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
  exchange: vi.fn(),
  persistToken: vi.fn(),
  sendCode: vi.fn(),
  post: vi.fn(),
  setToken: vi.fn(),
  login2FA: vi.fn(),
  setPending: vi.fn(),
  clearPending: vi.fn(),
  showSuccess: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('@/api/client', () => ({ apiClient: { post: mocks.post } }))
vi.mock('@/api/url', () => ({ buildApiUrl: (path: string) => `/api/v1${path}` }))
vi.mock('@/api/auth', () => ({
  exchangePendingOAuthCompletion: mocks.exchange,
  getPublicSettings: mocks.getPublicSettings,
  isOAuthLoginCompletion: (value: { access_token?: string }) => Boolean(value.access_token),
  persistOAuthTokenContext: mocks.persistToken,
  sendPendingOAuthVerifyCode: mocks.sendCode,
}))
vi.mock('@shared-utils/oauthAffiliate', () => ({
  clearAllAffiliateReferralCodes: vi.fn(),
  loadOAuthAffiliateCode: vi.fn(() => ''),
  oauthAffiliatePayload: vi.fn(() => ({})),
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: mocks.showSuccess }) }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    setToken: mocks.setToken,
    login2FA: mocks.login2FA,
    setPendingAuthSession: mocks.setPending,
    clearPendingAuthSession: mocks.clearPending,
  }),
}))

const settings = {
  email_verify_enabled: false,
  invitation_code_enabled: false,
  turnstile_enabled: false,
  tencent_captcha_enabled: false,
  aliyun_captcha_enabled: false,
  oidc_oauth_provider_name: 'OIDC',
}
const global = {
  stubs: {
    PublicAuthLayout: { template: '<main><slot /></main>' },
    CaptchaChallenge: { template: '<div />', methods: { reset: vi.fn(), verifyAction: vi.fn() } },
    RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  },
}

describe('OAuth callback completion', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: createStorageMock() })
    vi.clearAllMocks()
    mocks.route.query = {}
    mocks.getPublicSettings.mockResolvedValue(settings)
    mocks.setToken.mockResolvedValue(undefined)
  })

  it('turns account choice into an existing-account bind and completes login', async () => {
    mocks.exchange.mockResolvedValue({
      step: 'choose_account_action_required',
      provider: OAuthProvider.LINUXDO,
      email: 'existing@example.test',
      redirect: '/app/usage',
    })
    mocks.post.mockResolvedValue({ data: { access_token: 'oauth-token', redirect: '/app/usage' } })
    const wrapper = mount(OAuthProviderCallbackView, { props: { provider: OAuthProvider.LINUXDO }, global })
    await flushPromises()

    expect(wrapper.text()).toContain('可以创建新账号，也可以绑定已有账号')
    await wrapper.findAll('button').find((item) => item.text().includes('绑定已有账号'))!.trigger('click')
    const inputs = wrapper.findAll('input')
    expect((inputs[0].element as HTMLInputElement).value).toBe('existing@example.test')
    await inputs[1].setValue('secret12')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith('/auth/oauth/pending/bind-login', expect.objectContaining({
      email: 'existing@example.test', password: 'secret12',
    }))
    expect(mocks.setToken).toHaveBeenCalledWith('oauth-token')
    expect(mocks.replace).toHaveBeenCalledWith('/app/usage')
    wrapper.unmount()
  })

  it('keeps the dedicated DingTalk completion route on account creation without exchanging early', async () => {
    const wrapper = mount(OAuthProviderCallbackView, {
      props: { provider: OAuthProvider.DINGTALK, forceCreate: true },
      global,
    })
    await flushPromises()

    expect(wrapper.text()).toContain('补全邮箱和密码')
    expect(wrapper.text()).toContain('创建并继续')
    expect(mocks.exchange).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps GitHub and Google completion on the provider-verified email contract', async () => {
    mocks.getPublicSettings.mockResolvedValue({ ...settings, email_verify_enabled: true, turnstile_enabled: true, turnstile_site_key: 'fixture' })
    mocks.exchange.mockResolvedValue({
      error: 'registration_completion_required',
      provider: OAuthProvider.GITHUB,
      pending_email: 'github@example.test',
    })
    mocks.post.mockResolvedValue({ data: { access_token: 'github-token', redirect: '/app/dashboard' } })
    const wrapper = mount(OAuthProviderCallbackView, { global })
    await flushPromises()
    expect(wrapper.text()).not.toContain('邮箱验证码')
    const inputs = wrapper.findAll('input')
    expect((inputs[0].element as HTMLInputElement).readOnly).toBe(true)
    await inputs[1].setValue('secret12')
    await inputs[2].setValue('secret12')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith('/auth/oauth/github/complete-registration', expect.not.objectContaining({
      email: expect.anything(), verify_code: expect.anything(), turnstile_token: expect.anything(),
    }))
    expect(mocks.setToken).toHaveBeenCalledWith('github-token')
    wrapper.unmount()
  })
})
