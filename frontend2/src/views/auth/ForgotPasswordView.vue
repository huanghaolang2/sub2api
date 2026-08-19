<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CaptchaChallenge from '@/components/auth/CaptchaChallenge.vue'
import { forgotPassword, getPublicSettings } from '@/api/auth'
import type { PublicSettings } from '@/types'
import PublicAuthLayout from '@/components/auth/PublicAuthLayout.vue'
import { useAppStore } from '@/stores/app'
import { emailIsValid } from '@/features/public/model'

interface CaptchaController { reset(): void; verifyAction(): Promise<{ token: string; randstr: string } | null> }

const app = useAppStore()
const settings = ref<PublicSettings | null>(null)
const email = ref('')
const captchaToken = ref('')
const captchaRandstr = ref('')
const captchaRef = ref<CaptchaController | null>(null)
const loading = ref(true)
const submitting = ref(false)
const submitted = ref(false)
const error = ref('')
const actionCaptchaEnabled = computed(() => settings.value?.tencent_captcha_enabled === true || settings.value?.aliyun_captcha_enabled === true)
const inlineCaptchaEnabled = computed(() => settings.value?.turnstile_enabled === true && Boolean(settings.value.turnstile_site_key))

function resetCaptcha(): void { captchaRef.value?.reset(); captchaToken.value = ''; captchaRandstr.value = '' }
async function acquireCaptcha(): Promise<boolean> {
  if (!actionCaptchaEnabled.value) return true
  const proof = await captchaRef.value?.verifyAction(); if (!proof) return false
  captchaToken.value = proof.token; captchaRandstr.value = proof.randstr; return true
}
async function submit(): Promise<void> {
  error.value = ''
  if (!emailIsValid(email.value)) { error.value = '请输入有效邮箱'; return }
  if (!(await acquireCaptcha())) return
  if (inlineCaptchaEnabled.value && !captchaToken.value) { error.value = '请先完成人机验证'; return }
  submitting.value = true
  try {
    await forgotPassword({
      email: email.value.trim(),
      turnstile_token: settings.value?.turnstile_enabled || settings.value?.aliyun_captcha_enabled ? captchaToken.value || undefined : undefined,
      tencent_captcha_ticket: settings.value?.tencent_captcha_enabled ? captchaToken.value || undefined : undefined,
      tencent_captcha_randstr: settings.value?.tencent_captcha_enabled ? captchaRandstr.value || undefined : undefined,
    })
    submitted.value = true; app.showSuccess('重置邮件已发送')
  } catch (caught) { error.value = (caught as { message?: string }).message || '重置邮件发送失败' }
  finally { submitting.value = false; resetCaptcha() }
}
onMounted(async () => {
  try { settings.value = await getPublicSettings() }
  catch (caught) { error.value = (caught as { message?: string }).message || '公开设置加载失败' }
  finally { loading.value = false }
})
</script>

<template>
  <PublicAuthLayout eyebrow="ACCOUNT RECOVERY" title="找回登录权限" description="提交邮箱后，我们会发送一次性重置链接。无论邮箱是否存在，页面都使用相同反馈保护账号隐私。" compact>
    <div v-if="loading" class="public-state-inline">正在加载安全策略…</div>
    <div v-else-if="submitted" class="public-state-inline public-state-inline--success"><strong>请检查邮箱</strong><span>如果该邮箱已注册，你会收到带时效的密码重置链接。</span><button class="button button--secondary" @click="submitted = false">重新发送</button><RouterLink class="button button--primary" to="/login">返回登录</RouterLink></div>
    <form v-else class="public-form-stack" @submit.prevent="submit">
      <label>账号邮箱<input v-model="email" type="email" required autocomplete="email" placeholder="name@example.com" /></label>
      <CaptchaChallenge ref="captchaRef" :turnstile-enabled="settings?.turnstile_enabled === true" :turnstile-site-key="settings?.turnstile_site_key || ''" :tencent-enabled="settings?.tencent_captcha_enabled === true" :tencent-app-id="settings?.tencent_captcha_app_id || ''" :tencent-region="settings?.tencent_captcha_region || 'cn'" :aliyun-enabled="settings?.aliyun_captcha_enabled === true" :aliyun-scene-id="settings?.aliyun_captcha_scene_id || ''" :aliyun-prefix="settings?.aliyun_captcha_prefix || ''" :aliyun-region="settings?.aliyun_captcha_region || 'cn'" @verify="(token: string, randstr: string) => { captchaToken = token; captchaRandstr = randstr }" @expire="resetCaptcha" @error="error = '人机验证失败'" />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button--primary" :disabled="submitting" type="submit">{{ submitting ? '发送中…' : '发送重置链接' }}</button>
    </form>
    <template #footer>想起密码了？ <RouterLink to="/login">返回登录</RouterLink></template>
  </PublicAuthLayout>
</template>
