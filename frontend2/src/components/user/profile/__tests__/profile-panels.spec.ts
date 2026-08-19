import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/types'
import ProfileBalanceNotifyPanel from '../ProfileBalanceNotifyPanel.vue'
import ProfileOverviewPanel from '../ProfileOverviewPanel.vue'
import ProfilePasskeyPanel from '../ProfilePasskeyPanel.vue'
import ProfilePasswordPanel from '../ProfilePasswordPanel.vue'
import ProfileTotpPanel from '../ProfileTotpPanel.vue'

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(), changePassword: vi.fn(), getProfile: vi.fn(),
  sendNotifyEmailCode: vi.fn(), verifyNotifyEmail: vi.fn(), removeNotifyEmail: vi.fn(), toggleNotifyEmail: vi.fn(),
  sendEmailBindingCode: vi.fn(), bindEmailIdentity: vi.fn(), startOAuthBinding: vi.fn(), unbindAuthIdentity: vi.fn(),
  totpStatus: vi.fn(), totpMethod: vi.fn(), totpSend: vi.fn(), totpSetup: vi.fn(), totpEnable: vi.fn(), totpDisable: vi.fn(),
  passkeySupported: vi.fn(), passkeyList: vi.fn(), passkeyRegister: vi.fn(), passkeyRename: vi.fn(), passkeyRemove: vi.fn(),
  qr: vi.fn(), success: vi.fn(), error: vi.fn(), auth: { user: null as User | null }
}))

vi.mock('@shared-api/user', () => ({
  updateProfile: mocks.updateProfile,
  changePassword: mocks.changePassword,
  getProfile: mocks.getProfile,
  sendNotifyEmailCode: mocks.sendNotifyEmailCode,
  verifyNotifyEmail: mocks.verifyNotifyEmail,
  removeNotifyEmail: mocks.removeNotifyEmail,
  toggleNotifyEmail: mocks.toggleNotifyEmail,
  sendEmailBindingCode: mocks.sendEmailBindingCode,
  bindEmailIdentity: mocks.bindEmailIdentity,
  startOAuthBinding: mocks.startOAuthBinding,
  unbindAuthIdentity: mocks.unbindAuthIdentity
}))
vi.mock('@shared-api/totp', () => ({
  totpAPI: {
    getStatus: mocks.totpStatus, getVerificationMethod: mocks.totpMethod, sendVerifyCode: mocks.totpSend,
    initiateSetup: mocks.totpSetup, enable: mocks.totpEnable, disable: mocks.totpDisable
  }
}))
vi.mock('@shared-api/passkey', () => ({
  passkeyAPI: {
    isSupported: mocks.passkeySupported, list: mocks.passkeyList, register: mocks.passkeyRegister,
    rename: mocks.passkeyRename, remove: mocks.passkeyRemove
  }
}))
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.qr } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showSuccess: mocks.success,
    showError: mocks.error,
    cachedPublicSettings: { wechat_oauth_enabled: true }
  })
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ fullPath: '/app/profile' }) }))

const user = {
  id: 2, username: 'Nova', email: 'nova@example.test', role: 'user', balance: 42.75, concurrency: 6,
  status: 'active', allowed_groups: null, balance_notify_enabled: true, balance_notify_threshold: 5,
  balance_notify_extra_emails: [
    { email: 'nova@example.test', disabled: false, verified: true },
    { email: 'ops@example.test', disabled: false, verified: false }
  ],
  email_bound: true, linuxdo_bound: true,
  auth_bindings: {
    email: { bound: true, can_unbind: false },
    linuxdo: { bound: true, display_name: 'nova-linux', can_unbind: true },
    dingtalk: { bound: false, can_bind: true }, oidc: { bound: false, can_bind: true },
    wechat: { bound: false, can_bind: true }
  },
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-08-18T00:00:00Z'
} as User

const dialogStub = {
  props: ['show', 'title', 'description'],
  emits: ['close'],
  template: '<section v-if="show" class="dialog-stub" :data-title="title"><slot /><footer><slot name="footer" /></footer></section>'
}

describe('profile overview and identities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.user = user
    mocks.updateProfile.mockResolvedValue(user)
    mocks.bindEmailIdentity.mockResolvedValue(user)
    mocks.unbindAuthIdentity.mockResolvedValue(user)
    mocks.sendEmailBindingCode.mockResolvedValue(undefined)
  })

  it('renders all profile fields and executes username, email binding and confirmed unbinding contracts', async () => {
    const wrapper = mount(ProfileOverviewPanel, {
      props: {
        user, linuxdoEnabled: true, dingtalkEnabled: true, oidcEnabled: true,
        oidcProviderName: '企业 SSO', wechatEnabled: true
      },
      global: { stubs: { SurfaceDialog: dialogStub } }
    })
    expect(wrapper.text()).toContain('$42.75')
    expect(wrapper.text()).toContain('nova-linux')
    expect(wrapper.text()).toContain('钉钉')
    expect(wrapper.text()).toContain('企业 SSO')
    expect(wrapper.text()).toContain('微信')

    await wrapper.get('#profile-username').setValue('Nova Plus')
    await wrapper.find('.profile-form').trigger('submit')
    await flushPromises()
    expect(mocks.updateProfile).toHaveBeenCalledWith({ username: 'Nova Plus' })

    await wrapper.findAll('.identity-actions button').find((button) => button.text() === '更换邮箱')!.trigger('click')
    const emailForm = wrapper.get('.email-binding-form')
    const inputs = emailForm.findAll('input')
    await inputs[0]!.setValue('next@example.test')
    await emailForm.findAll('button').find((button) => button.text() === '发送验证码')!.trigger('click')
    expect(mocks.sendEmailBindingCode).toHaveBeenCalledWith('next@example.test')
    await inputs[1]!.setValue('123456')
    await inputs[2]!.setValue('password')
    await emailForm.trigger('submit')
    await flushPromises()
    expect(mocks.bindEmailIdentity).toHaveBeenCalledWith({
      email: 'next@example.test', verify_code: '123456', password: 'password'
    })

    await wrapper.findAll('.identity-actions .danger')[0]!.trigger('click')
    await wrapper.findAll('.dialog-stub button').find((button) => button.text() === '确认解绑')!.trigger('click')
    await flushPromises()
    expect(mocks.unbindAuthIdentity).toHaveBeenCalledWith('linuxdo')
    wrapper.unmount()
  })
})

describe('profile password and notification emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.user = user
    mocks.changePassword.mockResolvedValue({ message: 'ok' })
    mocks.updateProfile.mockResolvedValue(user)
    mocks.toggleNotifyEmail.mockResolvedValue({ ...user, balance_notify_extra_emails: [
      { email: 'nova@example.test', disabled: true, verified: true },
      { email: 'ops@example.test', disabled: false, verified: false }
    ] })
    mocks.sendNotifyEmailCode.mockResolvedValue(undefined)
    mocks.verifyNotifyEmail.mockResolvedValue(undefined)
    mocks.getProfile.mockResolvedValue({ ...user, balance_notify_extra_emails: [
      ...user.balance_notify_extra_emails, { email: 'alerts@example.test', disabled: false, verified: true }
    ] })
  })

  it('validates and changes the password with the shared API', async () => {
    const wrapper = mount(ProfilePasswordPanel)
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('old-password')
    await inputs[1]!.setValue('new-password')
    await inputs[2]!.setValue('new-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.changePassword).toHaveBeenCalledWith('old-password', 'new-password')
  })

  it('saves threshold, toggles recipients and verifies a new notification email', async () => {
    const wrapper = mount(ProfileBalanceNotifyPanel, { props: { user, systemDefaultThreshold: 3 } })
    await wrapper.get('#notify-threshold').setValue(8.5)
    await wrapper.findAll('button').find((button) => button.text() === '保存阈值')!.trigger('click')
    await flushPromises()
    expect(mocks.updateProfile).toHaveBeenCalledWith({ balance_notify_threshold: 8.5 })
    await wrapper.findAll('.mini-switch')[0]!.trigger('click')
    await flushPromises()
    expect(mocks.toggleNotifyEmail).toHaveBeenCalledWith('nova@example.test', true)

    await wrapper.get('.add-email input').setValue('alerts@example.test')
    await wrapper.findAll('button').find((button) => button.text() === '添加邮箱')!.trigger('click')
    const pending = wrapper.get('.email-row--pending')
    await pending.findAll('button').find((button) => button.text() === '发送验证码')!.trigger('click')
    await pending.get('input').setValue('654321')
    await pending.findAll('button').find((button) => button.text() === '验证并添加')!.trigger('click')
    await flushPromises()
    expect(mocks.verifyNotifyEmail).toHaveBeenCalledWith('alerts@example.test', '654321')
    wrapper.unmount()
  })
})

describe('TOTP and Passkey security panels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.totpStatus.mockResolvedValue({ enabled: false, enabled_at: null, feature_enabled: true })
    mocks.totpMethod.mockResolvedValue({ method: 'password' })
    mocks.totpSetup.mockResolvedValue({
      secret: 'SECRET123', qr_code_url: 'otpauth://fixture', setup_token: 'setup-token', countdown: 300
    })
    mocks.totpEnable.mockResolvedValue({ success: true })
    mocks.qr.mockResolvedValue('data:image/png;base64,totp')
    mocks.passkeySupported.mockReturnValue(true)
    mocks.passkeyList.mockResolvedValue([{ id: 41, name: 'MacBook', created_at: '2026-08-01T00:00:00Z', backup: true }])
    mocks.passkeyRename.mockResolvedValue(undefined)
    mocks.passkeyRemove.mockResolvedValue(undefined)
  })

  it('completes identity verification, QR setup and final TOTP enablement', async () => {
    const wrapper = mount(ProfileTotpPanel, { global: { stubs: { SurfaceDialog: dialogStub } } })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '开启 TOTP')!.trigger('click')
    await flushPromises()
    await wrapper.get('.totp-dialog-form input').setValue('current-password')
    await wrapper.findAll('.dialog-stub button').find((button) => button.text() === '继续')!.trigger('click')
    await flushPromises()
    expect(mocks.totpSetup).toHaveBeenCalledWith({ password: 'current-password' })
    expect(wrapper.get('img[alt="TOTP 配置二维码"]').attributes('src')).toContain('data:image/png')
    await wrapper.findAll('.dialog-stub button').find((button) => button.text() === '已扫描，下一步')!.trigger('click')
    await wrapper.get('.totp-code-step input').setValue('123456')
    await wrapper.findAll('.dialog-stub button').find((button) => button.text() === '验证并开启')!.trigger('click')
    await flushPromises()
    expect(mocks.totpEnable).toHaveBeenCalledWith({ totp_code: '123456', setup_token: 'setup-token' })
    wrapper.unmount()
  })

  it('lists, renames and password-confirms Passkey deletion', async () => {
    const wrapper = mount(ProfilePasskeyPanel, { props: { enabled: true }, global: { stubs: { SurfaceDialog: dialogStub } } })
    await flushPromises()
    expect(wrapper.text()).toContain('MacBook')
    await wrapper.findAll('.passkey-list button').find((button) => button.text() === '重命名')!.trigger('click')
    await wrapper.get('.passkey-form input').setValue('Office Mac')
    await wrapper.findAll('.dialog-stub button').find((button) => button.text() === '保存名称')!.trigger('click')
    await flushPromises()
    expect(mocks.passkeyRename).toHaveBeenCalledWith(41, 'Office Mac')
    await wrapper.findAll('.passkey-list button').find((button) => button.text() === '删除')!.trigger('click')
    await wrapper.get('.passkey-form input').setValue('current-password')
    await wrapper.findAll('.dialog-stub button').find((button) => button.text() === '确认删除')!.trigger('click')
    await flushPromises()
    expect(mocks.passkeyRemove).toHaveBeenCalledWith(41, 'current-password')
    wrapper.unmount()
  })
})
