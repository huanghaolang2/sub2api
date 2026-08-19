<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CaptchaChallenge from '@/components/auth/CaptchaChallenge.vue'
import {
  buildOAuthLoginStartURL,
  getPublicSettings,
  isTotp2FARequired,
  resolveWeChatOAuthStartStrict,
  startOAuthLogin,
  type OAuthLoginProvider,
} from '@/api/auth'
import type { ActionCaptchaRequestProof, LoginAgreementDocument, PublicSettings } from '@/types'
import { clearAllAffiliateReferralCodes, resolveAffiliateReferralCode, storeOAuthAffiliateCode } from '@shared-utils/oauthAffiliate'
import PublicAuthLayout from '@/components/auth/PublicAuthLayout.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { OAuthProvider, emailIsValid, passwordValidationMessage, sanitizeRedirectPath } from '@/features/public/model'

interface CaptchaController {
  reset(): void
  verifyAction(): Promise<{ token: string; randstr: string } | null>
}

const AGREEMENT_STORAGE_KEY = 'sub2api_login_agreement_consent'
const EMAIL_PROVIDER_STORAGE_KEY = 'email_oauth_pending_provider'
const route = useRoute()
const router = useRouter()
const app = useAppStore()
const auth = useAuthStore()
const settings = ref<PublicSettings | null>(null)
const settingsLoading = ref(true)
const loading = ref(false)
const passkeyLoading = ref(false)
const oauthLoading = ref<OAuthProvider | null>(null)
const error = ref('')
const showPassword = ref(false)
const captchaRef = ref<CaptchaController | null>(null)
const captchaToken = ref('')
const captchaRandstr = ref('')
const totpOpen = ref(false)
const totpSubmitting = ref(false)
const totpToken = ref('')
const totpEmail = ref('')
const totpCode = ref('')
const agreementAccepted = ref(false)
const agreementOpen = ref(false)
const form = reactive({ email: '', password: '' })

const redirect = computed(() => sanitizeRedirectPath(route.query.redirect, auth.isAdmin ? '/admin/dashboard' : '/app/dashboard'))
const agreementDocuments = computed<LoginAgreementDocument[]>(() => settings.value?.login_agreement_documents?.filter((item) => item.title?.trim()) || [])
const agreementEnabled = computed(() => settings.value?.login_agreement_enabled === true && agreementDocuments.value.length > 0)
const agreementMode = computed(() => settings.value?.login_agreement_mode === 'checkbox' ? 'checkbox' : 'modal')
const agreementRevision = computed(() => settings.value?.login_agreement_revision || `${settings.value?.login_agreement_updated_at || ''}:${agreementDocuments.value.map((item) => `${item.id}:${item.title}`).join('|')}`)
const agreementBlocked = computed(() => agreementEnabled.value && !agreementAccepted.value)
const inlineCaptchaEnabled = computed(() => settings.value?.turnstile_enabled === true && Boolean(settings.value.turnstile_site_key))
const actionCaptchaEnabled = computed(() => (
  settings.value?.tencent_captcha_enabled === true && Boolean(settings.value.tencent_captcha_app_id)
) || (
  settings.value?.aliyun_captcha_enabled === true && Boolean(settings.value.aliyun_captcha_scene_id) && Boolean(settings.value.aliyun_captcha_prefix)
))
const backendMode = computed(() => settings.value?.backend_mode_enabled === true)
const busy = computed(() => loading.value || passkeyLoading.value || oauthLoading.value !== null || settingsLoading.value)
const passkeyVisible = computed(() => settings.value?.passkey_enabled === true && Boolean(window.PublicKeyCredential && navigator.credentials))
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
  captchaRef.value?.reset()
  captchaToken.value = ''
  captchaRandstr.value = ''
}

function setCaptcha(token: string, randstr = ''): void {
  captchaToken.value = token
  captchaRandstr.value = randstr
  error.value = ''
}

async function acquireActionProof(): Promise<ActionCaptchaRequestProof | null> {
  if (!actionCaptchaEnabled.value) return {}
  const proof = await captchaRef.value?.verifyAction()
  if (!proof) return null
  if (settings.value?.tencent_captcha_enabled) {
    return { tencent_captcha_ticket: proof.token, tencent_captcha_randstr: proof.randstr }
  }
  return { turnstile_token: proof.token }
}

function inlineProof(): ActionCaptchaRequestProof {
  if (settings.value?.tencent_captcha_enabled) {
    return { tencent_captcha_ticket: captchaToken.value || undefined, tencent_captcha_randstr: captchaRandstr.value || undefined }
  }
  return { turnstile_token: captchaToken.value || undefined }
}

function requireAgreement(): boolean {
  if (!agreementBlocked.value) return true
  error.value = '请先阅读并同意登录协议'
  if (agreementMode.value === 'modal') agreementOpen.value = true
  return false
}

function hasStoredAgreement(): boolean {
  try {
    const raw = localStorage.getItem(AGREEMENT_STORAGE_KEY)
    return Boolean(raw && (JSON.parse(raw) as { revision?: string }).revision === agreementRevision.value)
  } catch { return false }
}

function acceptAgreement(): void {
  if (agreementRevision.value) localStorage.setItem(AGREEMENT_STORAGE_KEY, JSON.stringify({ revision: agreementRevision.value, accepted_at: new Date().toISOString() }))
  agreementAccepted.value = true
  agreementOpen.value = false
  error.value = ''
}

function rejectAgreement(): void {
  localStorage.removeItem(AGREEMENT_STORAGE_KEY)
  agreementAccepted.value = false
  agreementOpen.value = false
}

async function completeLogin(): Promise<void> {
  clearAllAffiliateReferralCodes()
  app.showSuccess('登录成功')
  await router.replace(redirect.value)
}

async function submit(): Promise<void> {
  error.value = ''
  if (!requireAgreement()) return
  if (!emailIsValid(form.email)) { error.value = '请输入有效邮箱'; return }
  const passwordError = passwordValidationMessage(form.password)
  if (passwordError) { error.value = passwordError; return }
  if (inlineCaptchaEnabled.value && !captchaToken.value) { error.value = '请先完成人机验证'; return }
  const actionProof = await acquireActionProof()
  if (!actionProof) return
  loading.value = true
  try {
    const response = await auth.login({ email: form.email.trim(), password: form.password, ...inlineProof(), ...actionProof })
    if (isTotp2FARequired(response)) {
      totpToken.value = response.temp_token || ''
      totpEmail.value = response.user_email_masked || ''
      totpCode.value = ''
      totpOpen.value = true
      return
    }
    await completeLogin()
  } catch (caught) {
    error.value = (caught as { message?: string }).message || '登录失败，请检查账号和密码'
  } finally { loading.value = false; resetCaptcha() }
}

async function submitTotp(): Promise<void> {
  error.value = ''
  if (!/^\d{6}$/.test(totpCode.value.trim())) { error.value = '请输入 6 位动态验证码'; return }
  totpSubmitting.value = true
  try {
    await auth.login2FA(totpToken.value, totpCode.value.trim())
    totpOpen.value = false
    await completeLogin()
  } catch (caught) { error.value = (caught as { message?: string }).message || '动态验证码无效' }
  finally { totpSubmitting.value = false }
}

async function passkeyLogin(): Promise<void> {
  error.value = ''
  if (!requireAgreement()) return
  const proof = await acquireActionProof()
  if (!proof) return
  passkeyLoading.value = true
  try { await auth.loginWithPasskey(proof); await completeLogin() }
  catch (caught) {
    const value = caught as { name?: string; message?: string }
    error.value = value.name === 'NotAllowedError' ? '已取消 Passkey 登录' : (value.message || 'Passkey 登录失败')
  } finally { passkeyLoading.value = false; resetCaptcha() }
}

async function startOAuth(provider: OAuthProvider): Promise<void> {
  error.value = ''
  if (!requireAgreement() || busy.value) return
  const params: Record<string, string> = { redirect: redirect.value }
  const affiliate = resolveAffiliateReferralCode(route.query.aff, route.query.aff_code)
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
    const proof = await acquireActionProof()
    if (!proof) return
    const response = await startOAuthLogin(request, proof)
    window.location.assign(response.authorize_url)
  } catch (caught) { error.value = (caught as { message?: string }).message || '第三方登录启动失败' }
  finally { oauthLoading.value = null; resetCaptcha() }
}

onMounted(async () => {
  if (sessionStorage.getItem('auth_expired')) {
    sessionStorage.removeItem('auth_expired')
    error.value = '会话已过期，请重新登录'
  }
  try {
    settings.value = await getPublicSettings()
    agreementAccepted.value = !agreementEnabled.value || hasStoredAgreement()
    agreementOpen.value = agreementBlocked.value && agreementMode.value === 'modal'
  } catch (caught) {
    agreementAccepted.value = true
    error.value = (caught as { message?: string }).message || '安全策略加载失败，请刷新后重试'
  } finally { settingsLoading.value = false }
})
</script>

<template>
  <PublicAuthLayout eyebrow="WELCOME BACK" title="继续你的工作" description="密码、动态验证码、Passkey 与第三方身份共享同一套安全会话。">
    <div v-if="settingsLoading" class="public-state-inline">正在加载登录策略…</div>
    <form v-else class="public-form-stack" @submit.prevent="submit">
      <label>邮箱<input v-model="form.email" type="email" required autofocus autocomplete="email" placeholder="name@example.com" /></label>
      <label>密码<span class="public-password-field"><input v-model="form.password" :type="showPassword ? 'text' : 'password'" required autocomplete="current-password" placeholder="输入密码" /><button type="button" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button></span></label>
      <div v-if="settings?.password_reset_enabled && !backendMode" class="public-form-link"><RouterLink to="/forgot-password">忘记密码？</RouterLink></div>
      <CaptchaChallenge ref="captchaRef" :turnstile-enabled="settings?.turnstile_enabled === true" :turnstile-site-key="settings?.turnstile_site_key || ''" :tencent-enabled="settings?.tencent_captcha_enabled === true" :tencent-app-id="settings?.tencent_captcha_app_id || ''" :tencent-region="settings?.tencent_captcha_region || 'cn'" :aliyun-enabled="settings?.aliyun_captcha_enabled === true" :aliyun-scene-id="settings?.aliyun_captcha_scene_id || ''" :aliyun-prefix="settings?.aliyun_captcha_prefix || ''" :aliyun-region="settings?.aliyun_captcha_region || 'cn'" @verify="setCaptcha" @expire="resetCaptcha" @error="error = '人机验证失败，请重试'" />
      <label v-if="agreementEnabled && agreementMode === 'checkbox'" class="public-check"><input :checked="agreementAccepted" type="checkbox" @change="($event.target as HTMLInputElement).checked ? acceptAgreement() : rejectAgreement()" />我已阅读并同意 <span><RouterLink v-for="(document, index) in agreementDocuments" :key="document.id" :to="`/legal/${document.id}`" target="_blank">{{ index ? `、${document.title}` : document.title }}</RouterLink></span></label>
      <div v-else-if="agreementEnabled && !agreementAccepted" class="public-agreement-notice"><span>登录前需要确认最新协议</span><button type="button" @click="agreementOpen = true">查看并同意</button></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button--primary" :disabled="busy || agreementBlocked || (inlineCaptchaEnabled && !captchaToken)" type="submit">{{ loading ? '登录中…' : '登录' }}</button>

      <template v-if="passkeyVisible || oauthProviders.length">
        <div class="public-divider"><span>或使用其他方式</span></div>
        <button v-if="passkeyVisible" class="button button--secondary" :disabled="busy || agreementBlocked" type="button" @click="passkeyLogin">{{ passkeyLoading ? '正在验证 Passkey…' : '使用 Passkey 登录' }}</button>
        <div v-if="oauthProviders.length" class="oauth-provider-grid"><button v-for="provider in oauthProviders" :key="provider.id" class="oauth-provider" :disabled="busy || agreementBlocked" type="button" @click="startOAuth(provider.id)"><span>{{ provider.id === OAuthProvider.GITHUB ? 'GH' : provider.id === OAuthProvider.GOOGLE ? 'G' : provider.id === OAuthProvider.WECHAT ? '微' : provider.id === OAuthProvider.DINGTALK ? '钉' : '↗' }}</span>{{ oauthLoading === provider.id ? '正在跳转…' : provider.label }}</button></div>
      </template>
    </form>
    <template v-if="!backendMode" #footer>还没有账号？ <RouterLink v-if="settings?.registration_enabled" :to="{ path: '/register', query: route.query.aff ? { aff: route.query.aff } : {} }">创建账号</RouterLink><span v-else>请联系管理员</span></template>
  </PublicAuthLayout>

  <SurfaceDialog :show="totpOpen" title="双重验证" :description="totpEmail ? `验证码来自 ${totpEmail} 绑定的验证器` : '输入验证器生成的 6 位动态码'" @close="totpOpen = false">
    <form class="public-form-stack" @submit.prevent="submitTotp"><label>动态验证码<input v-model="totpCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus /></label><p v-if="error" class="form-error" role="alert">{{ error }}</p></form>
    <template #footer><button class="button button--secondary" @click="totpOpen = false">取消</button><button class="button button--primary" :disabled="totpSubmitting" @click="submitTotp">{{ totpSubmitting ? '验证中…' : '验证并登录' }}</button></template>
  </SurfaceDialog>

  <SurfaceDialog :show="agreementOpen" title="登录与注册协议" :description="settings?.login_agreement_updated_at ? `更新于 ${settings.login_agreement_updated_at}` : '请阅读相关文档后继续'" @close="agreementOpen = false">
    <div class="agreement-document-list"><RouterLink v-for="document in agreementDocuments" :key="document.id" :to="`/legal/${document.id}`" target="_blank"><strong>{{ document.title }}</strong><span>在新窗口查看 ↗</span></RouterLink></div>
    <template #footer><button class="button button--secondary" @click="rejectAgreement">暂不接受</button><button class="button button--primary" @click="acceptAgreement">同意并继续</button></template>
  </SurfaceDialog>
</template>
