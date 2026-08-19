<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import * as accountsAPI from '@shared-api/admin/accounts'
import * as antigravityAPI from '@shared-api/admin/antigravity'
import * as geminiAPI from '@shared-api/admin/gemini'
import * as grokAPI from '@shared-api/admin/grok'
import type { AccountPlatform, AccountType } from '@/types'
import { buildOAuthCredentialPayload } from '@/features/admin/resources/account'
import { useAppStore } from '@/stores/app'

enum AccountPlatformOption { OPENAI = 'openai', ANTHROPIC = 'anthropic', GEMINI = 'gemini', ANTIGRAVITY = 'antigravity', GROK = 'grok' }
enum AccountTypeOption { OAUTH = 'oauth', SETUP_TOKEN = 'setup-token' }
enum AuthorizationInputMethod { BROWSER = 'browser', REFRESH_TOKEN = 'refresh_token', SSO_COOKIE = 'sso_cookie', EMAIL_PASSWORD = 'email_password' }
enum GeminiOAuthOption { CODE_ASSIST = 'code_assist', GOOGLE_ONE = 'google_one', AI_STUDIO = 'ai_studio' }
enum OpenAIClientOption { CODEX_CLI = 'codex_cli', MOBILE = 'mobile' }

const OPENAI_MOBILE_CLIENT_ID = 'app_LlGpXReQgckcGGUo2JrYvtJK'
const props = defineProps<{
  platform: AccountPlatform
  type: AccountType
  proxyId: number | string
  credentialsJson: string
  extraJson: string
}>()
const emit = defineEmits<{
  'update:credentialsJson': [value: string]
  'update:extraJson': [value: string]
}>()

const app = useAppStore()
const method = ref(AuthorizationInputMethod.BROWSER)
const loading = ref(false)
const authUrl = ref('')
const sessionId = ref('')
const oauthState = ref('')
const form = reactive({ code: '', refreshToken: '', sso: '', password: '', geminiOAuthType: GeminiOAuthOption.CODE_ASSIST, geminiProjectId: '', geminiTierId: 'aistudio_free', openAIClient: OpenAIClientOption.CODEX_CLI })

const methodLabels: Record<AuthorizationInputMethod, string> = {
  [AuthorizationInputMethod.BROWSER]: '浏览器授权',
  [AuthorizationInputMethod.REFRESH_TOKEN]: 'Refresh Token',
  [AuthorizationInputMethod.SSO_COOKIE]: 'SSO / Session Cookie',
  [AuthorizationInputMethod.EMAIL_PASSWORD]: '邮箱密码'
}
const methods = computed<AuthorizationInputMethod[]>(() => {
  if (props.type === AccountTypeOption.SETUP_TOKEN) return [AuthorizationInputMethod.BROWSER, AuthorizationInputMethod.SSO_COOKIE]
  if (props.platform === AccountPlatformOption.OPENAI || props.platform === AccountPlatformOption.ANTIGRAVITY) return [AuthorizationInputMethod.BROWSER, AuthorizationInputMethod.REFRESH_TOKEN]
  if (props.platform === AccountPlatformOption.GROK) return [AuthorizationInputMethod.BROWSER, AuthorizationInputMethod.REFRESH_TOKEN, AuthorizationInputMethod.SSO_COOKIE, AuthorizationInputMethod.EMAIL_PASSWORD]
  return [AuthorizationInputMethod.BROWSER]
})
const proxyId = computed(() => {
  const value = Number(props.proxyId)
  return Number.isInteger(value) && value > 0 ? value : undefined
})

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}
function extractState(url: string): string {
  try { return new URL(url).searchParams.get('state') || '' } catch { return '' }
}
function reset(): void {
  method.value = methods.value[0]
  authUrl.value = ''
  sessionId.value = ''
  oauthState.value = ''
  Object.assign(form, { code: '', refreshToken: '', sso: '', password: '', geminiOAuthType: GeminiOAuthOption.CODE_ASSIST, geminiProjectId: '', geminiTierId: 'aistudio_free', openAIClient: OpenAIClientOption.CODEX_CLI })
}

async function generate(): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    let result: { auth_url: string; session_id: string; state?: string }
    if (props.platform === AccountPlatformOption.OPENAI) {
      result = await accountsAPI.generateAuthUrl('/admin/openai/generate-auth-url', { proxy_id: proxyId.value })
    } else if (props.platform === AccountPlatformOption.GEMINI) {
      result = await geminiAPI.generateAuthUrl({ proxy_id: proxyId.value, project_id: form.geminiProjectId.trim() || undefined, oauth_type: form.geminiOAuthType, tier_id: form.geminiTierId || undefined })
    } else if (props.platform === AccountPlatformOption.ANTIGRAVITY) {
      result = await antigravityAPI.generateAuthUrl({ proxy_id: proxyId.value })
    } else if (props.platform === AccountPlatformOption.GROK) {
      result = await grokAPI.generateAuthUrl({ proxy_id: proxyId.value })
    } else {
      result = await accountsAPI.generateAuthUrl(props.type === AccountTypeOption.SETUP_TOKEN ? '/admin/accounts/generate-setup-token-url' : '/admin/accounts/generate-auth-url', { proxy_id: proxyId.value })
    }
    authUrl.value = result.auth_url
    sessionId.value = result.session_id
    oauthState.value = result.state || extractState(result.auth_url)
    app.showSuccess('授权链接已生成')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '生成授权链接失败')
  } finally { loading.value = false }
}

async function resolveToken(): Promise<Record<string, unknown>> {
  if (method.value === AuthorizationInputMethod.REFRESH_TOKEN) {
    if (!form.refreshToken.trim()) throw new Error('请输入 Refresh Token')
    if (props.platform === AccountPlatformOption.OPENAI) return accountsAPI.refreshOpenAIToken(form.refreshToken.trim(), proxyId.value, '/admin/openai/refresh-token', form.openAIClient === OpenAIClientOption.MOBILE ? OPENAI_MOBILE_CLIENT_ID : undefined)
    if (props.platform === AccountPlatformOption.ANTIGRAVITY) return antigravityAPI.refreshAntigravityToken(form.refreshToken.trim(), proxyId.value)
    if (props.platform === AccountPlatformOption.GROK) return grokAPI.refreshGrokToken(form.refreshToken.trim(), proxyId.value)
    throw new Error('该平台不支持 Refresh Token 验证')
  }
  if (method.value === AuthorizationInputMethod.SSO_COOKIE) {
    if (!form.sso.trim()) throw new Error('请输入 SSO / Session Cookie')
    if (props.platform === AccountPlatformOption.GROK) return grokAPI.validateSSOToken(form.sso.trim(), proxyId.value)
    return accountsAPI.exchangeCode(props.type === AccountTypeOption.SETUP_TOKEN ? '/admin/accounts/setup-token-cookie-auth' : '/admin/accounts/cookie-auth', { session_id: '', code: form.sso.trim(), proxy_id: proxyId.value })
  }
  if (method.value === AuthorizationInputMethod.EMAIL_PASSWORD) {
    if (props.platform !== AccountPlatformOption.GROK) throw new Error('邮箱密码授权仅适用于 Grok')
    if (!form.password.trim()) throw new Error('请输入 email----password')
    return grokAPI.authorizePassword(form.password, proxyId.value)
  }
  if (!sessionId.value || !form.code.trim()) throw new Error('请先生成授权链接并填写回调 code')
  if (props.platform === AccountPlatformOption.OPENAI) {
    if (!oauthState.value.trim()) throw new Error('OpenAI 授权缺少 state')
    return accountsAPI.exchangeCode('/admin/openai/exchange-code', { session_id: sessionId.value, code: form.code.trim(), state: oauthState.value.trim(), proxy_id: proxyId.value })
  }
  if (props.platform === AccountPlatformOption.GEMINI) return geminiAPI.exchangeCode({ session_id: sessionId.value, state: oauthState.value.trim(), code: form.code.trim(), proxy_id: proxyId.value, oauth_type: form.geminiOAuthType, tier_id: form.geminiTierId || undefined })
  if (props.platform === AccountPlatformOption.ANTIGRAVITY) return antigravityAPI.exchangeCode({ session_id: sessionId.value, state: oauthState.value.trim(), code: form.code.trim(), proxy_id: proxyId.value })
  if (props.platform === AccountPlatformOption.GROK) return grokAPI.exchangeCode({ session_id: sessionId.value, state: oauthState.value.trim(), code: form.code.trim(), proxy_id: proxyId.value })
  return accountsAPI.exchangeCode(props.type === AccountTypeOption.SETUP_TOKEN ? '/admin/accounts/exchange-setup-token-code' : '/admin/accounts/exchange-code', { session_id: sessionId.value, code: form.code.trim(), proxy_id: proxyId.value })
}

async function complete(): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    const token = await resolveToken()
    const payload = buildOAuthCredentialPayload(props.platform, token, { refreshTokenFallback: form.refreshToken.trim() || undefined, geminiOAuthType: form.geminiOAuthType, geminiTierId: form.geminiTierId })
    emit('update:credentialsJson', JSON.stringify({ ...jsonObject(props.credentialsJson), ...payload.credentials }, null, 2))
    emit('update:extraJson', JSON.stringify({ ...jsonObject(props.extraJson), ...payload.extra }, null, 2))
    form.password = ''
    form.sso = ''
    app.showSuccess('授权信息已写入表单，保存账号后生效')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '授权验证失败')
  } finally { loading.value = false }
}

watch(() => [props.platform, props.type], reset, { immediate: true })
watch(methods, (items) => { if (!items.includes(method.value)) method.value = items[0] })
</script>

<template>
  <fieldset class="resource-form-section authorization-builder">
    <legend>创建授权</legend>
    <p class="muted">在创建前完成授权验证；服务端返回的长期凭据会写入当前表单，原始 SSO Cookie 与密码不会保存。</p>
    <div class="resource-tabs">
      <button v-for="item in methods" :key="item" type="button" :aria-selected="method === item" @click="method = item">{{ methodLabels[item] }}</button>
    </div>
    <template v-if="method === AuthorizationInputMethod.BROWSER">
      <div v-if="platform === AccountPlatformOption.GEMINI" class="resource-form-grid resource-form-grid--3">
        <label>OAuth 类型<select v-model="form.geminiOAuthType"><option :value="GeminiOAuthOption.CODE_ASSIST">Code Assist</option><option :value="GeminiOAuthOption.GOOGLE_ONE">Google One</option><option :value="GeminiOAuthOption.AI_STUDIO">AI Studio</option></select></label>
        <label>Project ID<input v-model="form.geminiProjectId" placeholder="Code Assist 可选" /></label>
        <label>Gemini 档位<input v-model="form.geminiTierId" /></label>
      </div>
      <button class="resource-button resource-button--secondary" type="button" :disabled="loading" @click="generate">{{ loading ? '生成中…' : '生成授权链接' }}</button>
      <div v-if="authUrl" class="authorization-builder__link"><a :href="authUrl" target="_blank" rel="noopener noreferrer">在新窗口打开授权页 ↗</a><code>{{ authUrl }}</code></div>
      <div class="resource-form-grid"><label>回调 code<input v-model="form.code" autocomplete="off" /></label><label v-if="oauthState || platform !== AccountPlatformOption.ANTHROPIC">state<input v-model="oauthState" autocomplete="off" /></label></div>
    </template>
    <template v-else-if="method === AuthorizationInputMethod.REFRESH_TOKEN">
      <label v-if="platform === AccountPlatformOption.OPENAI">客户端<select v-model="form.openAIClient"><option :value="OpenAIClientOption.CODEX_CLI">Codex CLI</option><option :value="OpenAIClientOption.MOBILE">OpenAI Mobile</option></select></label>
      <label>Refresh Token<textarea v-model="form.refreshToken" rows="5" autocomplete="off" /></label>
    </template>
    <label v-else-if="method === AuthorizationInputMethod.SSO_COOKIE">SSO / Session Cookie<textarea v-model="form.sso" rows="5" autocomplete="off" /></label>
    <label v-else>Grok 邮箱与密码<textarea v-model="form.password" rows="4" autocomplete="off" placeholder="email@example.com----password" /></label>
    <button class="resource-button" type="button" :disabled="loading" @click="complete">{{ loading ? '验证中…' : '验证并写入凭据' }}</button>
  </fieldset>
</template>

<style scoped>
.authorization-builder__link { padding: 12px; display: grid; gap: 7px; background: var(--accent-soft); border-radius: 10px; }.authorization-builder__link a { color: var(--accent); font-weight: 700; }.authorization-builder__link code { overflow-wrap: anywhere; color: var(--text-secondary); font-size: var(--font-meta); }
</style>
