<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CaptchaChallenge from '@/components/auth/CaptchaChallenge.vue'
import {
  buildOAuthLoginStartURL,
  getPublicSettings,
  resolveWeChatOAuthStartStrict,
  sendVerifyCode,
  startOAuthLogin,
  validateInvitationCode,
  validatePromoCode,
  type OAuthLoginProvider,
} from '@/api/auth'
import type { LoginAgreementDocument, PublicSettings, RegisterRequest } from '@/types'
import {
  clearAllAffiliateReferralCodes,
  resolveAffiliateReferralCode,
  storeOAuthAffiliateCode,
} from '@shared-utils/oauthAffiliate'
import {
  formatRegistrationEmailSuffixWhitelistForMessage,
  isRegistrationEmailSuffixAllowed,
  normalizeRegistrationEmailSuffixWhitelist,
} from '@shared-utils/registrationEmailPolicy'
import PublicAuthLayout from '@/components/auth/PublicAuthLayout.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { AsyncValidationState, OAuthProvider, emailIsValid, passwordValidationMessage } from '@/features/public/model'

interface CaptchaController {
  reset(): void
  verifyAction(): Promise<{ token: string; randstr: string } | null>
}

const route = useRoute()
const AGREEMENT_STORAGE_KEY = 'sub2api_login_agreement_consent'
const EMAIL_PROVIDER_STORAGE_KEY = 'email_oauth_pending_provider'
const router = useRouter()
const app = useAppStore()
const auth = useAuthStore()
const settings = ref<PublicSettings | null>(null)
const loading = ref(true)
const submitting = ref(false)
const sendingCode = ref(false)
const countdown = ref(0)
const error = ref('')
const captchaRef = ref<CaptchaController | null>(null)
const captchaToken = ref('')
const captchaRandstr = ref('')
const oauthLoading = ref<OAuthProvider | null>(null)
const invitationState = ref(AsyncValidationState.IDLE)
const promoState = ref(AsyncValidationState.IDLE)
const promoMessage = ref('')
let countdownTimer: number | null = null
const agreementOpen = ref(false)
const form = reactive({ email: '', password: '', confirmation: '', verifyCode: '', invitationCode: '', affiliateCode: '', promoCode: '' })

const actionCaptchaEnabled = computed(() => settings.value?.tencent_captcha_enabled === true || settings.value?.aliyun_captcha_enabled === true)
const inlineCaptchaEnabled = computed(() => settings.value?.turnstile_enabled === true && Boolean(settings.value.turnstile_site_key))
const registrationEnabled = computed(() => settings.value?.registration_enabled !== false)
const backendMode = computed(() => settings.value?.backend_mode_enabled === true)
const agreementDocuments = computed<LoginAgreementDocument[]>(() => settings.value?.login_agreement_documents?.filter((item) => item.title?.trim()) || [])
const agreementRequired = computed(() => settings.value?.login_agreement_enabled === true && agreementDocuments.value.length > 0)
const agreementMode = computed(() => settings.value?.login_agreement_mode === 'checkbox' ? 'checkbox' : 'modal')
const agreementRevision = computed(() => settings.value?.login_agreement_revision || `${settings.value?.login_agreement_updated_at || ''}:${agreementDocuments.value.map((item) => `${item.id}:${item.title}`).join('|')}`)
const agreementBlocked = computed(() => agreementRequired.value && !agreementAccepted.value)
const agreementAccepted = ref(false)
const emailWhitelist = computed(() => normalizeRegistrationEmailSuffixWhitelist(settings.value?.registration_email_suffix_whitelist || []))
const enforceEmailWhitelist = computed(() => settings.value?.registration_email_domain_quota_enabled !== true)
const wechatStart = computed(() => resolveWeChatOAuthStartStrict(settings.value))
const oauthProviders = computed(() => {
  if (backendMode.value) return []
  const providers: Array<{ id: OAuthProvider; label: string; enabled: boolean }> = [
    { id: OAuthProvider.GITHUB, label: 'GitHub', enabled: settings.value?.github_oauth_enabled === true },
    { id: OAuthProvider.GOOGLE, label: 'Google', enabled: settings.value?.google_oauth_enabled === true },
    { id: OAuthProvider.LINUXDO, label: 'LinuxDo', enabled: settings.value?.linuxdo_oauth_enabled === true },
    { id: OAuthProvider.DINGTALK, label: '钉钉', enabled: settings.value?.dingtalk_oauth_enabled === true },
    { id: OAuthProvider.WECHAT, label: '微信', enabled: settings.value?.wechat_oauth_enabled === true && wechatStart.value.mode !== null },
    { id: OAuthProvider.OIDC, label: settings.value?.oidc_oauth_provider_name || 'OIDC', enabled: settings.value?.oidc_oauth_enabled === true },
  ]
  return providers.filter((item) => item.enabled)
})

function resetCaptcha(): void {
  captchaRef.value?.reset(); captchaToken.value = ''; captchaRandstr.value = ''
}

function hasStoredAgreement(): boolean {
  try {
    const raw = localStorage.getItem(AGREEMENT_STORAGE_KEY)
    return Boolean(raw && (JSON.parse(raw) as { revision?: string }).revision === agreementRevision.value)
  } catch { return false }
}

function acceptAgreement(): void {
  if (agreementRevision.value) {
    localStorage.setItem(AGREEMENT_STORAGE_KEY, JSON.stringify({ revision: agreementRevision.value, accepted_at: new Date().toISOString() }))
  }
  agreementAccepted.value = true
  agreementOpen.value = false
  error.value = ''
}

function rejectAgreement(): void {
  localStorage.removeItem(AGREEMENT_STORAGE_KEY)
  agreementAccepted.value = false
  agreementOpen.value = false
}

function requireAgreement(): boolean {
  if (!agreementBlocked.value) return true
  error.value = '请先阅读并同意登录与注册协议'
  if (agreementMode.value === 'modal') agreementOpen.value = true
  return false
}

function emailPolicyMessage(): string {
  if (!emailWhitelist.value.length) return '该邮箱域名不允许注册'
  return `仅支持以下邮箱域名：${formatRegistrationEmailSuffixWhitelistForMessage(emailWhitelist.value, { separator: '、', more: (count) => `等 ${count} 项` })}`
}

async function acquireActionCaptcha(): Promise<boolean> {
  if (!actionCaptchaEnabled.value) return true
  const proof = await captchaRef.value?.verifyAction()
  if (!proof) return false
  captchaToken.value = proof.token; captchaRandstr.value = proof.randstr
  return true
}

function captchaPayload(): Pick<RegisterRequest, 'turnstile_token' | 'tencent_captcha_ticket' | 'tencent_captcha_randstr'> {
  if (settings.value?.tencent_captcha_enabled) return { tencent_captcha_ticket: captchaToken.value || undefined, tencent_captcha_randstr: captchaRandstr.value || undefined }
  if (inlineCaptchaEnabled.value || settings.value?.aliyun_captcha_enabled) return { turnstile_token: captchaToken.value || undefined }
  return {}
}

async function checkInvitation(): Promise<void> {
  if (!form.invitationCode.trim()) { invitationState.value = AsyncValidationState.IDLE; return }
  invitationState.value = AsyncValidationState.CHECKING
  try { invitationState.value = (await validateInvitationCode(form.invitationCode.trim())).valid ? AsyncValidationState.VALID : AsyncValidationState.INVALID }
  catch { invitationState.value = AsyncValidationState.INVALID }
}

async function checkPromo(): Promise<void> {
  if (!form.promoCode.trim()) { promoState.value = AsyncValidationState.IDLE; promoMessage.value = ''; return }
  promoState.value = AsyncValidationState.CHECKING
  try {
    const result = await validatePromoCode(form.promoCode.trim())
    promoState.value = result.valid ? AsyncValidationState.VALID : AsyncValidationState.INVALID
    promoMessage.value = result.valid ? `有效${result.bonus_amount ? ` · 注册赠送 $${result.bonus_amount}` : ''}` : (result.message || '促销码无效')
  } catch { promoState.value = AsyncValidationState.INVALID; promoMessage.value = '促销码校验失败' }
}

async function startOAuth(provider: OAuthProvider): Promise<void> {
  error.value = ''
  if (!requireAgreement() || oauthLoading.value !== null) return
  const affiliate = form.affiliateCode.trim() || resolveAffiliateReferralCode(route.query.aff, route.query.aff_code)
  const params: Record<string, string> = { redirect: '/app/dashboard' }
  if (affiliate) params.aff_code = affiliate
  storeOAuthAffiliateCode(affiliate)
  if (provider === OAuthProvider.WECHAT) {
    if (!wechatStart.value.mode) { error.value = '当前浏览器无法使用已配置的微信登录方式'; return }
    params.mode = wechatStart.value.mode
  }
  if (provider === OAuthProvider.GITHUB || provider === OAuthProvider.GOOGLE) sessionStorage.setItem(EMAIL_PROVIDER_STORAGE_KEY, provider)
  const request = { provider: provider as OAuthLoginProvider, params }
  if (!actionCaptchaEnabled.value) {
    window.location.assign(buildOAuthLoginStartURL(request))
    return
  }
  oauthLoading.value = provider
  try {
    if (!(await acquireActionCaptcha())) return
    const proof = settings.value?.tencent_captcha_enabled
      ? { tencent_captcha_ticket: captchaToken.value, tencent_captcha_randstr: captchaRandstr.value }
      : { turnstile_token: captchaToken.value }
    const response = await startOAuthLogin(request, proof)
    window.location.assign(response.authorize_url)
  } catch (caught) { error.value = (caught as { message?: string }).message || '第三方注册启动失败' }
  finally { oauthLoading.value = null; resetCaptcha() }
}

async function sendCode(): Promise<void> {
  error.value = ''
  if (!emailIsValid(form.email)) { error.value = '请输入有效邮箱'; return }
  if (!(await acquireActionCaptcha())) return
  if (inlineCaptchaEnabled.value && !captchaToken.value) { error.value = '请先完成人机验证'; return }
  sendingCode.value = true
  try {
    const response = await sendVerifyCode({ email: form.email.trim(), ...captchaPayload() })
    countdown.value = response.countdown || 60
    if (countdownTimer) window.clearInterval(countdownTimer)
    countdownTimer = window.setInterval(() => { countdown.value -= 1; if (countdown.value <= 0 && countdownTimer) { window.clearInterval(countdownTimer); countdownTimer = null } }, 1000)
    app.showSuccess('验证码已发送')
  } catch (caught) { error.value = (caught as { message?: string }).message || '验证码发送失败' }
  finally { sendingCode.value = false; if (actionCaptchaEnabled.value) resetCaptcha() }
}

async function submit(): Promise<void> {
  error.value = ''
  if (!registrationEnabled.value) return
  if (!requireAgreement()) return
  if (!emailIsValid(form.email)) { error.value = '请输入有效邮箱'; return }
  if (enforceEmailWhitelist.value && !isRegistrationEmailSuffixAllowed(form.email, emailWhitelist.value)) { error.value = emailPolicyMessage(); return }
  const passwordError = passwordValidationMessage(form.password, form.confirmation)
  if (passwordError) { error.value = passwordError; return }
  if (settings.value?.email_verify_enabled && !form.verifyCode.trim()) { error.value = '请输入邮箱验证码'; return }
  if (settings.value?.invitation_code_enabled && (!form.invitationCode.trim() || invitationState.value === AsyncValidationState.INVALID)) { error.value = '请输入有效邀请码'; return }
  if (form.promoCode.trim() && promoState.value === AsyncValidationState.INVALID) { error.value = '请修正促销码'; return }
  if (!(await acquireActionCaptcha())) return
  if (inlineCaptchaEnabled.value && !captchaToken.value) { error.value = '请先完成人机验证'; return }
  submitting.value = true
  try {
    const affiliate = form.affiliateCode.trim() || resolveAffiliateReferralCode(route.query.aff, route.query.aff_code)
    await auth.register({
      email: form.email.trim(), password: form.password,
      verify_code: form.verifyCode.trim() || undefined,
      invitation_code: form.invitationCode.trim() || undefined,
      promo_code: form.promoCode.trim() || undefined,
      aff_code: affiliate || undefined,
      ...captchaPayload(),
    })
    clearAllAffiliateReferralCodes()
    app.showSuccess('账号创建成功')
    await router.replace(auth.isAdmin ? '/admin/dashboard' : '/app/dashboard')
  } catch (caught) { error.value = (caught as { message?: string }).message || '注册失败，请检查填写内容' }
  finally { submitting.value = false; resetCaptcha() }
}

onMounted(async () => {
  try {
    settings.value = await getPublicSettings()
    form.affiliateCode = resolveAffiliateReferralCode(route.query.aff, route.query.aff_code)
    if (settings.value.promo_code_enabled && typeof route.query.promo === 'string') {
      form.promoCode = route.query.promo.trim()
      if (form.promoCode) await checkPromo()
    }
    agreementAccepted.value = !agreementRequired.value || hasStoredAgreement()
    agreementOpen.value = agreementBlocked.value && agreementMode.value === 'modal'
  }
  catch (caught) {
    agreementAccepted.value = true
    error.value = (caught as { message?: string }).message || '公开设置加载失败'
  }
  finally { loading.value = false }
})
onBeforeUnmount(() => { if (countdownTimer) window.clearInterval(countdownTimer) })
</script>

<template>
  <PublicAuthLayout eyebrow="CREATE ACCOUNT" title="创建你的工作区" description="邮箱、邀请码、促销权益和安全验证在一个清晰流程里完成。">
    <div v-if="loading" class="public-state-inline">正在加载注册策略…</div>
    <div v-else-if="!registrationEnabled" class="public-state-inline public-state-inline--warning"><strong>当前未开放注册</strong><span>请联系管理员创建账号，或使用已绑定的第三方身份登录。</span><RouterLink class="button button--primary" to="/login">返回登录</RouterLink></div>
    <form v-else class="public-form-stack" @submit.prevent="submit">
      <label>邮箱<input v-model="form.email" type="email" required autocomplete="email" placeholder="name@example.com" /><small v-if="enforceEmailWhitelist && emailWhitelist.length">允许 {{ formatRegistrationEmailSuffixWhitelistForMessage(emailWhitelist, { separator: '、', more: (count: number) => `等 ${count} 项` }) }}</small></label>
      <div class="public-form-grid"><label>密码<input v-model="form.password" type="password" required autocomplete="new-password" placeholder="至少 6 位" /></label><label>确认密码<input v-model="form.confirmation" type="password" required autocomplete="new-password" /></label></div>
      <div v-if="settings?.email_verify_enabled" class="public-field-action"><label>邮箱验证码<input v-model="form.verifyCode" inputmode="numeric" autocomplete="one-time-code" /></label><button class="button button--secondary" type="button" :disabled="sendingCode || countdown > 0" @click="sendCode">{{ countdown > 0 ? `${countdown}s 后重发` : sendingCode ? '发送中…' : '发送验证码' }}</button></div>
      <div v-if="settings?.invitation_code_enabled" class="public-field-feedback"><label>邀请码<input v-model="form.invitationCode" required @blur="checkInvitation" /></label><span :data-state="invitationState">{{ invitationState === AsyncValidationState.CHECKING ? '校验中…' : invitationState === AsyncValidationState.VALID ? '邀请码有效' : invitationState === AsyncValidationState.INVALID ? '邀请码无效' : '注册策略要求邀请码' }}</span></div>
      <label v-else-if="settings?.affiliate_enabled">邀请 / 返利码（可选）<input v-model="form.affiliateCode" autocomplete="off" /></label>
      <div v-if="settings?.promo_code_enabled" class="public-field-feedback"><label>促销码（可选）<input v-model="form.promoCode" @blur="checkPromo" /></label><span :data-state="promoState">{{ promoMessage || '可在注册时领取促销权益' }}</span></div>
      <CaptchaChallenge ref="captchaRef" :turnstile-enabled="settings?.turnstile_enabled === true" :turnstile-site-key="settings?.turnstile_site_key || ''" :tencent-enabled="settings?.tencent_captcha_enabled === true" :tencent-app-id="settings?.tencent_captcha_app_id || ''" :tencent-region="settings?.tencent_captcha_region || 'cn'" :aliyun-enabled="settings?.aliyun_captcha_enabled === true" :aliyun-scene-id="settings?.aliyun_captcha_scene_id || ''" :aliyun-prefix="settings?.aliyun_captcha_prefix || ''" :aliyun-region="settings?.aliyun_captcha_region || 'cn'" @verify="(token: string, randstr: string) => { captchaToken = token; captchaRandstr = randstr }" @expire="resetCaptcha" @error="error = '人机验证失败，请重试'" />
      <label v-if="agreementRequired && agreementMode === 'checkbox'" class="public-check"><input :checked="agreementAccepted" type="checkbox" @change="($event.target as HTMLInputElement).checked ? acceptAgreement() : rejectAgreement()" />我已阅读并同意 <span><RouterLink v-for="(document, index) in agreementDocuments" :key="document.id" :to="`/legal/${document.id}`" target="_blank">{{ index ? `、${document.title}` : document.title }}</RouterLink></span></label>
      <div v-else-if="agreementRequired && !agreementAccepted" class="public-agreement-notice"><span>创建账号前需要确认最新协议</span><button type="button" @click="agreementOpen = true">查看并同意</button></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button--primary" :disabled="submitting || agreementBlocked || (inlineCaptchaEnabled && !captchaToken)" type="submit">{{ submitting ? '正在创建…' : '创建账号' }}</button>
    </form>

    <template v-if="!loading && oauthProviders.length">
      <div v-if="!registrationEnabled && agreementRequired" class="public-agreement-notice"><span>{{ agreementAccepted ? '协议已确认' : '使用第三方身份前需要确认最新协议' }}</span><button v-if="!agreementAccepted" type="button" @click="agreementOpen = true">查看并同意</button></div>
      <div class="public-divider"><span>或使用第三方身份继续</span></div>
      <div class="oauth-provider-grid"><button v-for="provider in oauthProviders" :key="provider.id" class="oauth-provider" :disabled="oauthLoading !== null || agreementBlocked" type="button" @click="startOAuth(provider.id)"><span>{{ provider.id === OAuthProvider.GITHUB ? 'GH' : provider.id === OAuthProvider.GOOGLE ? 'G' : provider.id === OAuthProvider.WECHAT ? '微' : provider.id === OAuthProvider.DINGTALK ? '钉' : '↗' }}</span>{{ oauthLoading === provider.id ? '正在跳转…' : provider.label }}</button></div>
      <p v-if="!registrationEnabled && error" class="form-error" role="alert">{{ error }}</p>
    </template>
    <template #footer>已有账号？ <RouterLink to="/login">直接登录</RouterLink></template>
  </PublicAuthLayout>

  <SurfaceDialog :show="agreementOpen" title="登录与注册协议" :description="settings?.login_agreement_updated_at ? `更新于 ${settings.login_agreement_updated_at}` : '请阅读相关文档后继续'" @close="agreementOpen = false">
    <div class="agreement-document-list"><RouterLink v-for="document in agreementDocuments" :key="document.id" :to="`/legal/${document.id}`" target="_blank"><strong>{{ document.title }}</strong><span>在新窗口查看 ↗</span></RouterLink></div>
    <template #footer><button class="button button--secondary" @click="rejectAgreement">暂不接受</button><button class="button button--primary" @click="acceptAgreement">同意并继续</button></template>
  </SurfaceDialog>
</template>
