<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import * as accountsAPI from '@shared-api/admin/accounts'
import type { Account, AccountPlatform, AccountType } from '@/types'
import { splitValues } from '@/features/admin/resources/model'
import { useAppStore } from '@/stores/app'

enum AccountModeOption { PAYG = 'payg', CODING = 'coding' }
enum AccountPlatformOption { OPENAI = 'openai', ANTHROPIC = 'anthropic', GEMINI = 'gemini', ANTIGRAVITY = 'antigravity', GROK = 'grok', KIMI = 'kimi', ZHIPU = 'zhipu', DEEPSEEK = 'deepseek' }
enum AccountTypeOption { OAUTH = 'oauth', SETUP_TOKEN = 'setup-token', API_KEY = 'apikey', UPSTREAM = 'upstream', BEDROCK = 'bedrock', SERVICE_ACCOUNT = 'service_account' }
enum ApiProtocolOption { CHAT = 'chat_completions', ANTHROPIC = 'anthropic', RESPONSES = 'responses' }
enum BedrockAuthOption { SIGV4 = 'sigv4', API_KEY = 'apikey' }
enum OpenAIWSOption { OFF = 'off', CONTEXT_POOL = 'ctx_pool', PASSTHROUGH = 'passthrough', HTTP_BRIDGE = 'http_bridge' }
enum OpenAICompactOption { AUTO = 'auto', FORCE_ON = 'force_on', FORCE_OFF = 'force_off' }
enum OpenAIResponsesOption { AUTO = 'auto', RESPONSES = 'force_responses', CHAT = 'force_chat_completions' }
enum CodexFingerprintOption { OFF = 'off', DEVICE = 'device', SESSION = 'session', FULL = 'full' }
enum CodexImageOption { INHERIT = 'inherit', ENABLED = 'enabled', DISABLED = 'disabled', BLOCK = 'block' }
enum QuotaThresholdOption { FIXED = 'fixed', PERCENTAGE = 'percentage' }

interface MappingRow { from: string; to: string }
interface HeaderRow { name: string; value: string }
interface TempRuleDraft {
  error_code: number | string
  keywords: string
  duration_minutes: number | string
  description: string
  raw: Record<string, unknown>
}

const props = defineProps<{
  account: Account | null
  platform: AccountPlatform
  type: AccountType
  credentialsJson: string
  extraJson: string
}>()
const emit = defineEmits<{
  'update:credentialsJson': [value: string]
  'update:extraJson': [value: string]
}>()

const app = useAppStore()
const credentials = ref<Record<string, unknown>>({})
const extra = ref<Record<string, unknown>>({})
const modelMappings = ref<MappingRow[]>([])
const compactMappings = ref<MappingRow[]>([])
const headerRows = ref<HeaderRow[]>([])
const tempRules = ref<TempRuleDraft[]>([])
const secret = reactive({ apiKey: '', awsSecret: '', awsSession: '', serviceAccount: '' })
const hydrating = ref(false)
const lastCredentialEmission = ref('')
const lastExtraEmission = ref('')

const isCN = computed(() => [AccountPlatformOption.KIMI, AccountPlatformOption.ZHIPU, AccountPlatformOption.DEEPSEEK].includes(props.platform as AccountPlatformOption))
const isOAuth = computed(() => props.type === AccountTypeOption.OAUTH || props.type === AccountTypeOption.SETUP_TOKEN)
const isApiKey = computed(() => props.type === AccountTypeOption.API_KEY || props.type === AccountTypeOption.UPSTREAM)
const isBedrock = computed(() => props.type === AccountTypeOption.BEDROCK)
const isServiceAccount = computed(() => props.type === AccountTypeOption.SERVICE_ACCOUNT)
const headerCapable = computed(() => ((props.platform === AccountPlatformOption.OPENAI || props.platform === AccountPlatformOption.ANTHROPIC) && props.type === AccountTypeOption.API_KEY) || (props.platform === AccountPlatformOption.GROK && (props.type === AccountTypeOption.API_KEY || props.type === AccountTypeOption.OAUTH)))
const openAIWsKey = computed(() => props.type === AccountTypeOption.API_KEY ? 'openai_apikey_responses_websockets_v2_mode' : 'openai_oauth_responses_websockets_v2_mode')
const hasApiKey = computed(() => props.account?.credentials_status?.has_api_key === true)
const hasServiceAccount = computed(() => props.account?.credentials_status?.has_service_account_json === true || props.account?.credentials_status?.has_service_account === true)

function objectFromJson(value: string, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!value.trim()) return structuredClone(fallback)
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : structuredClone(fallback)
  } catch { return structuredClone(fallback) }
}

function rowsFromMapping(value: unknown): MappingRow[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).filter(([, item]) => typeof item === 'string').map(([from, to]) => ({ from, to: String(to) }))
}

function rowsFromHeaders(value: unknown): HeaderRow[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).filter(([, item]) => typeof item === 'string').map(([name, item]) => ({ name, value: String(item) }))
}

function rulesFromCredentials(value: unknown): TempRuleDraft[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).map((item) => ({
    error_code: typeof item.error_code === 'number' ? item.error_code : '',
    keywords: Array.isArray(item.keywords) ? item.keywords.filter((word) => typeof word === 'string').join('\n') : '',
    duration_minutes: typeof item.duration_minutes === 'number' ? item.duration_minutes : 30,
    description: typeof item.description === 'string' ? item.description : '',
    raw: { ...item }
  }))
}

async function hydrate(): Promise<void> {
  hydrating.value = true
  const baseCredentials = props.account?.credentials || {}
  const baseExtra = props.account?.extra || {}
  credentials.value = objectFromJson(props.credentialsJson, baseCredentials)
  extra.value = objectFromJson(props.extraJson, baseExtra)
  modelMappings.value = rowsFromMapping(credentials.value.model_mapping)
  compactMappings.value = rowsFromMapping(credentials.value.compact_model_mapping)
  headerRows.value = rowsFromHeaders(credentials.value.header_overrides)
  tempRules.value = rulesFromCredentials(credentials.value.temp_unschedulable_rules)
  Object.assign(secret, { apiKey: '', awsSecret: '', awsSession: '', serviceAccount: '' })
  await nextTick()
  hydrating.value = false
}

function cleanedMapping(rows: MappingRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.from.trim(), row.to.trim()]).filter(([from, to]) => Boolean(from && to)))
}

function cleanedHeaders(): Record<string, string> {
  return Object.fromEntries(headerRows.value.map((row) => [row.name.trim().toLowerCase(), row.value.trim()]).filter(([name]) => Boolean(name)))
}

function emitState(): void {
  if (hydrating.value) return
  const nextCredentials = { ...credentials.value }
  const mapping = cleanedMapping(modelMappings.value)
  const compact = cleanedMapping(compactMappings.value)
  const headers = cleanedHeaders()
  if (Object.keys(mapping).length) nextCredentials.model_mapping = mapping
  else delete nextCredentials.model_mapping
  if (Object.keys(compact).length) nextCredentials.compact_model_mapping = compact
  else delete nextCredentials.compact_model_mapping
  if (headerRows.value.length || nextCredentials.header_override_enabled === true) nextCredentials.header_overrides = headers
  else delete nextCredentials.header_overrides
  if (tempRules.value.length || nextCredentials.temp_unschedulable_enabled === true) {
    nextCredentials.temp_unschedulable_rules = tempRules.value.map((rule) => ({
      ...rule.raw,
      error_code: Number(rule.error_code),
      keywords: splitValues(rule.keywords),
      duration_minutes: Number(rule.duration_minutes),
      description: rule.description.trim()
    }))
  } else delete nextCredentials.temp_unschedulable_rules
  if (secret.apiKey.trim()) nextCredentials.api_key = secret.apiKey.trim()
  if (secret.awsSecret.trim()) nextCredentials.aws_secret_access_key = secret.awsSecret.trim()
  if (secret.awsSession.trim()) nextCredentials.aws_session_token = secret.awsSession.trim()
  if (secret.serviceAccount.trim()) nextCredentials.service_account_json = secret.serviceAccount.trim()
  const credentialText = JSON.stringify(nextCredentials, null, 2)
  const extraText = JSON.stringify(extra.value, null, 2)
  lastCredentialEmission.value = credentialText
  lastExtraEmission.value = extraText
  emit('update:credentialsJson', credentialText)
  emit('update:extraJson', extraText)
}

watch([credentials, extra, modelMappings, compactMappings, headerRows, tempRules, () => ({ ...secret })], emitState, { deep: true })
watch(() => [props.credentialsJson, props.extraJson, props.account?.id, props.platform, props.type] as const, ([credentialJson, extraJson]) => {
  if (credentialJson === lastCredentialEmission.value && extraJson === lastExtraEmission.value) return
  void hydrate()
}, { immediate: true })

function text(source: Record<string, unknown>, key: string, fallback = ''): string {
  const value = source[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}
function checked(source: Record<string, unknown>, key: string): boolean { return source[key] === true }
function inputValue(event: Event): string { return (event.target as HTMLInputElement | HTMLSelectElement).value }
function inputChecked(event: Event): boolean { return (event.target as HTMLInputElement).checked }
function setText(source: Record<string, unknown>, key: string, event: Event, preserveEmpty = false): void {
  const value = inputValue(event).trim()
  if (value || preserveEmpty) source[key] = value
  else delete source[key]
}
function setNumber(source: Record<string, unknown>, key: string, event: Event): void {
  const raw = inputValue(event)
  if (raw === '') delete source[key]
  else source[key] = Number(raw)
}
function setBoolean(source: Record<string, unknown>, key: string, event: Event): void {
  if (inputChecked(event)) source[key] = true
  else delete source[key]
}
function addMapping(target: MappingRow[]): void { target.push({ from: '', to: '' }) }
function removeMapping(target: MappingRow[], index: number): void { target.splice(index, 1) }
function addHeader(): void { headerRows.value.push({ name: '', value: '' }) }
function addTempRule(): void { tempRules.value.push({ error_code: '', keywords: '', duration_minutes: 30, description: '', raw: {} }) }
function toggleCapability(value: string, event: Event): void {
  const current = Array.isArray(credentials.value.openai_capabilities) ? credentials.value.openai_capabilities.filter((item): item is string => typeof item === 'string') : []
  credentials.value.openai_capabilities = inputChecked(event) ? [...new Set([...current, value])] : current.filter((item) => item !== value)
}
function capabilityChecked(value: string): boolean { return Array.isArray(credentials.value.openai_capabilities) && credentials.value.openai_capabilities.includes(value) }
function codexImageMode(): CodexImageOption {
  if (extra.value.codex_image_generation_explicit_tool_policy === 'strip') return CodexImageOption.BLOCK
  if (extra.value.codex_image_generation_bridge === true) return CodexImageOption.ENABLED
  if (extra.value.codex_image_generation_bridge === false) return CodexImageOption.DISABLED
  return CodexImageOption.INHERIT
}
function setCodexImageMode(event: Event): void {
  const value = inputValue(event) as CodexImageOption
  delete extra.value.codex_image_generation_bridge_enabled
  delete extra.value.codex_image_generation_bridge
  delete extra.value.codex_image_generation_explicit_tool_policy
  if (value === CodexImageOption.ENABLED || value === CodexImageOption.DISABLED) extra.value.codex_image_generation_bridge = value === CodexImageOption.ENABLED
  if (value === CodexImageOption.BLOCK) extra.value.codex_image_generation_explicit_tool_policy = 'strip'
}
async function loadAntigravityMapping(): Promise<void> {
  try {
    modelMappings.value = rowsFromMapping(await accountsAPI.getAntigravityDefaultModelMapping())
    app.showSuccess('已载入 Antigravity 默认映射')
  } catch (caught) { app.showError((caught as { message?: string }).message || '默认映射加载失败') }
}
</script>

<template>
  <div class="platform-config resource-form-stack">
    <div class="platform-config__intro">
      <div><strong>{{ platform }} · {{ type }}</strong><span>敏感值仅可替换，未返回的 Token、API Key 与私钥会由后端继续保留。</span></div>
      <div class="credential-flags"><span v-for="(exists, key) in account?.credentials_status || {}" v-show="exists" :key="key">{{ String(key).replace('has_', '') }}</span></div>
    </div>

    <fieldset v-if="isApiKey || isBedrock || isServiceAccount || platform === AccountPlatformOption.GROK" class="resource-form-section">
      <legend>连接与身份凭据</legend>
      <div v-if="isApiKey" class="resource-form-grid resource-form-grid--3">
        <label class="resource-field--wide">Base URL<input :value="text(credentials, 'base_url')" type="url" placeholder="使用平台默认地址" @input="setText(credentials, 'base_url', $event)" /></label>
        <label>API Key {{ hasApiKey ? '（已配置，留空保留）' : '*' }}<input v-model="secret.apiKey" type="password" autocomplete="new-password" placeholder="仅在替换时填写" /></label>
        <template v-if="isCN">
          <label>账号模式<select :value="text(credentials, 'account_mode', AccountModeOption.PAYG)" @change="setText(credentials, 'account_mode', $event, true)"><option :value="AccountModeOption.PAYG">按量付费</option><option :value="AccountModeOption.CODING">Coding 套餐</option></select></label>
          <label>API 协议<select :value="text(credentials, 'api_protocol', ApiProtocolOption.CHAT)" @change="setText(credentials, 'api_protocol', $event, true)"><option :value="ApiProtocolOption.CHAT">Chat Completions</option><option :value="ApiProtocolOption.ANTHROPIC">Anthropic Messages</option><option v-if="platform === AccountPlatformOption.DEEPSEEK" :value="ApiProtocolOption.RESPONSES">Responses</option></select></label>
        </template>
        <label v-if="platform === AccountPlatformOption.GEMINI">Gemini 档位<select :value="text(credentials, 'tier_id', 'aistudio_free')" @change="setText(credentials, 'tier_id', $event, true)"><option value="aistudio_free">AI Studio Free</option><option value="aistudio_paid">AI Studio Paid</option><option value="google_one_free">Google One Free</option><option value="google_ai_pro">Google AI Pro</option><option value="google_ai_ultra">Google AI Ultra</option><option value="gcp_standard">GCP Standard</option><option value="gcp_enterprise">GCP Enterprise</option></select></label>
      </div>
      <div v-else-if="isBedrock" class="resource-form-grid resource-form-grid--3">
        <label>认证方式<select :value="text(credentials, 'auth_mode', BedrockAuthOption.SIGV4)" @change="setText(credentials, 'auth_mode', $event, true)"><option :value="BedrockAuthOption.SIGV4">AWS SigV4</option><option :value="BedrockAuthOption.API_KEY">Bedrock API Key</option></select></label>
        <label>区域<input :value="text(credentials, 'aws_region', 'us-east-1')" @input="setText(credentials, 'aws_region', $event, true)" /></label>
        <label class="resource-check"><input :checked="text(credentials, 'aws_force_global') === 'true'" type="checkbox" @change="credentials.aws_force_global = inputChecked($event) ? 'true' : undefined" /><span>强制 Global 端点</span></label>
        <template v-if="text(credentials, 'auth_mode', BedrockAuthOption.SIGV4) === BedrockAuthOption.SIGV4"><label>Access Key ID<input :value="text(credentials, 'aws_access_key_id')" autocomplete="off" @input="setText(credentials, 'aws_access_key_id', $event)" /></label><label>Secret Access Key<input v-model="secret.awsSecret" type="password" autocomplete="new-password" placeholder="留空保留" /></label><label>Session Token<input v-model="secret.awsSession" type="password" autocomplete="new-password" placeholder="可选，留空保留" /></label></template>
        <label v-else>API Key<input v-model="secret.apiKey" type="password" autocomplete="new-password" placeholder="留空保留" /></label>
      </div>
      <div v-else-if="isServiceAccount" class="resource-form-grid resource-form-grid--3">
        <label class="resource-field--wide">Service Account JSON {{ hasServiceAccount ? '（已配置，留空保留）' : '*' }}<textarea v-model="secret.serviceAccount" rows="5" class="resource-code" /></label>
        <label>Project ID<input :value="text(credentials, 'project_id')" @input="setText(credentials, 'project_id', $event)" /></label><label>Client Email<input :value="text(credentials, 'client_email')" type="email" @input="setText(credentials, 'client_email', $event)" /></label><label>Location<input :value="text(credentials, 'location', 'global')" @input="setText(credentials, 'location', $event, true)" /></label>
      </div>
    </fieldset>

    <fieldset class="resource-form-section">
      <legend>模型白名单与映射</legend>
      <div class="section-heading"><p>源模型支持末尾通配符；精确模型不得与同前缀通配规则并存。</p><button v-if="platform === AccountPlatformOption.ANTIGRAVITY" class="resource-button resource-button--secondary" type="button" @click="loadAntigravityMapping">载入默认映射</button></div>
      <div class="mapping-list"><div v-for="(row, index) in modelMappings" :key="index" class="mapping-row"><input v-model="row.from" aria-label="请求模型" placeholder="请求模型，例如 gpt-*" /><span>→</span><input v-model="row.to" aria-label="上游模型" placeholder="上游模型" /><button type="button" aria-label="移除模型映射" @click="removeMapping(modelMappings, index)">×</button></div><button class="resource-button resource-button--secondary" type="button" @click="addMapping(modelMappings)">新增模型映射</button></div>
      <template v-if="platform === AccountPlatformOption.OPENAI"><div class="resource-form-grid resource-form-grid--3"><label class="resource-check"><input :checked="capabilityChecked('chat_completions')" type="checkbox" @change="toggleCapability('chat_completions', $event)" /><span>文本生成端点</span></label><label class="resource-check"><input :checked="capabilityChecked('embeddings')" type="checkbox" @change="toggleCapability('embeddings', $event)" /><span>Embeddings</span></label></div><strong class="subheading">Compact 模型映射</strong><div class="mapping-list"><div v-for="(row, index) in compactMappings" :key="index" class="mapping-row"><input v-model="row.from" aria-label="Compact 请求模型" placeholder="请求模型" /><span>→</span><input v-model="row.to" aria-label="Compact 上游模型" placeholder="上游模型" /><button type="button" aria-label="移除 Compact 映射" @click="removeMapping(compactMappings, index)">×</button></div><button class="resource-button resource-button--secondary" type="button" @click="addMapping(compactMappings)">新增 Compact 映射</button></div></template>
    </fieldset>

    <fieldset v-if="platform === AccountPlatformOption.OPENAI" class="resource-form-section"><legend>OpenAI / Codex 专项行为</legend><div class="resource-form-grid resource-form-grid--3">
      <label class="resource-check"><input :checked="checked(extra, 'openai_passthrough')" type="checkbox" @change="setBoolean(extra, 'openai_passthrough', $event)" /><span>自动透传模型</span></label><label v-if="type === AccountTypeOption.OAUTH" class="resource-check"><input :checked="checked(extra, 'openai_responses_flatten_namespaces')" type="checkbox" @change="setBoolean(extra, 'openai_responses_flatten_namespaces', $event)" /><span>扁平化 Responses 命名空间</span></label><label class="resource-check"><input :checked="checked(extra, 'openai_long_context_billing_enabled')" type="checkbox" @change="setBoolean(extra, 'openai_long_context_billing_enabled', $event)" /><span>长上下文计费</span></label>
      <label>Responses WebSocket<select :value="text(extra, openAIWsKey, OpenAIWSOption.OFF)" @change="setText(extra, openAIWsKey, $event, true)"><option :value="OpenAIWSOption.OFF">关闭</option><option :value="OpenAIWSOption.CONTEXT_POOL">上下文池</option><option :value="OpenAIWSOption.PASSTHROUGH">透传</option><option :value="OpenAIWSOption.HTTP_BRIDGE">HTTP Bridge</option></select></label><label>Compact 模式<select :value="text(extra, 'openai_compact_mode', OpenAICompactOption.AUTO)" @change="setText(extra, 'openai_compact_mode', $event, true)"><option :value="OpenAICompactOption.AUTO">自动</option><option :value="OpenAICompactOption.FORCE_ON">强制开启</option><option :value="OpenAICompactOption.FORCE_OFF">强制关闭</option></select></label><label v-if="type === AccountTypeOption.API_KEY">Responses 模式<select :value="text(extra, 'openai_responses_mode', OpenAIResponsesOption.AUTO)" @change="setText(extra, 'openai_responses_mode', $event, true)"><option :value="OpenAIResponsesOption.AUTO">自动</option><option :value="OpenAIResponsesOption.RESPONSES">强制 Responses</option><option :value="OpenAIResponsesOption.CHAT">强制 Chat Completions</option></select></label>
      <label>Codex 图片工具<select :value="codexImageMode()" @change="setCodexImageMode"><option :value="CodexImageOption.INHERIT">继承全局</option><option :value="CodexImageOption.ENABLED">启用桥接</option><option :value="CodexImageOption.DISABLED">关闭桥接</option><option :value="CodexImageOption.BLOCK">阻止显式图片工具</option></select></label><label v-if="isOAuth" class="resource-check"><input :checked="checked(extra, 'codex_cli_only')" type="checkbox" @change="setBoolean(extra, 'codex_cli_only', $event)" /><span>仅 Codex CLI</span></label><label v-if="isOAuth" class="resource-check"><input :checked="checked(extra, 'codex_cli_only_allow_app_server')" type="checkbox" @change="setBoolean(extra, 'codex_cli_only_allow_app_server', $event)" /><span>允许 App Server</span></label>
      <label v-if="type === AccountTypeOption.OAUTH">指纹收敛<select :value="text(extra, 'codex_fingerprint_mode', CodexFingerprintOption.OFF)" @change="setText(extra, 'codex_fingerprint_mode', $event, true)"><option :value="CodexFingerprintOption.OFF">关闭</option><option :value="CodexFingerprintOption.DEVICE">设备</option><option :value="CodexFingerprintOption.SESSION">会话</option><option :value="CodexFingerprintOption.FULL">完整</option></select></label><label v-if="type === AccountTypeOption.OAUTH">订阅档位<input :value="text(credentials, 'plan_type')" placeholder="自动识别 / plus / chatgptpro / team / free" @input="setText(credentials, 'plan_type', $event)" /></label><label>5h 自动暂停阈值（0–1）<input :value="text(extra, 'auto_pause_5h_threshold')" type="number" min="0" max="1" step="0.01" @input="setNumber(extra, 'auto_pause_5h_threshold', $event)" /></label><label>7d 自动暂停阈值（0–1）<input :value="text(extra, 'auto_pause_7d_threshold')" type="number" min="0" max="1" step="0.01" @input="setNumber(extra, 'auto_pause_7d_threshold', $event)" /></label><label class="resource-check"><input :checked="checked(extra, 'auto_pause_5h_disabled')" type="checkbox" @change="setBoolean(extra, 'auto_pause_5h_disabled', $event)" /><span>禁用 5h 自动暂停</span></label><label class="resource-check"><input :checked="checked(extra, 'auto_pause_7d_disabled')" type="checkbox" @change="setBoolean(extra, 'auto_pause_7d_disabled', $event)" /><span>禁用 7d 自动暂停</span></label>
    </div></fieldset>

    <fieldset v-if="platform === AccountPlatformOption.ANTHROPIC && type === AccountTypeOption.API_KEY" class="resource-form-section"><legend>Anthropic API Key 专项行为</legend><div class="resource-form-grid resource-form-grid--3"><label class="resource-check"><input :checked="checked(extra, 'anthropic_passthrough')" type="checkbox" @change="setBoolean(extra, 'anthropic_passthrough', $event)" /><span>API Key 透传</span></label><label>认证头<select :value="text(extra, 'anthropic_apikey_auth_scheme', 'x_api_key')" @change="setText(extra, 'anthropic_apikey_auth_scheme', $event, true)"><option value="x_api_key">x-api-key</option><option value="authorization_bearer">Authorization Bearer</option></select></label><label>Web Search 模拟<select :value="text(extra, 'web_search_emulation', 'default')" @change="setText(extra, 'web_search_emulation', $event, true)"><option value="default">继承全局</option><option value="on">启用</option><option value="off">关闭</option></select></label></div></fieldset>

    <fieldset v-if="platform === AccountPlatformOption.ANTIGRAVITY" class="resource-form-section"><legend>Antigravity 专项行为</legend><div class="resource-form-grid resource-form-grid--3"><label v-if="isOAuth">Project ID<input :value="text(credentials, 'antigravity_project_id')" @input="setText(credentials, 'antigravity_project_id', $event)" /></label><label class="resource-check"><input :checked="checked(extra, 'mixed_scheduling')" type="checkbox" @change="setBoolean(extra, 'mixed_scheduling', $event)" /><span>跨平台混合调度</span></label><label class="resource-check"><input :checked="checked(extra, 'allow_overages')" type="checkbox" @change="setBoolean(extra, 'allow_overages', $event)" /><span>允许 AI Credits 超额</span></label></div></fieldset>
    <fieldset v-if="platform === AccountPlatformOption.GROK" class="resource-form-section"><legend>Grok 专项行为</legend><div class="resource-form-grid resource-form-grid--3"><label class="resource-check"><input :checked="extra.grok_client_tool_cache_enabled !== false" type="checkbox" @change="extra.grok_client_tool_cache_enabled = inputChecked($event)" /><span>客户端工具缓存</span></label></div></fieldset>

    <fieldset class="resource-form-section"><legend>请求恢复与故障策略</legend><div class="resource-form-grid resource-form-grid--3">
      <label class="resource-check"><input :checked="checked(credentials, 'intercept_warmup_requests')" type="checkbox" @change="setBoolean(credentials, 'intercept_warmup_requests', $event)" /><span>拦截预热请求</span></label><label>账号调度阈值<input :value="text(credentials, 'account_scheduling_threshold')" type="number" min="0" step="any" @input="setNumber(credentials, 'account_scheduling_threshold', $event)" /></label><label class="resource-check"><input :checked="checked(credentials, 'pool_mode')" type="checkbox" @change="setBoolean(credentials, 'pool_mode', $event)" /><span>启用凭据池模式</span></label><label v-if="checked(credentials, 'pool_mode')">池重试次数<input :value="text(credentials, 'pool_mode_retry_count', '2')" type="number" min="0" @input="setNumber(credentials, 'pool_mode_retry_count', $event)" /></label><label v-if="checked(credentials, 'pool_mode')" class="resource-field--wide">池重试状态码<input :value="Array.isArray(credentials.pool_mode_retry_status_codes) ? credentials.pool_mode_retry_status_codes.join(',') : ''" placeholder="429,500,502,503" @input="credentials.pool_mode_retry_status_codes = splitValues(inputValue($event)).map(Number)" /></label><label class="resource-check"><input :checked="checked(credentials, 'custom_error_codes_enabled')" type="checkbox" @change="setBoolean(credentials, 'custom_error_codes_enabled', $event)" /><span>自定义错误码</span></label><label v-if="checked(credentials, 'custom_error_codes_enabled')" class="resource-field--wide">错误码<input :value="Array.isArray(credentials.custom_error_codes) ? credentials.custom_error_codes.join(',') : ''" placeholder="400,401,403" @input="credentials.custom_error_codes = splitValues(inputValue($event)).map(Number)" /></label>
    </div>
      <template v-if="headerCapable"><strong class="subheading">请求头覆盖</strong><label class="resource-check"><input :checked="checked(credentials, 'header_override_enabled')" type="checkbox" @change="setBoolean(credentials, 'header_override_enabled', $event)" /><span>启用请求头覆盖</span></label><div v-if="checked(credentials, 'header_override_enabled')" class="mapping-list"><div v-for="(row, index) in headerRows" :key="index" class="mapping-row"><input v-model="row.name" aria-label="Header 名称" placeholder="x-custom-header" /><span>:</span><input v-model="row.value" aria-label="Header 值" placeholder="value" /><button type="button" aria-label="移除 Header" @click="headerRows.splice(index, 1)">×</button></div><button class="resource-button resource-button--secondary" type="button" @click="addHeader">新增 Header</button></div></template>
      <strong class="subheading">临时不可调度规则</strong><label class="resource-check"><input :checked="checked(credentials, 'temp_unschedulable_enabled')" type="checkbox" @change="setBoolean(credentials, 'temp_unschedulable_enabled', $event)" /><span>启用按错误自动临时摘除</span></label><div v-if="checked(credentials, 'temp_unschedulable_enabled')" class="temp-rules"><article v-for="(rule, index) in tempRules" :key="index"><div class="resource-form-grid resource-form-grid--3"><label>HTTP 状态码<input v-model="rule.error_code" type="number" min="100" max="599" /></label><label>持续分钟<input v-model="rule.duration_minutes" type="number" min="1" /></label><label class="resource-field--wide">关键词（逗号或换行）<textarea v-model="rule.keywords" rows="2" /></label><label class="resource-field--wide">说明<input v-model="rule.description" /></label></div><button type="button" @click="tempRules.splice(index, 1)">删除规则</button></article><button class="resource-button resource-button--secondary" type="button" @click="addTempRule">新增临时摘除规则</button></div>
    </fieldset>

    <fieldset v-if="type === AccountTypeOption.API_KEY || type === AccountTypeOption.BEDROCK" class="resource-form-section"><legend>配额通知覆盖</legend><p class="muted">仅启用的维度覆盖全局通知阈值；关闭后回到全局策略。</p><div class="quota-notify-grid"><article v-for="dimension in ['daily','weekly','total']" :key="dimension"><label class="resource-check"><input :checked="checked(extra, `quota_notify_${dimension}_enabled`)" type="checkbox" @change="setBoolean(extra, `quota_notify_${dimension}_enabled`, $event)" /><span>{{ dimension }}</span></label><template v-if="checked(extra, `quota_notify_${dimension}_enabled`)"><input :value="text(extra, `quota_notify_${dimension}_threshold`)" type="number" min="0" @input="setNumber(extra, `quota_notify_${dimension}_threshold`, $event)" /><select :value="text(extra, `quota_notify_${dimension}_threshold_type`, QuotaThresholdOption.FIXED)" @change="setText(extra, `quota_notify_${dimension}_threshold_type`, $event, true)"><option :value="QuotaThresholdOption.FIXED">固定余额 $</option><option :value="QuotaThresholdOption.PERCENTAGE">剩余比例 %</option></select></template></article></div></fieldset>
  </div>
</template>

<style scoped>
.platform-config__intro { padding: 12px 14px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-subtle)); border-radius: 12px; }.platform-config__intro > div:first-child { display: grid; gap: 4px; }.platform-config__intro span, .section-heading p { color: var(--text-secondary); font-size: var(--font-meta); }.credential-flags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }.credential-flags span { padding: 4px 7px; color: var(--success); background: color-mix(in srgb, var(--success) 10%, var(--surface-raised)); border-radius: 999px; }.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.section-heading p { margin: 0; }.subheading { font-size: var(--font-body-sm); }.mapping-list, .temp-rules { display: grid; gap: 8px; }.mapping-row { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) auto; align-items: center; gap: 7px; }.mapping-row > button, .temp-rules article > button { min-height: 38px; padding: 0 10px; color: var(--danger); background: transparent; border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; }.temp-rules article { padding: 12px; display: grid; gap: 9px; background: var(--surface-canvas); border-radius: 10px; }.quota-notify-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }.quota-notify-grid article { padding: 10px; display: grid; gap: 8px; background: var(--surface-canvas); border-radius: 10px; } @media(max-width:800px){.platform-config__intro,.section-heading{align-items:stretch;flex-direction:column}.credential-flags{justify-content:flex-start}.mapping-row{grid-template-columns:1fr auto}.mapping-row input:nth-of-type(2){grid-column:1}.quota-notify-grid{grid-template-columns:1fr}}
</style>
