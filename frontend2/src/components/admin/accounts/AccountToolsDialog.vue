<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import * as accountsAPI from '@shared-api/admin/accounts'
import * as antigravityAPI from '@shared-api/admin/antigravity'
import * as grokAPI from '@shared-api/admin/grok'
import type { AdminDataPayload, AdminGroup, CreateAccountRequest, Proxy } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { buildOAuthCredentialPayload } from '@/features/admin/resources/account'
import { parseJsonValue, splitValues } from '@/features/admin/resources/model'
import { useAppStore } from '@/stores/app'

enum ToolsTab { IMPORT = 'import', CRS = 'crs', CODEX = 'codex', PAT = 'pat', GROK = 'grok', OAUTH_BATCH = 'oauth_batch', PREVIEW = 'preview', BATCH = 'batch' }
enum OAuthBatchPlatform { OPENAI = 'openai', ANTIGRAVITY = 'antigravity', GROK = 'grok' }
enum OAuthBatchMethod { REFRESH_TOKEN = 'refresh_token', MOBILE_REFRESH_TOKEN = 'mobile_refresh_token', EMAIL_PASSWORD = 'email_password' }

const toolsTabLabels: Record<ToolsTab, string> = { [ToolsTab.IMPORT]: '数据导入', [ToolsTab.CRS]: 'CRS 同步', [ToolsTab.CODEX]: 'Codex Session', [ToolsTab.PAT]: 'Codex PAT', [ToolsTab.GROK]: 'Grok SSO', [ToolsTab.OAUTH_BATCH]: '批量授权', [ToolsTab.PREVIEW]: '模型预览', [ToolsTab.BATCH]: 'JSON 批量' }
const oauthPlatformLabels: Record<OAuthBatchPlatform, string> = { [OAuthBatchPlatform.OPENAI]: 'OpenAI / Codex', [OAuthBatchPlatform.ANTIGRAVITY]: 'Antigravity', [OAuthBatchPlatform.GROK]: 'Grok' }
const oauthMethodLabels: Record<OAuthBatchMethod, string> = { [OAuthBatchMethod.REFRESH_TOKEN]: 'Refresh Token', [OAuthBatchMethod.MOBILE_REFRESH_TOKEN]: 'Mobile Refresh Token', [OAuthBatchMethod.EMAIL_PASSWORD]: '邮箱 + 密码' }
const OPENAI_MOBILE_CLIENT_ID = 'app_LlGpXReQgckcGGUo2JrYvtJK'

const props = defineProps<{ show: boolean; groups: AdminGroup[]; proxies: Proxy[] }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const app = useAppStore()
const tab = ref(ToolsTab.IMPORT)
const running = ref(false)
const result = ref<unknown>(null)
const form = reactive({
  import_json: '', skip_default_group_bind: false,
  crs_base_url: '', crs_username: '', crs_password: '', crs_sync_proxies: true, crs_selected: [] as string[],
  codex_content: '', codex_name: '', codex_update_existing: true, pat: '', pat_name: '', grok_tokens: '', grok_name: '',
  special_notes: '', special_proxy_id: '' as number | '', special_group_ids: [] as number[], special_concurrency: 1, special_priority: 0, special_load_factor: '' as number | '', special_rate_multiplier: 1, special_expires_at: '', special_auto_pause_on_expired: false, special_credentials_json: '{}', special_extra_json: '{}',
  oauth_platform: OAuthBatchPlatform.OPENAI, oauth_method: OAuthBatchMethod.REFRESH_TOKEN, oauth_values: '', oauth_name: '', oauth_notes: '', oauth_proxy_id: '' as number | '', oauth_group_ids: [] as number[], oauth_concurrency: 1, oauth_priority: 0, oauth_load_factor: '' as number | '', oauth_rate_multiplier: 1, oauth_credentials_json: '{}', oauth_extra_json: '{}',
  preview_platform: 'openai', preview_type: 'upstream', preview_base_url: '', preview_api_key: '', batch_json: '[]'
})
const crsPreview = ref<Awaited<ReturnType<typeof accountsAPI.previewFromCrs>> | null>(null)
const oauthMethods = computed<OAuthBatchMethod[]>(() => {
  if (form.oauth_platform === OAuthBatchPlatform.OPENAI) return [OAuthBatchMethod.REFRESH_TOKEN, OAuthBatchMethod.MOBILE_REFRESH_TOKEN]
  if (form.oauth_platform === OAuthBatchPlatform.GROK) return [OAuthBatchMethod.REFRESH_TOKEN, OAuthBatchMethod.EMAIL_PASSWORD]
  return [OAuthBatchMethod.REFRESH_TOKEN]
})
const resultText = computed(() => result.value == null ? '' : JSON.stringify(result.value, null, 2))
async function run<T>(action: () => Promise<T>, success: string): Promise<T | null> { if (running.value) return null; running.value = true; try { const value = await action(); result.value = value; app.showSuccess(success); return value } catch (caught) { app.showError((caught as { message?: string }).message || '工具执行失败'); return null } finally { running.value = false } }
async function importData(): Promise<void> { const payload = parseJsonValue<AdminDataPayload>(form.import_json, '导入数据', { exported_at: '', proxies: [], accounts: [] }); const value = await run(() => accountsAPI.importData({ data: payload, skip_default_group_bind: form.skip_default_group_bind }), '账号数据已导入'); if (value) { form.import_json = ''; emit('changed') } }
async function previewCrs(): Promise<void> { if (!form.crs_base_url.trim() || !form.crs_username.trim() || !form.crs_password) { app.showError('CRS 地址、用户名和密码不能为空'); return } crsPreview.value = await run(() => accountsAPI.previewFromCrs({ base_url: form.crs_base_url, username: form.crs_username, password: form.crs_password }), 'CRS 预览已加载'); if (crsPreview.value) form.crs_selected = crsPreview.value.new_accounts.map(item => item.crs_account_id) }
function toggleCrs(id: string): void { form.crs_selected = form.crs_selected.includes(id) ? form.crs_selected.filter(item => item !== id) : [...form.crs_selected, id] }
async function syncCrs(): Promise<void> { if (!form.crs_selected.length) { app.showError('请至少选择一个 CRS 账号'); return } const value = await run(() => accountsAPI.syncFromCrs({ base_url: form.crs_base_url, username: form.crs_username, password: form.crs_password, sync_proxies: form.crs_sync_proxies, selected_account_ids: form.crs_selected }), 'CRS 同步已完成'); if (value) { form.crs_password = ''; emit('changed') } }
function specialtyOptions(): { notes: string | null; proxy_id: number | null; group_ids: number[]; concurrency: number; priority: number; rate_multiplier: number; load_factor: number | null; expires_at: number | null; auto_pause_on_expired: boolean; credential_extras: Record<string, unknown>; extra: Record<string, unknown> } {
  return {
    notes: form.special_notes.trim() || null,
    proxy_id: form.special_proxy_id === '' ? null : Number(form.special_proxy_id),
    group_ids: [...form.special_group_ids],
    concurrency: form.special_concurrency,
    priority: form.special_priority,
    rate_multiplier: form.special_rate_multiplier,
    load_factor: form.special_load_factor === '' ? null : Number(form.special_load_factor),
    expires_at: form.special_expires_at ? Math.floor(new Date(form.special_expires_at).getTime() / 1000) : null,
    auto_pause_on_expired: form.special_auto_pause_on_expired,
    credential_extras: parseJsonValue<Record<string, unknown>>(form.special_credentials_json, '凭据附加配置', {}),
    extra: parseJsonValue<Record<string, unknown>>(form.special_extra_json, '账号扩展配置', {})
  }
}
async function importCodex(): Promise<void> { if (!form.codex_content.trim()) { app.showError('Codex Session 内容不能为空'); return } let options; try { options = specialtyOptions() } catch (caught) { app.showError((caught as Error).message); return } const value = await run(() => accountsAPI.importCodexSession({ content: form.codex_content, name: form.codex_name.trim() || undefined, ...options, update_existing: form.codex_update_existing, skip_default_group_bind: form.skip_default_group_bind }), 'Codex Session 导入完成'); if (value) { form.codex_content = ''; emit('changed') } }
async function createPat(): Promise<void> { if (!form.pat.trim()) { app.showError('Codex PAT / Access Token 不能为空'); return } let options; try { options = specialtyOptions() } catch (caught) { app.showError((caught as Error).message); return } const { credential_extras, ...rest } = options; const value = await run(() => accountsAPI.createOpenAICodexPAT({ access_token: form.pat.trim(), name: form.pat_name.trim() || undefined, ...rest, credential_extras, skip_default_group_bind: form.skip_default_group_bind }), 'Codex PAT 账号已创建'); if (value) { form.pat = ''; emit('changed') } }
async function importGrok(): Promise<void> { const tokens = splitValues(form.grok_tokens); if (!tokens.length) { app.showError('至少输入一个 Grok SSO Token'); return } let options; try { options = specialtyOptions() } catch (caught) { app.showError((caught as Error).message); return } const { credential_extras, load_factor, ...rest } = options; const value = await run(() => grokAPI.createFromSSO({ sso_tokens: tokens, name: form.grok_name.trim() || undefined, ...rest, load_factor: load_factor ?? undefined, credentials: credential_extras }), 'Grok SSO 导入完成'); if (value) { form.grok_tokens = ''; emit('changed') } }
function oauthBatchRows(): string[] {
  if (form.oauth_method === OAuthBatchMethod.EMAIL_PASSWORD) return form.oauth_values.split(/\r?\n/).filter(line => line.trim() && line.includes('----'))
  return splitValues(form.oauth_values)
}
async function exchangeOAuthBatchValue(value: string): Promise<Record<string, unknown>> {
  const proxyId = form.oauth_proxy_id === '' ? null : Number(form.oauth_proxy_id)
  if (form.oauth_platform === OAuthBatchPlatform.OPENAI) return accountsAPI.refreshOpenAIToken(value, proxyId, '/admin/openai/refresh-token', form.oauth_method === OAuthBatchMethod.MOBILE_REFRESH_TOKEN ? OPENAI_MOBILE_CLIENT_ID : undefined)
  if (form.oauth_platform === OAuthBatchPlatform.ANTIGRAVITY) return antigravityAPI.refreshAntigravityToken(value, proxyId)
  if (form.oauth_method === OAuthBatchMethod.EMAIL_PASSWORD) return grokAPI.authorizePassword(value, proxyId)
  return grokAPI.refreshGrokToken(value, proxyId)
}
async function batchOAuthCreate(): Promise<void> {
  if (running.value) return
  const rows = oauthBatchRows()
  if (!rows.length) { app.showError(form.oauth_method === OAuthBatchMethod.EMAIL_PASSWORD ? '请输入 email----password，每行一组' : '请输入至少一个 Refresh Token'); return }
  let credentialExtras: Record<string, unknown>; let extraBase: Record<string, unknown>
  try {
    credentialExtras = parseJsonValue<Record<string, unknown>>(form.oauth_credentials_json, '凭据附加配置', {})
    extraBase = parseJsonValue<Record<string, unknown>>(form.oauth_extra_json, '账号扩展配置', {})
  } catch (caught) { app.showError((caught as Error).message); return }
  running.value = true
  const results: Array<{ index: number; success: boolean; account_id?: number; name?: string; error?: string }> = []
  for (let index = 0; index < rows.length; index += 1) {
    try {
      const token = await exchangeOAuthBatchValue(rows[index])
      const built = buildOAuthCredentialPayload(form.oauth_platform, token, { refreshTokenFallback: form.oauth_method === OAuthBatchMethod.EMAIL_PASSWORD ? undefined : rows[index] })
      const credentials = { ...credentialExtras, ...built.credentials }
      if (form.oauth_method === OAuthBatchMethod.MOBILE_REFRESH_TOKEN) credentials.client_id = OPENAI_MOBILE_CLIENT_ID
      const fallbackName = typeof token.email === 'string' && token.email.trim() ? token.email.trim() : oauthPlatformLabels[form.oauth_platform]
      const baseName = form.oauth_name.trim() || fallbackName
      const name = rows.length > 1 ? `${baseName} #${index + 1}` : baseName
      const payload: CreateAccountRequest = {
        name,
        notes: form.oauth_notes.trim() || null,
        platform: form.oauth_platform,
        type: 'oauth',
        credentials,
        extra: { ...extraBase, ...built.extra },
        proxy_id: form.oauth_proxy_id === '' ? null : Number(form.oauth_proxy_id),
        group_ids: [...form.oauth_group_ids],
        concurrency: form.oauth_concurrency,
        priority: form.oauth_priority,
        load_factor: form.oauth_load_factor === '' ? null : Number(form.oauth_load_factor),
        rate_multiplier: form.oauth_rate_multiplier
      }
      const account = await accountsAPI.create(payload)
      results.push({ index: index + 1, success: true, account_id: account.id, name: account.name })
    } catch (caught) {
      results.push({ index: index + 1, success: false, error: (caught as { message?: string }).message || '授权或创建失败' })
    }
  }
  running.value = false
  const success = results.filter(item => item.success).length
  const failed = results.length - success
  result.value = { platform: form.oauth_platform, method: form.oauth_method, total: rows.length, success, failed, results }
  if (success) { emit('changed'); if (!failed) form.oauth_values = ''; app.showSuccess(failed ? `成功 ${success} 个，失败 ${failed} 个` : `已创建 ${success} 个 OAuth 账号`) }
  else app.showError(`全部 ${failed} 个账号授权或创建失败`)
}
async function previewModels(): Promise<void> { const value = await run(() => accountsAPI.syncUpstreamModelsPreview({ platform: form.preview_platform, type: form.preview_type, base_url: form.preview_base_url || undefined, api_key: form.preview_api_key }), '已读取上游模型'); if (value) form.preview_api_key = '' }
async function loadAntigravityMapping(): Promise<void> { const mapping = await run(() => accountsAPI.getAntigravityDefaultModelMapping(), '已读取 Antigravity 默认映射'); if (mapping) result.value = { model_mapping: mapping } }
async function batchCreate(): Promise<void> { const rows = parseJsonValue<CreateAccountRequest[]>(form.batch_json, '批量账号', []); const value = await run(() => accountsAPI.batchCreate(rows), '批量创建已完成'); if (value) emit('changed') }
async function loadFile(event: Event): Promise<void> { const file = (event.target as HTMLInputElement).files?.[0]; if (file) form.import_json = await file.text() }
watch(tab, () => { result.value = null })
watch(() => form.oauth_platform, () => { if (!oauthMethods.value.includes(form.oauth_method)) form.oauth_method = OAuthBatchMethod.REFRESH_TOKEN })
watch(() => props.show, (show) => { if (show) { tab.value = ToolsTab.IMPORT; result.value = null; crsPreview.value = null; form.crs_password = ''; form.pat = ''; form.grok_tokens = ''; form.oauth_values = ''; form.preview_api_key = '' } })
</script>
<template><SurfaceDialog :show="show" title="账号导入与平台工具" description="敏感输入只在当前对话框使用；结果不写入浏览器持久化存储。" :width="DialogWidth.WIDE" @close="emit('close')"><div class="resource-form-stack"><div class="resource-tabs"><button v-for="item in ToolsTab" :key="item" :aria-selected="tab === item" @click="tab = item">{{ toolsTabLabels[item] }}</button></div>
  <fieldset v-if="[ToolsTab.CODEX, ToolsTab.PAT, ToolsTab.GROK].includes(tab)" class="resource-form-section"><legend>新账号公共配置</legend><div class="resource-form-grid resource-form-grid--3"><label>代理<select v-model.number="form.special_proxy_id"><option value="">直连</option><option v-for="proxy in proxies" :key="proxy.id" :value="proxy.id">{{ proxy.name }}</option></select></label><label>并发<input v-model.number="form.special_concurrency" type="number" min="1" /></label><label>优先级<input v-model.number="form.special_priority" type="number" /></label><label>负载系数<input v-model.number="form.special_load_factor" type="number" min="0" step="0.1" placeholder="默认" /></label><label>计费倍率<input v-model.number="form.special_rate_multiplier" type="number" min="0" step="0.01" /></label><label>到期时间<input v-model="form.special_expires_at" type="datetime-local" /></label><label class="oauth-groups">绑定分组<select v-model="form.special_group_ids" multiple><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.platform }}</option></select></label><label>备注<textarea v-model="form.special_notes" rows="3" /></label><label class="resource-check"><input v-model="form.special_auto_pause_on_expired" type="checkbox" /><span>到期自动暂停</span></label></div><details><summary>高级账号配置</summary><div class="resource-form-grid"><label>凭据附加配置 JSON<textarea v-model="form.special_credentials_json" rows="6" class="resource-code" /></label><label>账号扩展配置 JSON<textarea v-model="form.special_extra_json" rows="6" class="resource-code" /></label></div></details></fieldset>
  <section v-if="tab === ToolsTab.IMPORT" class="resource-form-stack"><input type="file" accept=".json,application/json" @change="loadFile" /><label>导出 JSON<textarea v-model="form.import_json" rows="12" class="resource-code" /></label><label class="resource-check"><input v-model="form.skip_default_group_bind" type="checkbox" /><span>跳过默认分组绑定</span></label><button class="resource-button" :disabled="running" @click="importData">导入数据</button></section>
  <section v-else-if="tab === ToolsTab.CRS" class="resource-form-stack"><div class="resource-form-grid resource-form-grid--3"><label>CRS Base URL<input v-model="form.crs_base_url" type="url" /></label><label>用户名<input v-model="form.crs_username" /></label><label>密码<input v-model="form.crs_password" type="password" /></label><label class="resource-check"><input v-model="form.crs_sync_proxies" type="checkbox" /><span>同步代理</span></label></div><div class="resource-inline-actions"><button class="resource-button resource-button--secondary" :disabled="running" @click="previewCrs">预览</button><button class="resource-button" :disabled="running || !crsPreview" @click="syncCrs">同步选中账号</button></div><div v-if="crsPreview" class="crs-list"><label v-for="item in [...crsPreview.new_accounts, ...crsPreview.existing_accounts]" :key="item.crs_account_id"><input type="checkbox" :checked="form.crs_selected.includes(item.crs_account_id)" @change="toggleCrs(item.crs_account_id)" /><span><strong>{{ item.name }}</strong><small>{{ item.kind }} · {{ item.platform }} · {{ crsPreview.new_accounts.includes(item) ? '新增' : '已存在' }}</small></span></label></div></section>
  <section v-else-if="tab === ToolsTab.CODEX" class="resource-form-stack"><label>账号名称前缀<input v-model="form.codex_name" /></label><label>Codex Session 内容<textarea v-model="form.codex_content" rows="13" class="resource-code" /></label><label class="resource-check"><input v-model="form.codex_update_existing" type="checkbox" /><span>更新已存在账号</span></label><label class="resource-check"><input v-model="form.skip_default_group_bind" type="checkbox" /><span>跳过默认分组绑定</span></label><button class="resource-button" :disabled="running" @click="importCodex">导入 Codex Session</button></section>
  <section v-else-if="tab === ToolsTab.PAT" class="resource-form-stack"><label>账号名称<input v-model="form.pat_name" /></label><label>Codex PAT / Access Token<textarea v-model="form.pat" rows="7" /></label><label class="resource-check"><input v-model="form.skip_default_group_bind" type="checkbox" /><span>跳过默认分组绑定</span></label><button class="resource-button" :disabled="running" @click="createPat">创建 PAT 账号</button></section>
  <section v-else-if="tab === ToolsTab.GROK" class="resource-form-stack"><label>账号名称前缀<input v-model="form.grok_name" /></label><label>Grok SSO Token（逗号或换行）<textarea v-model="form.grok_tokens" rows="10" /></label><button class="resource-button" :disabled="running" @click="importGrok">转换并创建 OAuth 账号</button></section>
  <section v-else-if="tab === ToolsTab.OAUTH_BATCH" class="resource-form-stack"><p class="muted">逐条向对应平台换取凭据后创建账号；Refresh Token、密码和换取过程中的一次性秘密不会写入浏览器存储。单条失败不会中断其余账号。</p><div class="resource-form-grid resource-form-grid--3"><label>平台<select v-model="form.oauth_platform"><option v-for="item in OAuthBatchPlatform" :key="item" :value="item">{{ oauthPlatformLabels[item] }}</option></select></label><label>授权方式<select v-model="form.oauth_method"><option v-for="item in oauthMethods" :key="item" :value="item">{{ oauthMethodLabels[item] }}</option></select></label><label>账号名称前缀<input v-model="form.oauth_name" placeholder="留空则使用账号邮箱" /></label><label>代理<select v-model.number="form.oauth_proxy_id"><option value="">直连</option><option v-for="proxy in proxies" :key="proxy.id" :value="proxy.id">{{ proxy.name }}</option></select></label><label>并发<input v-model.number="form.oauth_concurrency" type="number" min="1" /></label><label>优先级<input v-model.number="form.oauth_priority" type="number" /></label><label>负载系数<input v-model.number="form.oauth_load_factor" type="number" min="0" step="0.1" placeholder="默认" /></label><label>计费倍率<input v-model.number="form.oauth_rate_multiplier" type="number" min="0" step="0.01" /></label><label class="oauth-groups">绑定分组<select v-model="form.oauth_group_ids" multiple><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.platform }}</option></select></label></div><label>备注<input v-model="form.oauth_notes" /></label><label>{{ form.oauth_method === OAuthBatchMethod.EMAIL_PASSWORD ? '邮箱与密码（每行 email----password）' : 'Refresh Token（每行一条）' }}<textarea v-model="form.oauth_values" rows="8" autocomplete="off" spellcheck="false" /></label><details><summary>高级账号配置</summary><div class="resource-form-grid"><label>凭据附加配置 JSON<textarea v-model="form.oauth_credentials_json" rows="7" class="resource-code" /></label><label>账号扩展配置 JSON<textarea v-model="form.oauth_extra_json" rows="7" class="resource-code" /></label></div><p class="muted">可在凭据附加配置中保留模型映射、请求头覆盖等非敏感策略；平台换取的 Token 字段会覆盖同名值。</p></details><button class="resource-button" :disabled="running" @click="batchOAuthCreate">{{ running ? '逐条授权中…' : '验证并批量创建' }}</button></section>
  <section v-else-if="tab === ToolsTab.PREVIEW" class="resource-form-stack"><div class="resource-form-grid"><label>平台<input v-model="form.preview_platform" /></label><label>类型<input v-model="form.preview_type" /></label><label>Base URL<input v-model="form.preview_base_url" /></label><label>API Key<input v-model="form.preview_api_key" type="password" /></label></div><div class="resource-inline-actions"><button class="resource-button" :disabled="running" @click="previewModels">预览上游模型</button><button class="resource-button resource-button--secondary" :disabled="running" @click="loadAntigravityMapping">读取 Antigravity 默认映射</button></div><p class="muted">默认映射以可直接写入账号 <code>credentials.model_mapping</code> 的 JSON 片段返回。</p></section>
  <section v-else class="resource-form-stack"><label>账号请求数组（JSON）<textarea v-model="form.batch_json" rows="14" class="resource-code" /></label><button class="resource-button" :disabled="running" @click="batchCreate">批量创建账号</button></section>
  <pre v-if="resultText" class="resource-code">{{ resultText }}</pre></div></SurfaceDialog></template>
<style scoped>.crs-list { max-height: 260px; overflow: auto; display: grid; gap: 6px; }.crs-list label { padding: 9px; display: flex; gap: 8px; background: var(--surface-canvas); border-radius: 8px; }.crs-list span { display: grid; gap: 3px; }.crs-list small { color: var(--text-secondary); }.oauth-groups { grid-row: span 2; }.oauth-groups select { min-height: 92px; } details { padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: 10px; } summary { cursor: pointer; font-weight: 750; } details[open] summary { margin-bottom: 10px; }</style>
