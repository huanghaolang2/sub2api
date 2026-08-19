<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CaptchaChallenge from '@/components/auth/CaptchaChallenge.vue'
import { apiClient } from '@/api/client'
import { getPublicSettings, isOAuthLoginCompletion, persistOAuthTokenContext, sendPendingOAuthVerifyCode, sendVerifyCode } from '@/api/auth'
import type { PublicSettings } from '@/types'
import { clearAllAffiliateReferralCodes } from '@shared-utils/oauthAffiliate'
import {
  formatRegistrationEmailSuffixWhitelistForMessage,
  isRegistrationEmailSuffixAllowed,
  normalizeRegistrationEmailSuffixWhitelist,
} from '@shared-utils/registrationEmailPolicy'
import PublicAuthLayout from '@/components/auth/PublicAuthLayout.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { emailIsValid, sanitizeRedirectPath } from '@/features/public/model'

interface CaptchaController { reset(): void; verifyAction(): Promise<{ token: string; randstr: string } | null> }
interface RegistrationDraft {
  email?: string; password?: string; promo_code?: string; invitation_code?: string; aff_code?: string
  pending_provider?: string; pending_redirect?: string; pending_adoption_decision?: { adopt_display_name?: boolean; adopt_avatar?: boolean }
  pending_auth_token?: string; pending_oauth_token?: string; pending_auth_token_field?: 'pending_auth_token' | 'pending_oauth_token'
  turnstile_token?: string; tencent_captcha_ticket?: string; tencent_captcha_randstr?: string
}

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const auth = useAuthStore()
const settings = ref<PublicSettings | null>(null)
const loading = ref(true)
const sending = ref(false)
const verifying = ref(false)
const success = ref(false)
const error = ref('')
const countdown = ref(0)
const captchaRef = ref<CaptchaController | null>(null)
const captchaToken = ref('')
const captchaRandstr = ref('')
const draft = reactive<RegistrationDraft>({})
const form = reactive({ email: '', password: '', code: '' })
let countdownTimer: number | null = null

const pendingProvider = computed(() => draft.pending_provider || auth.pendingAuthSession?.provider || '')
const redirect = computed(() => sanitizeRedirectPath(draft.pending_redirect || auth.pendingAuthSession?.redirect || route.query.redirect, '/app/dashboard'))
const pendingToken = computed(() => draft.pending_oauth_token || draft.pending_auth_token || auth.pendingAuthSession?.token || '')
const pendingTokenField = computed<'pending_auth_token' | 'pending_oauth_token'>(() => draft.pending_auth_token_field || auth.pendingAuthSession?.token_field || (draft.pending_oauth_token ? 'pending_oauth_token' : 'pending_auth_token'))
const actionCaptchaEnabled = computed(() => settings.value?.tencent_captcha_enabled === true || settings.value?.aliyun_captcha_enabled === true)
const inlineCaptchaEnabled = computed(() => settings.value?.turnstile_enabled === true && Boolean(settings.value.turnstile_site_key))
const emailWhitelist = computed(() => normalizeRegistrationEmailSuffixWhitelist(settings.value?.registration_email_suffix_whitelist || []))
const bypassEmailPolicy = computed(() => settings.value?.registration_email_domain_quota_enabled === true || Boolean(pendingProvider.value || pendingToken.value))

function emailPolicyMessage(): string {
  if (!emailWhitelist.value.length) return '该邮箱域名不允许注册'
  return `仅支持以下邮箱域名：${formatRegistrationEmailSuffixWhitelistForMessage(emailWhitelist.value, { separator: '、', more: (count) => `等 ${count} 项` })}`
}

function resetCaptcha(): void { captchaRef.value?.reset(); captchaToken.value = ''; captchaRandstr.value = '' }
async function acquireCaptcha(): Promise<boolean> {
  if (!actionCaptchaEnabled.value) return true
  const proof = await captchaRef.value?.verifyAction(); if (!proof) return false
  captchaToken.value = proof.token; captchaRandstr.value = proof.randstr; return true
}
function proofPayload(): Record<string, string | undefined> {
  if (settings.value?.tencent_captcha_enabled) return { tencent_captcha_ticket: captchaToken.value || undefined, tencent_captcha_randstr: captchaRandstr.value || undefined }
  if (inlineCaptchaEnabled.value || settings.value?.aliyun_captcha_enabled) return { turnstile_token: captchaToken.value || undefined }
  return {}
}
function startCountdown(seconds: number): void {
  countdown.value = seconds || 60
  if (countdownTimer) window.clearInterval(countdownTimer)
  countdownTimer = window.setInterval(() => { countdown.value -= 1; if (countdown.value <= 0 && countdownTimer) { window.clearInterval(countdownTimer); countdownTimer = null } }, 1000)
}

async function sendCode(): Promise<void> {
  error.value = ''
  if (!emailIsValid(form.email)) { error.value = '请输入有效邮箱'; return }
  if (!bypassEmailPolicy.value && !isRegistrationEmailSuffixAllowed(form.email, emailWhitelist.value)) { error.value = emailPolicyMessage(); return }
  const hasInitialProof = Boolean(draft.turnstile_token || draft.tencent_captcha_ticket)
  if (!hasInitialProof && !(await acquireCaptcha())) return
  if (inlineCaptchaEnabled.value && !captchaToken.value && !draft.turnstile_token) { error.value = '请先完成人机验证'; return }
  sending.value = true
  try {
    const proof = proofPayload()
    const payload = {
      email: form.email.trim(),
      [pendingTokenField.value]: pendingToken.value || undefined,
      turnstile_token: proof.turnstile_token || draft.turnstile_token,
      tencent_captcha_ticket: proof.tencent_captcha_ticket || draft.tencent_captcha_ticket,
      tencent_captcha_randstr: proof.tencent_captcha_randstr || draft.tencent_captcha_randstr,
    }
    const response = pendingProvider.value ? await sendPendingOAuthVerifyCode(payload) : await sendVerifyCode(payload)
    startCountdown(response.countdown)
    app.showSuccess('验证码已发送')
  } catch (caught) { error.value = (caught as { message?: string }).message || '验证码发送失败' }
  finally {
    if (hasInitialProof) {
      draft.turnstile_token = undefined
      draft.tencent_captcha_ticket = undefined
      draft.tencent_captcha_randstr = undefined
      try { sessionStorage.setItem('register_data', JSON.stringify(draft)) } catch { /* session-only recovery is best effort */ }
    }
    sending.value = false
    resetCaptcha()
  }
}

async function verify(): Promise<void> {
  error.value = ''
  if (!emailIsValid(form.email)) { error.value = '请输入有效邮箱'; return }
  if (!bypassEmailPolicy.value && !isRegistrationEmailSuffixAllowed(form.email, emailWhitelist.value)) { error.value = emailPolicyMessage(); return }
  if (!/^\d{6}$/.test(form.code.trim())) { error.value = '请输入 6 位验证码'; return }
  if (!form.password || form.password.length < 6) { error.value = '密码至少需要 6 位'; return }
  if (!(await acquireCaptcha())) return
  if (pendingProvider.value && inlineCaptchaEnabled.value && !captchaToken.value) { error.value = '请先完成人机验证'; return }
  verifying.value = true
  try {
    if (pendingProvider.value) {
      const { data } = await apiClient.post('/auth/oauth/pending/create-account', {
        [pendingTokenField.value]: pendingToken.value || undefined,
        email: form.email.trim(), password: form.password, verify_code: form.code.trim(),
        invitation_code: draft.invitation_code || undefined,
        aff_code: draft.aff_code || undefined,
        adopt_display_name: draft.pending_adoption_decision?.adopt_display_name,
        adopt_avatar: draft.pending_adoption_decision?.adopt_avatar,
        ...proofPayload(),
      })
      if (!isOAuthLoginCompletion(data)) {
        auth.setPendingAuthSession({ token: '', token_field: 'pending_oauth_token', provider: pendingProvider.value, redirect: redirect.value })
        await router.replace(`/auth/${pendingProvider.value === 'github' || pendingProvider.value === 'google' ? 'callback' : `${pendingProvider.value}/callback`}`)
        return
      }
      persistOAuthTokenContext(data); await auth.setToken(data.access_token); auth.clearPendingAuthSession()
    } else {
      await auth.register({
        email: form.email.trim(), password: form.password, verify_code: form.code.trim(),
        promo_code: draft.promo_code, invitation_code: draft.invitation_code, aff_code: draft.aff_code,
        turnstile_token: captchaToken.value || draft.turnstile_token,
        tencent_captcha_ticket: settings.value?.tencent_captcha_enabled ? captchaToken.value || draft.tencent_captcha_ticket : undefined,
        tencent_captcha_randstr: settings.value?.tencent_captcha_enabled ? captchaRandstr.value || draft.tencent_captcha_randstr : undefined,
      })
    }
    sessionStorage.removeItem('register_data'); clearAllAffiliateReferralCodes(); success.value = true; app.showSuccess('邮箱验证完成')
  } catch (caught) { error.value = (caught as { message?: string }).message || '验证码无效或已过期' }
  finally { verifying.value = false; resetCaptcha() }
}

onMounted(async () => {
  try {
    const raw = sessionStorage.getItem('register_data')
    if (raw) Object.assign(draft, JSON.parse(raw) as RegistrationDraft)
    form.email = draft.email || (typeof route.query.email === 'string' ? route.query.email.trim() : '')
    form.password = draft.password || ''
    settings.value = await getPublicSettings()
    if (draft.email && draft.password) await sendCode()
  } catch (caught) { error.value = (caught as { message?: string }).message || '验证上下文加载失败' }
  finally { loading.value = false }
})
onBeforeUnmount(() => { if (countdownTimer) window.clearInterval(countdownTimer) })
</script>

<template>
  <PublicAuthLayout eyebrow="EMAIL VERIFICATION" title="确认你的邮箱" description="验证码只用于本次账号创建。失效后可以在当前页面安全重发。" compact>
    <div v-if="loading" class="public-state-inline">正在恢复验证上下文…</div>
    <div v-else-if="success" class="public-state-inline public-state-inline--success"><strong>邮箱验证完成</strong><span>账号已经可以使用。</span><RouterLink class="button button--primary" :to="redirect">进入工作台</RouterLink></div>
    <form v-else class="public-form-stack" @submit.prevent="verify">
      <label>邮箱<input v-model="form.email" type="email" autocomplete="email" /></label>
      <label v-if="!draft.password">登录密码<input v-model="form.password" type="password" autocomplete="new-password" /></label>
      <div class="public-field-action"><label>6 位验证码<input v-model="form.code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" /></label><button class="button button--secondary" type="button" :disabled="sending || countdown > 0" @click="sendCode">{{ countdown > 0 ? `${countdown}s` : sending ? '发送中…' : '发送 / 重发' }}</button></div>
      <CaptchaChallenge ref="captchaRef" :turnstile-enabled="settings?.turnstile_enabled === true" :turnstile-site-key="settings?.turnstile_site_key || ''" :tencent-enabled="settings?.tencent_captcha_enabled === true" :tencent-app-id="settings?.tencent_captcha_app_id || ''" :tencent-region="settings?.tencent_captcha_region || 'cn'" :aliyun-enabled="settings?.aliyun_captcha_enabled === true" :aliyun-scene-id="settings?.aliyun_captcha_scene_id || ''" :aliyun-prefix="settings?.aliyun_captcha_prefix || ''" :aliyun-region="settings?.aliyun_captcha_region || 'cn'" @verify="(token: string, randstr: string) => { captchaToken = token; captchaRandstr = randstr }" @expire="resetCaptcha" @error="error = '人机验证失败'" />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button--primary" :disabled="verifying" type="submit">{{ verifying ? '验证中…' : '验证并创建账号' }}</button>
    </form>
    <template #footer><RouterLink to="/register">返回注册</RouterLink></template>
  </PublicAuthLayout>
</template>
