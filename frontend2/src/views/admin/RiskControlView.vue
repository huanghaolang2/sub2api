<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import * as riskAPI from '@shared-api/admin/riskControl'
import * as groupsAPI from '@shared-api/admin/groups'
import * as proxiesAPI from '@shared-api/admin/proxies'
import type { ContentModerationAPIKeyStatus, ContentModerationConfig, ContentModerationLog, ContentModerationRuntimeStatus, ContentModerationTestAuditResult, UpdateContentModerationConfig } from '@shared-api/admin/riskControl'
import type { AdminGroup, Proxy } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { APIKeysWriteMode, KeywordBlockingMode, ModelFilterType, ModerationMode, cloneData, formatCompactNumber, formatDuration, formatGovernanceDate, splitLines } from '@/features/admin/governance/model'

const app = useAppStore()
const confirm = useConfirmStore()
const loading = ref(true)
const statusLoading = ref(false)
const logsLoading = ref(false)
const error = ref('')
const config = ref<ContentModerationConfig | null>(null)
const status = ref<ContentModerationRuntimeStatus | null>(null)
const groups = ref<AdminGroup[]>([])
const proxies = ref<Proxy[]>([])
const logs = ref<ContentModerationLog[]>([])
const logTotal = ref(0)
const logPage = ref(1)
const logPageSize = ref(20)
const filters = reactive({ result: '', groupId: '', endpoint: '', search: '', from: '', to: '' })
const settingsOpen = ref(false)
const saving = ref(false)
const draft = ref<ContentModerationConfig | null>(null)
const apiKeysText = ref('')
const apiKeysMode = ref(APIKeysWriteMode.APPEND)
const deleteKeyHashes = ref<string[]>([])
const clearAllKeys = ref(false)
const blockedKeywordsText = ref('')
const modelFilterText = ref('')
const testedKeys = ref<ContentModerationAPIKeyStatus[]>([])
const testing = ref(false)
const testPrompt = ref('')
const testImages = ref<string[]>([])
const testResult = ref<ContentModerationTestAuditResult | null>(null)
const detailOpen = ref(false)
const detail = ref<ContentModerationLog | null>(null)
const hashInput = ref('')
const hashWorking = ref(false)

const logPages = computed(() => Math.max(1, Math.ceil(logTotal.value / logPageSize.value)))
const queuePercent = computed(() => Math.min(100, Math.max(0, Number(status.value?.queue_usage_percent || 0))))
const allKeyRows = computed(() => testedKeys.value.length ? testedKeys.value : (draft.value?.api_key_statuses || []))

function logParams() {
  return { page: logPage.value, page_size: logPageSize.value, result: filters.result || undefined, group_id: filters.groupId ? Number(filters.groupId) : undefined, endpoint: filters.endpoint || undefined, search: filters.search || undefined, from: filters.from ? new Date(filters.from).toISOString() : undefined, to: filters.to ? new Date(filters.to).toISOString() : undefined }
}

async function loadAll(): Promise<void> {
  loading.value = true; error.value = ''
  const results = await Promise.allSettled([riskAPI.getConfig(), riskAPI.getStatus(), riskAPI.listLogs(logParams()), groupsAPI.getAll(), proxiesAPI.getAll()])
  if (results[0].status === 'fulfilled') config.value = results[0].value
  else error.value = (results[0].reason as { message?: string }).message || '风控配置加载失败'
  if (results[1].status === 'fulfilled') status.value = results[1].value
  if (results[2].status === 'fulfilled') { logs.value = results[2].value.items || []; logTotal.value = results[2].value.total || 0 }
  if (results[3].status === 'fulfilled') groups.value = results[3].value
  if (results[4].status === 'fulfilled') proxies.value = results[4].value
  loading.value = false
}

async function loadStatus(): Promise<void> { statusLoading.value = true; try { status.value = await riskAPI.getStatus() } catch (caught) { app.showError((caught as { message?: string }).message || '运行状态加载失败') } finally { statusLoading.value = false } }
async function loadLogs(): Promise<void> { logsLoading.value = true; try { const response = await riskAPI.listLogs(logParams()); logs.value = response.items || []; logTotal.value = response.total || 0 } catch (caught) { app.showError((caught as { message?: string }).message || '风控日志加载失败') } finally { logsLoading.value = false } }

function openSettings(): void {
  if (!config.value) return
  draft.value = cloneData(config.value); apiKeysText.value = ''; apiKeysMode.value = APIKeysWriteMode.APPEND; deleteKeyHashes.value = []; clearAllKeys.value = false
  blockedKeywordsText.value = config.value.blocked_keywords.join('\n'); modelFilterText.value = config.value.model_filter.models.join('\n'); testedKeys.value = []; testPrompt.value = ''; testImages.value = []; testResult.value = null
  settingsOpen.value = true
}

function toggleGroup(id: number): void { if (!draft.value) return; const index = draft.value.group_ids.indexOf(id); if (index >= 0) draft.value.group_ids.splice(index, 1); else draft.value.group_ids.push(id) }
function toggleDeleteKey(hash: string): void { const index = deleteKeyHashes.value.indexOf(hash); if (index >= 0) deleteKeyHashes.value.splice(index, 1); else deleteKeyHashes.value.push(hash) }

function buildPayload(): UpdateContentModerationConfig {
  if (!draft.value) return {}
  const value = draft.value
  const keys = splitLines(apiKeysText.value)
  return {
    enabled: value.enabled, mode: value.mode, base_url: value.base_url.trim(), model: value.model.trim(), proxy_id: value.proxy_id === null ? 0 : value.proxy_id,
    api_keys: keys.length ? keys : undefined, api_keys_mode: keys.length ? apiKeysMode.value : undefined, delete_api_key_hashes: deleteKeyHashes.value.length ? deleteKeyHashes.value : undefined, clear_api_key: clearAllKeys.value || undefined,
    timeout_ms: Number(value.timeout_ms), sample_rate: Number(value.sample_rate), all_groups: value.all_groups, group_ids: value.all_groups ? [] : [...value.group_ids], record_non_hits: value.record_non_hits,
    thresholds: cloneData(value.thresholds), worker_count: Number(value.worker_count), queue_size: Number(value.queue_size), block_status: Number(value.block_status), block_message: value.block_message,
    email_on_hit: value.email_on_hit, auto_ban_enabled: value.auto_ban_enabled, ban_threshold: Number(value.ban_threshold), violation_window_hours: Number(value.violation_window_hours), retry_count: Number(value.retry_count),
    hit_retention_days: Number(value.hit_retention_days), non_hit_retention_days: Number(value.non_hit_retention_days), pre_hash_check_enabled: value.pre_hash_check_enabled,
    blocked_keywords: splitLines(blockedKeywordsText.value), keyword_blocking_mode: value.keyword_blocking_mode, model_filter: { type: value.model_filter.type, models: splitLines(modelFilterText.value) }, cyber_policy_exclude_from_ban_count: value.cyber_policy_exclude_from_ban_count,
  }
}

async function saveConfig(): Promise<void> {
  if (!draft.value) return
  if (!draft.value.base_url.trim() || !draft.value.model.trim()) { app.showError('审核 API 地址和模型不能为空'); return }
  saving.value = true
  try { config.value = await riskAPI.updateConfig(buildPayload()); settingsOpen.value = false; app.showSuccess('内容风控配置已保存'); await loadStatus() }
  catch (caught) { app.showError((caught as { message?: string }).message || '风控配置保存失败') }
  finally { saving.value = false }
}

async function testAPIKeys(useDraftKeys: boolean): Promise<void> {
  if (!draft.value) return
  testing.value = true; testResult.value = null
  try { const response = await riskAPI.testAPIKeys({ api_keys: useDraftKeys ? splitLines(apiKeysText.value) : undefined, base_url: draft.value.base_url, model: draft.value.model, timeout_ms: draft.value.timeout_ms, proxy_id: draft.value.proxy_id === null ? 0 : draft.value.proxy_id, prompt: testPrompt.value || undefined, images: testImages.value.length ? testImages.value : undefined }); testedKeys.value = response.items || []; testResult.value = response.audit_result || null; app.showSuccess('API Key 与审核请求测试完成') }
  catch (caught) { app.showError((caught as { message?: string }).message || 'API Key 测试失败') }
  finally { testing.value = false }
}

async function addTestImages(event: Event): Promise<void> {
  const files = Array.from((event.target as HTMLInputElement).files || []).slice(0, Math.max(0, 4 - testImages.value.length))
  for (const file of files) testImages.value.push(await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) }))
}

async function unban(item: ContentModerationLog): Promise<void> { if (!item.user_id || !await confirm.ask({ title: '解除用户封禁', message: `确认解除 ${item.user_email || `用户 #${item.user_id}`} 的内容风控封禁？`, confirmText: '解除封禁', tone: ConfirmTone.DEFAULT })) return; try { await riskAPI.unbanUser(item.user_id); app.showSuccess('用户已解封'); await loadLogs() } catch (caught) { app.showError((caught as { message?: string }).message || '解封失败') } }
async function deleteHash(): Promise<void> { if (!hashInput.value.trim()) { app.showError('请输入完整输入哈希'); return } hashWorking.value = true; try { const result = await riskAPI.deleteFlaggedHash(hashInput.value.trim()); app.showSuccess(result.deleted ? '风险哈希已删除' : '未找到该哈希'); hashInput.value = ''; await loadStatus() } catch (caught) { app.showError((caught as { message?: string }).message || '哈希删除失败') } finally { hashWorking.value = false } }
async function clearHashes(): Promise<void> { if (!await confirm.ask({ title: '清空全部风险哈希', message: '预检拦截缓存将被清空，后续请求会重新经过审核。', confirmText: '清空哈希', tone: ConfirmTone.DANGER })) return; hashWorking.value = true; try { const result = await riskAPI.clearFlaggedHashes(); app.showSuccess(`已清理 ${result.deleted} 条哈希`); await loadStatus() } catch (caught) { app.showError((caught as { message?: string }).message || '哈希清理失败') } finally { hashWorking.value = false } }
function openDetail(item: ContentModerationLog): void { detail.value = item; detailOpen.value = true }

onMounted(loadAll)
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Content Safety</span><h1>内容风控</h1><p>运行状态、Key 负载、策略、审核测试、命中记录、用户解封与预检哈希维护完整闭环。</p></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" :disabled="statusLoading" @click="loadStatus">刷新运行状态</button><button class="resource-button" @click="openSettings">配置策略</button></div></header>
      <PageState :loading="loading" :error="error" @retry="loadAll"><template v-if="config && status"><section class="governance-kpis"><div><span>运行模式</span><strong>{{ status.mode }}</strong></div><div><span>Worker 活跃</span><strong>{{ status.active_workers }} / {{ status.worker_count }}</strong></div><div><span>队列</span><strong>{{ status.queue_length }} / {{ status.queue_size }}</strong></div><div><span>风险哈希</span><strong>{{ formatCompactNumber(status.flagged_hash_count) }}</strong></div><div><span>已处理 / 错误</span><strong>{{ formatCompactNumber(status.processed) }} / {{ formatCompactNumber(status.errors) }}</strong></div><div><span>预检放行 / 拦截</span><strong>{{ formatCompactNumber(status.pre_block_allowed) }} / {{ formatCompactNumber(status.pre_block_blocked) }}</strong></div><div><span>预检平均耗时</span><strong>{{ formatDuration(status.pre_block_avg_latency_ms) }}</strong></div><div><span>可用 Key</span><strong>{{ status.pre_block_api_key_available_count }} / {{ config.api_key_count }}</strong></div></section><section class="governance-grid"><article class="governance-card"><header class="governance-card__header"><div><h2>Worker 与队列</h2><p>{{ status.enabled ? '运行中' : '已停用' }}</p></div><span :class="['resource-status', status.enabled && status.risk_control_enabled ? 'resource-status--active' : 'resource-status--error']">{{ status.enabled && status.risk_control_enabled ? '已启用' : '未生效' }}</span></header><div class="governance-meter"><i :style="{ width: `${queuePercent}%` }"></i></div><dl class="governance-detail"><dt>空闲 Worker</dt><dd>{{ status.idle_workers }}</dd><dt>入队 / 丢弃</dt><dd>{{ status.enqueued }} / {{ status.dropped }}</dd><dt>预检活跃</dt><dd>{{ status.pre_block_active }}</dd><dt>最近清理</dt><dd>{{ formatGovernanceDate(status.last_cleanup_at) }}</dd></dl></article><article class="governance-card"><header class="governance-card__header"><div><h2>API Key 负载</h2><p>冻结、失败次数、HTTP 状态和当前并发。</p></div></header><div class="governance-list"><article v-for="item in status.pre_block_api_key_loads" :key="item.key_hash"><div><strong>{{ item.masked }}</strong><small>#{{ item.index }} · HTTP {{ item.last_http_status || '—' }} · {{ formatDuration(item.avg_latency_ms) }}</small></div><div><span :class="['resource-status', item.status === 'ok' ? 'resource-status--active' : item.status === 'error' || item.status === 'frozen' ? 'resource-status--error' : '']">{{ item.status }}</span><small>{{ item.active }} / {{ item.total }}</small></div></article></div></article></section></template></PageState>

      <section class="governance-card"><header class="governance-card__header"><div><h2>命中与审核记录</h2><p>可按结果、分组、端点、时间和任意用户/请求关键词筛选。</p></div><button class="resource-button resource-button--secondary" @click="loadLogs">刷新</button></header><div class="resource-form-grid resource-form-grid--4"><label>结果<select v-model="filters.result"><option value="">全部</option><option value="hit">命中</option><option value="pass">通过</option><option value="error">错误</option></select></label><label>分组 ID<input v-model="filters.groupId" /></label><label>端点<input v-model="filters.endpoint" /></label><label>搜索<input v-model="filters.search" @keyup.enter="logPage = 1; loadLogs()" /></label><label>开始时间<input v-model="filters.from" type="datetime-local" /></label><label>结束时间<input v-model="filters.to" type="datetime-local" /></label><button class="resource-button" @click="logPage = 1; loadLogs()">查询</button></div></section>
      <div v-if="logsLoading" class="page-state">正在加载风控记录…</div><div v-else-if="!logs.length" class="resource-empty-inline">当前筛选范围没有风控记录。</div><div v-else class="resource-table"><table><thead><tr><th>时间</th><th>结果</th><th>用户 / Key</th><th>分组 / 端点</th><th>模型</th><th>风险</th><th>延迟</th><th>操作</th></tr></thead><tbody><tr v-for="item in logs" :key="item.id"><td>{{ formatGovernanceDate(item.created_at) }}<small><code>{{ item.request_id }}</code></small></td><td><span :class="['resource-status', item.flagged ? 'resource-status--error' : 'resource-status--active']">{{ item.action }} · {{ item.flagged ? '命中' : '通过' }}</span><small v-if="item.error">{{ item.error }}</small></td><td>{{ item.user_email || `用户 #${item.user_id}` }}<small>{{ item.api_key_name || `Key #${item.api_key_id}` }} · 违规 {{ item.violation_count }}</small></td><td>{{ item.group_name || `#${item.group_id}` }}<small>{{ item.endpoint }}</small></td><td>{{ item.model }}<small>{{ item.provider }} · {{ item.mode }}</small></td><td>{{ item.highest_category || item.matched_keyword || '—' }}<small>分数 {{ item.highest_score }} · {{ item.auto_banned ? '已自动封禁' : '未封禁' }}</small></td><td>{{ formatDuration(item.upstream_latency_ms) }}<small>排队 {{ formatDuration(item.queue_delay_ms) }}</small></td><td><div class="resource-inline-actions"><button class="resource-link" @click="openDetail(item)">输入详情</button><button v-if="item.user_id && item.user_status !== 'active'" class="resource-link" @click="unban(item)">解封用户</button></div></td></tr></tbody></table></div><footer class="resource-pagination"><span>共 {{ logTotal }} 条 · 第 {{ logPage }} / {{ logPages }} 页</span><div class="resource-pagination__actions"><select v-model.number="logPageSize" @change="logPage = 1; loadLogs()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="logPage <= 1" @click="logPage--; loadLogs()">上一页</button><button class="resource-button resource-button--secondary" :disabled="logPage >= logPages" @click="logPage++; loadLogs()">下一页</button></div></footer>

      <section class="governance-danger-zone"><h3>风险哈希维护</h3><p class="governance-field-note">删除单条哈希用于误判恢复；清空全部会使已标记输入重新进入审核链路。</p><div class="resource-toolbar"><div class="resource-toolbar__filters"><input v-model="hashInput" placeholder="完整 input_hash" /></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" :disabled="hashWorking" @click="deleteHash">删除单条</button><button class="resource-button resource-button--danger" :disabled="hashWorking" @click="clearHashes">清空全部</button></div></div></section>
    </main>

    <SurfaceDialog :show="settingsOpen" title="内容风控配置" description="所有现有字段均可编辑；API Key 留空不会覆盖已保存密钥。" :width="DialogWidth.WIDE" @close="settingsOpen = false"><form v-if="draft" id="risk-settings-form" class="resource-form-stack" @submit.prevent="saveConfig"><fieldset class="resource-form-section"><legend>基础与范围</legend><div class="resource-form-grid resource-form-grid--4"><label class="resource-check"><input v-model="draft.enabled" type="checkbox" />启用内容审核</label><label>模式<select v-model="draft.mode"><option :value="ModerationMode.OFF">关闭</option><option :value="ModerationMode.OBSERVE">观察</option><option :value="ModerationMode.PRE_BLOCK">请求前拦截</option></select></label><label>API 地址<input v-model="draft.base_url" type="url" /></label><label>模型<input v-model="draft.model" /></label><label>代理<select v-model="draft.proxy_id"><option :value="null">直连</option><option v-for="proxy in proxies" :key="proxy.id" :value="proxy.id">{{ proxy.name }}</option></select></label><label>超时 ms<input v-model.number="draft.timeout_ms" type="number" min="500" max="30000" /></label><label>重试次数<input v-model.number="draft.retry_count" type="number" min="0" max="5" /></label><label>采样率 %<input v-model.number="draft.sample_rate" type="number" min="0" max="100" /></label><label class="resource-check"><input v-model="draft.all_groups" type="checkbox" />所有分组</label></div><div v-if="!draft.all_groups" class="governance-chip-list"><button v-for="group in groups" :key="group.id" type="button" :class="['governance-chip', draft.group_ids.includes(group.id) && 'governance-chip--active']" @click="toggleGroup(group.id)">{{ group.name }}</button></div></fieldset>
        <fieldset class="resource-form-section"><legend>API Key 池与测试</legend><p class="governance-field-note">已配置 {{ draft.api_key_count }} 个 Key；追加保留原池，替换会以本次输入重建。</p><div class="governance-chip-list"><button type="button" :class="['governance-chip', apiKeysMode === APIKeysWriteMode.APPEND && 'governance-chip--active']" @click="apiKeysMode = APIKeysWriteMode.APPEND">追加</button><button type="button" :class="['governance-chip', apiKeysMode === APIKeysWriteMode.REPLACE && 'governance-chip--active']" @click="apiKeysMode = APIKeysWriteMode.REPLACE">替换</button></div><label>新 API Keys（每行一个）<textarea v-model="apiKeysText" rows="4" autocomplete="off" /></label><label class="resource-check"><input v-model="clearAllKeys" type="checkbox" />清除全部已保存 Key</label><div class="governance-list"><article v-for="row in allKeyRows" :key="row.key_hash"><div><strong>{{ row.masked }}</strong><small>{{ row.status }} · 成功 {{ row.success_count }} / 失败 {{ row.failure_count }} · HTTP {{ row.last_http_status || '—' }}</small></div><label class="resource-check"><input type="checkbox" :checked="deleteKeyHashes.includes(row.key_hash)" @change="toggleDeleteKey(row.key_hash)" />保存时删除</label></article></div><label>测试 Prompt<textarea v-model="testPrompt" rows="3" /></label><label>测试图片（最多 4 张）<input type="file" accept="image/*" multiple @change="addTestImages" /></label><div class="governance-chip-list"><span v-for="(_image, index) in testImages" :key="index" class="governance-chip">图片 {{ index + 1 }} <button type="button" class="resource-link resource-link--danger" @click="testImages.splice(index, 1)">移除</button></span></div><div class="resource-inline-actions"><button type="button" class="resource-button resource-button--secondary" :disabled="testing" @click="testAPIKeys(false)">测试已保存 Key</button><button type="button" class="resource-button" :disabled="testing || !splitLines(apiKeysText).length" @click="testAPIKeys(true)">测试输入 Key</button></div><pre v-if="testResult" class="resource-code">{{ JSON.stringify(testResult, null, 2) }}</pre></fieldset>
        <fieldset class="resource-form-section"><legend>处理能力与拦截</legend><div class="resource-form-grid resource-form-grid--4"><label>Worker 数<input v-model.number="draft.worker_count" type="number" min="1" max="32" /></label><label>队列容量<input v-model.number="draft.queue_size" type="number" min="100" /></label><label>拦截状态码<input v-model.number="draft.block_status" type="number" min="400" max="599" /></label><label>拦截提示<input v-model="draft.block_message" /></label><label class="resource-check"><input v-model="draft.record_non_hits" type="checkbox" />记录未命中</label><label class="resource-check"><input v-model="draft.pre_hash_check_enabled" type="checkbox" />预检哈希</label><label class="resource-check"><input v-model="draft.email_on_hit" type="checkbox" />命中邮件</label><label class="resource-check"><input v-model="draft.auto_ban_enabled" type="checkbox" />自动封禁</label><label>封禁阈值<input v-model.number="draft.ban_threshold" type="number" min="1" /></label><label>违规窗口小时<input v-model.number="draft.violation_window_hours" type="number" min="1" /></label><label>命中保留天<input v-model.number="draft.hit_retention_days" type="number" min="1" /></label><label>未命中保留天<input v-model.number="draft.non_hit_retention_days" type="number" min="1" /></label><label class="resource-check"><input v-model="draft.cyber_policy_exclude_from_ban_count" type="checkbox" />Cyber 策略不计入封禁</label></div></fieldset>
        <fieldset class="resource-form-section"><legend>模型、关键词与风险阈值</legend><div class="resource-form-grid"><label>模型过滤<select v-model="draft.model_filter.type"><option :value="ModelFilterType.ALL">全部模型</option><option :value="ModelFilterType.INCLUDE">仅包含</option><option :value="ModelFilterType.EXCLUDE">排除</option></select></label><label>关键词拦截模式<select v-model="draft.keyword_blocking_mode"><option :value="KeywordBlockingMode.KEYWORD_ONLY">仅关键词</option><option :value="KeywordBlockingMode.KEYWORD_AND_API">关键词 + API</option><option :value="KeywordBlockingMode.API_ONLY">仅 API</option></select></label><label>模型列表<textarea v-model="modelFilterText" rows="5" /></label><label>拦截关键词<textarea v-model="blockedKeywordsText" rows="5" /></label></div><div class="resource-form-grid resource-form-grid--4"><label v-for="(_value, key) in draft.thresholds" :key="key">{{ key }}<input v-model.number="draft.thresholds[key]" type="number" min="0" max="1" step="0.01" /></label></div></fieldset>
      </form><template #footer><button class="button button--secondary" @click="settingsOpen = false">取消</button><button type="submit" form="risk-settings-form" class="button button--primary" :disabled="saving">{{ saving ? '保存中…' : '保存风控配置' }}</button></template></SurfaceDialog>
    <SurfaceDialog :show="detailOpen" title="审核输入详情" description="仅展示后端允许返回的脱敏摘录、分数与阈值快照。" :width="DialogWidth.WIDE" @close="detailOpen = false"><template v-if="detail"><dl class="governance-detail"><dt>请求</dt><dd><code>{{ detail.request_id }}</code></dd><dt>用户 / Key</dt><dd>{{ detail.user_email }} / {{ detail.api_key_name }}</dd><dt>模型 / 端点</dt><dd>{{ detail.model }} / {{ detail.endpoint }}</dd><dt>结果</dt><dd>{{ detail.action }} · {{ detail.highest_category }} · {{ detail.highest_score }}</dd><dt>关键词</dt><dd>{{ detail.matched_keyword || '—' }}</dd><dt>输入摘录</dt><dd>{{ detail.input_excerpt || '—' }}</dd><dt>邮件 / 封禁</dt><dd>{{ detail.email_sent ? '已通知' : '未通知' }} / {{ detail.auto_banned ? '已封禁' : '未封禁' }}</dd></dl><h3>分类分数</h3><pre class="resource-code">{{ JSON.stringify(detail.category_scores, null, 2) }}</pre><h3>阈值快照</h3><pre class="resource-code">{{ JSON.stringify(detail.threshold_snapshot, null, 2) }}</pre></template></SurfaceDialog>
  </ConsoleShell>
</template>
