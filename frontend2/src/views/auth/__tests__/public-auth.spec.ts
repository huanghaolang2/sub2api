import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginView from '../LoginView.vue'
import RegisterView from '../RegisterView.vue'

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

const localStorageMock = createStorageMock()
const sessionStorageMock = createStorageMock()

const mocks = vi.hoisted(() => ({
  route: { query: {} as Record<string, unknown> },
  replace: vi.fn(),
  getPublicSettings: vi.fn(),
  sendVerifyCode: vi.fn(),
  validateInvitationCode: vi.fn(),
  validatePromoCode: vi.fn(),
  login: vi.fn(),
  login2FA: vi.fn(),
  loginWithPasskey: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace }),
}))

vi.mock('@/api/auth', () => ({
  getPublicSettings: mocks.getPublicSettings,
  sendVerifyCode: mocks.sendVerifyCode,
  validateInvitationCode: mocks.validateInvitationCode,
  validatePromoCode: mocks.validatePromoCode,
  buildOAuthLoginStartURL: vi.fn(() => '/api/v1/auth/oauth/github/start'),
  startOAuthLogin: vi.fn(),
  resolveWeChatOAuthStartStrict: vi.fn(() => ({ mode: 'open', unavailableReason: null })),
  isTotp2FARequired: (value: { requires_2fa?: boolean }) => value.requires_2fa === true,
}))

vi.mock('@shared-utils/oauthAffiliate', () => ({
  clearAllAffiliateReferralCodes: vi.fn(),
  resolveAffiliateReferralCode: vi.fn((...values: unknown[]) => values.find((value) => typeof value === 'string' && value.trim()) || ''),
  storeOAuthAffiliateCode: vi.fn(),
}))

vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: mocks.showSuccess, showError: mocks.showError }) }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAdmin: false,
    login: mocks.login,
    login2FA: mocks.login2FA,
    loginWithPasskey: mocks.loginWithPasskey,
    register: mocks.register,
    setToken: mocks.setToken,
  }),
}))

const settings = {
  registration_enabled: true,
  email_verify_enabled: true,
  force_email_on_third_party_signup: false,
  registration_email_suffix_whitelist: [],
  promo_code_enabled: true,
  password_reset_enabled: true,
  invitation_code_enabled: true,
  login_agreement_enabled: false,
  turnstile_enabled: false,
  turnstile_site_key: '',
  tencent_captcha_enabled: false,
  aliyun_captcha_enabled: false,
  site_name: 'Fixture', site_logo: '', site_subtitle: '', api_base_url: '', contact_info: '', doc_url: '', home_content: '', compact_home_enabled: false,
  hide_ccs_import_button: false, payment_enabled: true, risk_control_enabled: true, table_default_page_size: 20, table_page_size_options: [20], custom_menu_items: [], custom_endpoints: [],
  linuxdo_oauth_enabled: false, dingtalk_oauth_enabled: false, wechat_oauth_enabled: false, oidc_oauth_enabled: false, oidc_oauth_provider_name: 'OIDC', github_oauth_enabled: false, google_oauth_enabled: false,
  backend_mode_enabled: false, version: 'test', balance_low_notify_enabled: false, account_quota_notify_enabled: false, balance_low_notify_threshold: 0,
  channel_monitor_enabled: false, channel_monitor_default_interval_seconds: 60, available_channels_enabled: false, model_plaza_enabled: true, model_plaza_require_auth: false,
  service_quota_enabled: false, affiliate_enabled: true,
}

const stubs = {
  PublicAuthLayout: { template: '<main><slot /><footer><slot name="footer" /></footer></main>' },
  CaptchaChallenge: { template: '<div data-testid="captcha" />', methods: { reset: vi.fn(), verifyAction: vi.fn() } },
  SurfaceDialog: { props: ['show'], template: '<section v-if="show" data-testid="dialog"><slot /><slot name="footer" /></section>' },
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}

describe('public authentication views', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sessionStorageMock })
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mocks.route.query = {}
    mocks.getPublicSettings.mockResolvedValue(settings)
    mocks.sendVerifyCode.mockResolvedValue({ message: 'sent', countdown: 60 })
    mocks.validateInvitationCode.mockResolvedValue({ valid: true })
    mocks.validatePromoCode.mockResolvedValue({ valid: true, bonus_amount: 8.8 })
    mocks.login2FA.mockResolvedValue({ id: 2 })
    mocks.register.mockResolvedValue({ id: 2 })
  })

  it('continues a password login through inline TOTP and preserves the safe redirect', async () => {
    mocks.route.query = { redirect: '/app/usage?range=7d' }
    mocks.login.mockResolvedValue({ requires_2fa: true, temp_token: 'temp-2fa', user_email_masked: 'u***@example.test' })
    const wrapper = mount(LoginView, { global: { stubs } })
    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('user@example.test')
    await inputs[1].setValue('secret12')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ email: 'user@example.test', password: 'secret12' }))
    expect(wrapper.get('[data-testid="dialog"]').text()).toContain('动态验证码')
    await wrapper.get('input[maxlength="6"]').setValue('123456')
    await wrapper.findAll('button').find((button) => button.text().includes('验证并登录'))!.trigger('click')
    await flushPromises()
    expect(mocks.login2FA).toHaveBeenCalledWith('temp-2fa', '123456')
    expect(mocks.replace).toHaveBeenCalledWith('/app/usage?range=7d')
    wrapper.unmount()
  })

  it('validates invitation and promotion codes and submits the complete registration contract', async () => {
    mocks.route.query = { aff: 'AFF88' }
    const wrapper = mount(RegisterView, { global: { stubs } })
    await flushPromises()
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('new@example.test')
    await inputs[1].setValue('secret12')
    await inputs[2].setValue('secret12')
    await inputs[3].setValue('123456')
    await inputs[4].setValue('INVITE88')
    await inputs[4].trigger('blur')
    await inputs[5].setValue('YOUTH88')
    await inputs[5].trigger('blur')
    await wrapper.findAll('button').find((button) => button.text().includes('发送验证码'))!.trigger('click')
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.sendVerifyCode).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.test' }))
    expect(mocks.validateInvitationCode).toHaveBeenCalledWith('INVITE88')
    expect(mocks.validatePromoCode).toHaveBeenCalledWith('YOUTH88')
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new@example.test', password: 'secret12', verify_code: '123456',
      invitation_code: 'INVITE88', promo_code: 'YOUTH88', aff_code: 'AFF88',
    }))
    expect(mocks.replace).toHaveBeenCalledWith('/app/dashboard')
    wrapper.unmount()
  })

  it('restores affiliate and promotion links and enforces the configured email suffix policy', async () => {
    mocks.route.query = { aff: 'AFF88', promo: 'YOUTH88' }
    mocks.getPublicSettings.mockResolvedValue({
      ...settings,
      invitation_code_enabled: false,
      affiliate_enabled: true,
      registration_email_suffix_whitelist: ['@allowed.test'],
      registration_email_domain_quota_enabled: false,
    })
    const wrapper = mount(RegisterView, { global: { stubs } })
    await flushPromises()
    const field = (label: string) => wrapper.findAll('label').find((item) => item.text().startsWith(label))!.find('input')
    expect((field('邀请 / 返利码').element as HTMLInputElement).value).toBe('AFF88')
    expect((field('促销码').element as HTMLInputElement).value).toBe('YOUTH88')
    expect(mocks.validatePromoCode).toHaveBeenCalledWith('YOUTH88')

    await field('邮箱').setValue('blocked@example.test')
    await field('密码').setValue('secret12')
    await field('确认密码').setValue('secret12')
    await field('邮箱验证码').setValue('123456')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('@allowed.test')
    expect(mocks.register).not.toHaveBeenCalled()

    await field('邮箱').setValue('member@allowed.test')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ aff_code: 'AFF88', promo_code: 'YOUTH88' }))
    wrapper.unmount()
  })

  it('applies the revisioned agreement gate to third-party registration options', async () => {
    mocks.getPublicSettings.mockResolvedValue({
      ...settings,
      registration_enabled: false,
      github_oauth_enabled: true,
      login_agreement_enabled: true,
      login_agreement_mode: 'modal',
      login_agreement_revision: 'agreement-v2',
      login_agreement_documents: [{ id: 'terms', title: '服务条款' }],
    })
    const wrapper = mount(RegisterView, { global: { stubs } })
    await flushPromises()
    const github = wrapper.findAll('button').find((item) => item.text().includes('GitHub'))!
    expect(wrapper.get('[data-testid="dialog"]').text()).toContain('服务条款')
    expect(github.attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find((item) => item.text().includes('同意并继续'))!.trigger('click')
    expect(github.attributes('disabled')).toBeUndefined()
    expect(localStorage.getItem('sub2api_login_agreement_consent')).toContain('agreement-v2')
    wrapper.unmount()
  })
})
