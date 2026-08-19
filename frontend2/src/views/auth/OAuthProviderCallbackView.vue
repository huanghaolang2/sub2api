<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CaptchaChallenge from '@/components/auth/CaptchaChallenge.vue'
import { apiClient } from '@/api/client'
import { buildApiUrl } from '@/api/url'
import {
  exchangePendingOAuthCompletion,
  getPublicSettings,
  isOAuthLoginCompletion,
  persistOAuthTokenContext,
  sendPendingOAuthVerifyCode,
  type OAuthAdoptionDecision,
  type PendingOAuthExchangeResponse,
} from '@/api/auth'
import type { PublicSettings } from '@/types'
import { clearAllAffiliateReferralCodes, loadOAuthAffiliateCode, oauthAffiliatePayload } from '@shared-utils/oauthAffiliate'
import PublicAuthLayout from '@/components/auth/PublicAuthLayout.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import {
  OAuthPendingAction,
  OAuthProvider,
  emailIsValid,
  normalizePendingOAuthAction,
  passwordValidationMessage,
  sanitizeRedirectPath,
} from '@/features/public/model'

interface CaptchaController { reset(): void; verifyAction(): Promise<{ token: string; randstr: string } | null> }
interface OAuthCompletion extends PendingOAuthExchangeResponse {
  step?: string
  intent?: string
  state?: string
  status?: string
  provider?: string
  email?: string
  resolved_email?: string
  pending_email?: string
  existing_account_email?: string
  suggested_email?: string
  invitation_required?: boolean
  existing_account_bindable?: boolean
}

const props = withDefaults(defineProps<{ provider?: OAuthProvider; forceCreate?: boolean }>(), { forceCreate: false })
const route = useRoute()
const router = useRouter()
const app = useAppStore()
const auth = useAuthStore()
const settings = ref<PublicSettings | null>(null)
const processing = ref(true)
const submitting = ref(false)
const sendingCode = ref(false)
const pendingWait = ref(false)
const error = ref('')
const action = ref(OAuthPendingAction.NONE)
const redirectTo = ref('/app/dashboard')
const legacyPendingToken = ref('')
const invitationRequired = ref(false)
const suggestedDisplayName = ref('')
const suggestedAvatar = ref('')
const adoptDisplayName = ref(true)
const adoptAvatar = ref(true)
const totpToken = ref('')
const totpEmail = ref('')
const totpCode = ref('')
const countdown = ref(0)
const captchaRef = ref<CaptchaController | null>(null)
const captchaToken = ref('')
const captchaRandstr = ref('')
const createForm = reactive({ email: '', password: '', confirmation: '', verifyCode: '', invitationCode: '' })
const bindForm = reactive({ email: '', password: '' })
const invitationCode = ref('')
let countdownTimer: number | null = null

const storedEmailProvider = (): OAuthProvider => sessionStorage.getItem('email_oauth_pending_provider') === OAuthProvider.GOOGLE ? OAuthProvider.GOOGLE : OAuthProvider.GITHUB
const provider = computed(() => props.provider || storedEmailProvider())
const providerLabel = computed(() => ({
  [OAuthProvider.GITHUB]: 'GitHub', [OAuthProvider.GOOGLE]: 'Google', [OAuthProvider.LINUXDO]: 'LinuxDo',
  [OAuthProvider.DINGTALK]: '钉钉', [OAuthProvider.WECHAT]: '微信', [OAuthProvider.OIDC]: settings.value?.oidc_oauth_provider_name || 'OIDC',
})[provider.value])
const emailProvider = computed(() => provider.value === OAuthProvider.GITHUB || provider.value === OAuthProvider.GOOGLE)
const inlineCaptchaEnabled = computed(() => settings.value?.turnstile_enabled === true && Boolean(settings.value.turnstile_site_key))
const actionCaptchaEnabled = computed(() => settings.value?.tencent_captcha_enabled === true || settings.value?.aliyun_captcha_enabled === true)
const emailVerificationEnabled = computed(() => !emailProvider.value && settings.value?.email_verify_enabled !== false)
const invitationEnabled = computed(() => invitationRequired.value || settings.value?.invitation_code_enabled === true)
const currentUrl = computed(() => window.location.href)

function parseFragment(): URLSearchParams {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  return new URLSearchParams(raw)
}

function tokenFromFragment(params: URLSearchParams): OAuthCompletion | null {
  const accessToken = params.get('access_token')?.trim()
  if (!accessToken) return null
  const result: OAuthCompletion = { access_token: accessToken }
  const refreshToken = params.get('refresh_token')?.trim()
  const expires = Number.parseInt(params.get('expires_in') || '', 10)
  if (refreshToken) result.refresh_token = refreshToken
  if (Number.isFinite(expires) && expires > 0) result.expires_in = expires
  result.redirect = params.get('redirect') || undefined
  return result
}

function requestError(caught: unknown, fallback: string): string {
  const value = caught as { message?: string; response?: { data?: { detail?: string; message?: string } } }
  return value.response?.data?.detail || value.response?.data?.message || value.message || fallback
}

function extractEmail(completion: OAuthCompletion): string {
  return (completion.pending_email || completion.existing_account_email || completion.resolved_email || completion.email || completion.suggested_email || '').trim()
}

function adoptionDecision(): OAuthAdoptionDecision {
  return { adoptDisplayName: adoptDisplayName.value, adoptAvatar: adoptAvatar.value }
}

function serializedAdoption(): Record<string, boolean> {
  return { adopt_display_name: adoptDisplayName.value, adopt_avatar: adoptAvatar.value }
}

function persistPending(): void {
  auth.setPendingAuthSession({
    token: legacyPendingToken.value,
    token_field: 'pending_oauth_token',
    provider: provider.value,
    redirect: redirectTo.value,
    adoption_required: suggestedDisplayName.value !== '' || suggestedAvatar.value !== '',
    suggested_display_name: suggestedDisplayName.value || undefined,
    suggested_avatar_url: suggestedAvatar.value || undefined,
  })
}

async function finalize(completion: OAuthCompletion): Promise<void> {
  const redirect = sanitizeRedirectPath(completion.redirect, isOAuthLoginCompletion(completion) ? redirectTo.value : '/app/profile')
  if (isOAuthLoginCompletion(completion)) {
    persistOAuthTokenContext(completion)
    await auth.setToken(completion.access_token)
    clearAllAffiliateReferralCodes()
    app.showSuccess('第三方身份验证成功')
    await router.replace(redirect)
    return
  }
  auth.clearPendingAuthSession()
  clearAllAffiliateReferralCodes()
  app.showSuccess('第三方身份已绑定')
  await router.replace(redirect)
}

async function processCompletion(completion: OAuthCompletion): Promise<void> {
  redirectTo.value = sanitizeRedirectPath(completion.redirect || route.query.redirect, '/app/dashboard')
  const nextProvider = String(completion.provider || '').toLowerCase()
  if ((nextProvider === OAuthProvider.GITHUB || nextProvider === OAuthProvider.GOOGLE) && !props.provider) sessionStorage.setItem('email_oauth_pending_provider', nextProvider)
  suggestedDisplayName.value = completion.suggested_display_name || ''
  suggestedAvatar.value = completion.suggested_avatar_url || ''
  if (!suggestedDisplayName.value) adoptDisplayName.value = false
  if (!suggestedAvatar.value) adoptAvatar.value = false
  const email = extractEmail(completion)
  if (email) { createForm.email = email; bindForm.email = email }

  if (completion.error === 'invitation_required') {
    invitationRequired.value = true
    action.value = emailProvider.value ? OAuthPendingAction.CREATE_ACCOUNT : OAuthPendingAction.INVITATION
    processing.value = false; persistPending(); return
  }
  if (completion.error === 'registration_completion_required') {
    invitationRequired.value = completion.invitation_required === true
    action.value = OAuthPendingAction.CREATE_ACCOUNT
    processing.value = false; persistPending(); return
  }
  if (completion.requires_2fa === true && completion.temp_token) {
    totpToken.value = completion.temp_token
    totpEmail.value = completion.user_email_masked || ''
    action.value = OAuthPendingAction.TOTP
    processing.value = false; persistPending(); return
  }

  const pendingAction = normalizePendingOAuthAction(completion.step || completion.status || completion.state || completion.error || completion.intent)
  if (pendingAction !== OAuthPendingAction.NONE) {
    action.value = pendingAction
    processing.value = false; persistPending(); return
  }
  if (completion.adoption_required === true && (suggestedDisplayName.value || suggestedAvatar.value)) {
    action.value = OAuthPendingAction.ADOPTION
    processing.value = false; persistPending(); return
  }
  if (completion.auth_result === 'pending_session') {
    if (props.forceCreate) action.value = OAuthPendingAction.CREATE_ACCOUNT
    else pendingWait.value = true
    processing.value = false; persistPending(); return
  }
  if (props.forceCreate && !isOAuthLoginCompletion(completion)) {
    action.value = OAuthPendingAction.CREATE_ACCOUNT
    processing.value = false; persistPending(); return
  }
  await finalize(completion)
}

async function resume(decision?: OAuthAdoptionDecision): Promise<void> {
  processing.value = true; pendingWait.value = false; error.value = ''
  try { await processCompletion(await exchangePendingOAuthCompletion(decision) as OAuthCompletion) }
  catch (caught) { auth.clearPendingAuthSession(); error.value = requestError(caught, '无法完成第三方登录'); processing.value = false }
}

async function submitInvitation(): Promise<void> {
  if (!invitationCode.value.trim()) { error.value = '请输入邀请码'; return }
  submitting.value = true; error.value = ''
  try {
    const { data } = await apiClient.post<OAuthCompletion>(`/auth/oauth/${provider.value}/complete-registration`, {
      pending_oauth_token: legacyPendingToken.value || undefined,
      invitation_code: invitationCode.value.trim(),
      ...oauthAffiliatePayload(loadOAuthAffiliateCode()), ...serializedAdoption(),
    })
    await processCompletion(data)
  } catch (caught) { error.value = requestError(caught, '邀请码验证失败') }
  finally { submitting.value = false }
}

function resetCaptcha(): void { captchaRef.value?.reset(); captchaToken.value = ''; captchaRandstr.value = '' }
async function acquireCaptcha(): Promise<boolean> {
  if (!actionCaptchaEnabled.value) return true
  const proof = await captchaRef.value?.verifyAction(); if (!proof) return false
  captchaToken.value = proof.token; captchaRandstr.value = proof.randstr; return true
}
function captchaPayload(): Record<string, string | undefined> {
  if (settings.value?.tencent_captcha_enabled) return { tencent_captcha_ticket: captchaToken.value || undefined, tencent_captcha_randstr: captchaRandstr.value || undefined }
  return { turnstile_token: captchaToken.value || undefined }
}
function startCountdown(seconds: number): void {
  countdown.value = seconds || 60
  if (countdownTimer) window.clearInterval(countdownTimer)
  countdownTimer = window.setInterval(() => { countdown.value -= 1; if (countdown.value <= 0 && countdownTimer) { window.clearInterval(countdownTimer); countdownTimer = null } }, 1000)
}

async function sendCode(): Promise<void> {
  error.value = ''
  if (!emailIsValid(createForm.email)) { error.value = '请输入有效邮箱'; return }
  if (!(await acquireCaptcha())) return
  if (inlineCaptchaEnabled.value && !captchaToken.value) { error.value = '请先完成人机验证'; return }
  sendingCode.value = true
  try { const response = await sendPendingOAuthVerifyCode({ email: createForm.email.trim(), ...captchaPayload() }); startCountdown(response.countdown); app.showSuccess('验证码已发送') }
  catch (caught) { error.value = requestError(caught, '验证码发送失败') }
  finally { sendingCode.value = false; resetCaptcha() }
}

async function createAccount(): Promise<void> {
  error.value = ''
  if (!emailIsValid(createForm.email)) { error.value = '请输入有效邮箱'; return }
  const passwordError = passwordValidationMessage(createForm.password, createForm.confirmation)
  if (passwordError) { error.value = passwordError; return }
  if (emailVerificationEnabled.value && !/^\d{6}$/.test(createForm.verifyCode.trim())) { error.value = '请输入 6 位邮箱验证码'; return }
  if (invitationEnabled.value && !createForm.invitationCode.trim()) { error.value = '请输入邀请码'; return }
  if (!emailProvider.value && !(await acquireCaptcha())) return
  if (!emailProvider.value && inlineCaptchaEnabled.value && !captchaToken.value) { error.value = '请先完成人机验证'; return }
  submitting.value = true
  try {
    const payload: Record<string, unknown> = {
      pending_oauth_token: legacyPendingToken.value || undefined,
      password: createForm.password,
      invitation_code: createForm.invitationCode.trim() || undefined,
      ...oauthAffiliatePayload(loadOAuthAffiliateCode()), ...serializedAdoption(),
    }
    if (!emailProvider.value) {
      payload.email = createForm.email.trim()
      payload.verify_code = createForm.verifyCode.trim() || undefined
      Object.assign(payload, captchaPayload())
    }
    const path = emailProvider.value ? `/auth/oauth/${provider.value}/complete-registration` : '/auth/oauth/pending/create-account'
    const { data } = await apiClient.post<OAuthCompletion>(path, payload)
    if (data.step === 'choose_account_action_required' || data.existing_account_bindable === true) {
      bindForm.email = createForm.email.trim(); action.value = OAuthPendingAction.BIND_LOGIN; return
    }
    await processCompletion(data)
  } catch (caught) {
    const response = caught as { response?: { data?: { reason?: string; step?: string } } }
    if (['REGISTRATION_DISABLED', 'email_exists', 'bind_login_required'].includes(response.response?.data?.reason || response.response?.data?.step || '')) {
      bindForm.email = createForm.email.trim(); action.value = OAuthPendingAction.BIND_LOGIN
    } else error.value = requestError(caught, '账号创建失败')
  } finally { submitting.value = false; resetCaptcha() }
}

async function bindLogin(): Promise<void> {
  error.value = ''
  if (!emailIsValid(bindForm.email) || !bindForm.password) { error.value = '请输入已有账号的邮箱和密码'; return }
  submitting.value = true
  try {
    const { data } = await apiClient.post<OAuthCompletion>('/auth/oauth/pending/bind-login', {
      email: bindForm.email.trim(), password: bindForm.password, ...serializedAdoption(),
    })
    await processCompletion(data)
  } catch (caught) { error.value = requestError(caught, '已有账号验证失败') }
  finally { submitting.value = false }
}

async function submitTotp(): Promise<void> {
  error.value = ''
  if (!/^\d{6}$/.test(totpCode.value.trim())) { error.value = '请输入 6 位动态验证码'; return }
  submitting.value = true
  try { await auth.login2FA(totpToken.value, totpCode.value.trim()); clearAllAffiliateReferralCodes(); await router.replace(redirectTo.value) }
  catch (caught) { error.value = requestError(caught, '动态验证码无效') }
  finally { submitting.value = false }
}

async function copyUrl(): Promise<void> {
  try { await navigator.clipboard.writeText(currentUrl.value); app.showSuccess('回调地址已复制') }
  catch { error.value = '无法访问剪贴板，请手动复制地址栏' }
}

function forwardEmailProviderCallback(): boolean {
  if (!emailProvider.value || typeof route.query.code !== 'string' || typeof route.query.state !== 'string') return false
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(route.query)) {
    if (Array.isArray(value)) value.forEach((item) => item != null && params.append(key, String(item)))
    else if (value != null) params.set(key, String(value))
  }
  window.location.assign(`${buildApiUrl(`/auth/oauth/${provider.value}/callback`)}?${params.toString()}`)
  return true
}

onMounted(async () => {
  createForm.email = typeof route.query.email === 'string' ? route.query.email.trim() : ''
  bindForm.email = createForm.email
  redirectTo.value = sanitizeRedirectPath(route.query.redirect, '/app/dashboard')
  void getPublicSettings().then((value) => { settings.value = value }).catch(() => undefined)
  const params = parseFragment()
  const fragmentToken = tokenFromFragment(params)
  const fragmentError = params.get('error') || (typeof route.query.error === 'string' ? route.query.error : '')
  const fragmentDescription = params.get('error_description') || params.get('error_message') || (typeof route.query.error_description === 'string' ? route.query.error_description : '')
  legacyPendingToken.value = params.get('pending_oauth_token')?.trim() || ''
  if (fragmentToken) { redirectTo.value = sanitizeRedirectPath(fragmentToken.redirect, redirectTo.value); await finalize(fragmentToken); return }
  if (fragmentError === 'invitation_required' && legacyPendingToken.value) {
    invitationRequired.value = true; action.value = emailProvider.value ? OAuthPendingAction.CREATE_ACCOUNT : OAuthPendingAction.INVITATION; processing.value = false; persistPending(); return
  }
  if (fragmentError) { error.value = fragmentDescription || fragmentError; processing.value = false; return }
  if (forwardEmailProviderCallback()) return
  if (props.forceCreate) {
    action.value = OAuthPendingAction.CREATE_ACCOUNT
    processing.value = false
    persistPending()
    return
  }
  await resume()
})
onBeforeUnmount(() => { if (countdownTimer) window.clearInterval(countdownTimer) })
</script>

<template>
  <PublicAuthLayout eyebrow="OAUTH CALLBACK" :title="`完成 ${providerLabel} 验证`" description="授权结果会在这里完成登录、绑定或账号补全；失败时无需重新开始整个流程。" compact>
    <div v-if="processing" class="public-state-inline"><span class="public-spinner" />正在交换安全会话…</div>
    <div v-else-if="error && action === OAuthPendingAction.NONE" class="public-state-inline public-state-inline--warning"><strong>授权未完成</strong><span>{{ error }}</span><div class="public-inline-actions"><button class="button button--secondary" @click="copyUrl">复制回调地址</button><RouterLink class="button button--primary" to="/login">重新登录</RouterLink></div></div>
    <div v-else-if="pendingWait" class="public-state-inline"><strong>授权会话仍在处理中</strong><span>可以安全重试交换，不会创建重复账号。</span><button class="button button--primary" @click="resume()">重试完成授权</button></div>

    <div v-else-if="action === OAuthPendingAction.CHOOSE_ACCOUNT" class="public-action-choice"><strong>这个身份可以创建新账号，也可以绑定已有账号</strong><span>选择后仍可在下一步返回。</span><div class="public-inline-actions"><button class="button button--secondary" @click="action = OAuthPendingAction.BIND_LOGIN">绑定已有账号</button><button class="button button--primary" @click="action = OAuthPendingAction.CREATE_ACCOUNT">创建新账号</button></div></div>

    <form v-else-if="action === OAuthPendingAction.CREATE_ACCOUNT" class="public-form-stack" @submit.prevent="createAccount">
      <p class="public-form-hint">补全邮箱和密码后，{{ providerLabel }} 将成为这个账号的登录方式。</p>
      <label>邮箱<input v-model="createForm.email" type="email" autocomplete="email" :readonly="emailProvider" /></label>
      <div class="public-form-grid"><label>密码<input v-model="createForm.password" type="password" autocomplete="new-password" /></label><label>确认密码<input v-model="createForm.confirmation" type="password" autocomplete="new-password" /></label></div>
      <div v-if="emailVerificationEnabled" class="public-field-action"><label>邮箱验证码<input v-model="createForm.verifyCode" inputmode="numeric" maxlength="6" /></label><button class="button button--secondary" type="button" :disabled="sendingCode || countdown > 0" @click="sendCode">{{ countdown > 0 ? `${countdown}s` : sendingCode ? '发送中…' : '发送验证码' }}</button></div>
      <label v-if="invitationEnabled">邀请码<input v-model="createForm.invitationCode" /></label>
      <CaptchaChallenge v-if="!emailProvider" ref="captchaRef" :turnstile-enabled="settings?.turnstile_enabled === true" :turnstile-site-key="settings?.turnstile_site_key || ''" :tencent-enabled="settings?.tencent_captcha_enabled === true" :tencent-app-id="settings?.tencent_captcha_app_id || ''" :tencent-region="settings?.tencent_captcha_region || 'cn'" :aliyun-enabled="settings?.aliyun_captcha_enabled === true" :aliyun-scene-id="settings?.aliyun_captcha_scene_id || ''" :aliyun-prefix="settings?.aliyun_captcha_prefix || ''" :aliyun-region="settings?.aliyun_captcha_region || 'cn'" @verify="(token: string, randstr: string) => { captchaToken = token; captchaRandstr = randstr }" @expire="resetCaptcha" @error="error = '人机验证失败'" />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button--primary" :disabled="submitting" type="submit">{{ submitting ? '创建中…' : '创建并继续' }}</button><button class="button button--ghost" type="button" @click="bindForm.email = createForm.email; action = OAuthPendingAction.BIND_LOGIN">我已有账号</button>
    </form>

    <form v-else-if="action === OAuthPendingAction.BIND_LOGIN" class="public-form-stack" @submit.prevent="bindLogin"><p class="public-form-hint">验证已有账号密码后，将 {{ providerLabel }} 身份绑定到该账号。</p><label>已有账号邮箱<input v-model="bindForm.email" type="email" autocomplete="email" /></label><label>账号密码<input v-model="bindForm.password" type="password" autocomplete="current-password" /></label><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button button--primary" :disabled="submitting" type="submit">{{ submitting ? '验证中…' : '验证并绑定' }}</button><button class="button button--ghost" type="button" @click="createForm.email = bindForm.email; action = OAuthPendingAction.CREATE_ACCOUNT">改为创建新账号</button></form>

    <form v-else-if="action === OAuthPendingAction.INVITATION" class="public-form-stack" @submit.prevent="submitInvitation"><p class="public-form-hint">当前注册策略要求邀请码。验证成功后会继续刚才的授权。</p><label>邀请码<input v-model="invitationCode" autocomplete="one-time-code" /></label><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button button--primary" :disabled="submitting" type="submit">{{ submitting ? '验证中…' : '验证邀请码' }}</button></form>

    <form v-else-if="action === OAuthPendingAction.TOTP" class="public-form-stack" @submit.prevent="submitTotp"><p class="public-form-hint">{{ totpEmail ? `${totpEmail} 已启用双重验证` : '该账号已启用双重验证' }}</p><label>6 位动态验证码<input v-model="totpCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" /></label><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button button--primary" :disabled="submitting" type="submit">{{ submitting ? '验证中…' : '验证并登录' }}</button></form>

    <div v-else-if="action === OAuthPendingAction.ADOPTION" class="public-action-choice"><strong>采用第三方资料？</strong><span>你可以决定是否更新现有账号资料，不影响身份绑定。</span><label v-if="suggestedDisplayName" class="public-check"><input v-model="adoptDisplayName" type="checkbox" />采用显示名称：{{ suggestedDisplayName }}</label><label v-if="suggestedAvatar" class="public-check"><input v-model="adoptAvatar" type="checkbox" />采用第三方头像</label><button class="button button--primary" :disabled="submitting" @click="resume(adoptionDecision())">确认并继续</button></div>
    <template #footer><RouterLink to="/login">返回登录</RouterLink></template>
  </PublicAuthLayout>
</template>
