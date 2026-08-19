<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import * as usageAPI from '@shared-api/admin/usage'
import * as dashboardAPI from '@shared-api/admin/dashboard'
import * as opsAPI from '@shared-api/admin/ops'
import type { AdminUsageStatsResponse, SimpleApiKey, SimpleUser, UsageCleanupTask } from '@shared-api/admin/usage'
import type { OpsErrorDetail, OpsErrorLog } from '@shared-api/admin/ops'
import type { AdminUsageLog, UserBreakdownItem } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { AdminUsageTab, GovernanceSortOrder, UsageRequestType, downloadCSV, formatCompactNumber, formatDuration, formatGovernanceDate, formatMoney } from '@/features/admin/governance/model'

const route = useRoute()
const app = useAppStore()
const confirm = useConfirmStore()
const activeTab = ref(AdminUsageTab.USAGE)
const rows = ref<AdminUsageLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const stats = ref<AdminUsageStatsResponse | null>(null)
const rankings = ref<UserBreakdownItem[]>([])
const errors = ref<OpsErrorLog[]>([])
const errorTotal = ref(0)
const errorPage = ref(1)
const errorPageSize = ref(20)
const cleanupTasks = ref<UsageCleanupTask[]>([])
const cleanupTotal = ref(0)
const loading = ref(true)
const secondaryLoading = ref(false)
const error = ref('')
const exporting = ref(false)
const detailOpen = ref(false)
const detail = ref<AdminUsageLog | null>(null)
const errorDetailOpen = ref(false)
const errorDetail = ref<OpsErrorDetail | null>(null)
const cleanupOpen = ref(false)
const cleanupSaving = ref(false)
const userSuggestions = ref<SimpleUser[]>([])
const keySuggestions = ref<SimpleApiKey[]>([])
const filters = reactive({
  userId: '', apiKeyId: '', accountId: '', groupId: '', model: '', requestType: '', billingType: '', billingMode: '',
  mismatch: '', startDate: '', endDate: '', sortBy: 'created_at', sortOrder: GovernanceSortOrder.DESC,
  errorPhase: '', errorCategory: '', statusCode: '',
})
const cleanupForm = reactive({ startDate: '', endDate: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
let controller: AbortController | null = null
let lookupTimer: number | null = null

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const errorPages = computed(() => Math.max(1, Math.ceil(errorTotal.value / errorPageSize.value)))

function setDefaultRange(): void {
  const end = new Date(); const start = new Date(end.getTime() - 86400000)
  filters.startDate = String(route.query.start_date || start.toISOString().slice(0, 10))
  filters.endDate = String(route.query.end_date || end.toISOString().slice(0, 10))
  filters.userId = String(route.query.user_id || '')
  cleanupForm.startDate = filters.startDate; cleanupForm.endDate = filters.endDate
}

function numberValue(value: string): number | undefined { const number = Number(value); return value && Number.isFinite(number) ? number : undefined }
function listParams(pageValue = page.value, size = pageSize.value, exactTotal = false) {
  return {
    page: pageValue, page_size: size, exact_total: exactTotal,
    user_id: numberValue(filters.userId), api_key_id: numberValue(filters.apiKeyId), account_id: numberValue(filters.accountId), group_id: numberValue(filters.groupId),
    model: filters.model.trim() || undefined, request_type: (filters.requestType || undefined) as UsageRequestType | undefined,
    billing_type: numberValue(filters.billingType), billing_mode: filters.billingMode || undefined,
    upstream_model_mismatch: filters.mismatch === '' ? undefined : filters.mismatch === 'true',
    start_date: filters.startDate || undefined, end_date: filters.endDate || undefined,
    sort_by: filters.sortBy, sort_order: filters.sortOrder,
  }
}

function statsParams() {
  const params = listParams(1, 1)
  return { user_id: params.user_id, api_key_id: params.api_key_id, account_id: params.account_id, group_id: params.group_id, model: params.model, request_type: params.request_type, upstream_model_mismatch: params.upstream_model_mismatch, start_date: params.start_date, end_date: params.end_date, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

async function loadUsage(): Promise<void> {
  controller?.abort(); controller = new AbortController(); const current = controller
  loading.value = true; error.value = ''
  try {
    const [listResult, statsResult] = await Promise.all([usageAPI.list(listParams(), { signal: current.signal }), usageAPI.getStats(statsParams())])
    rows.value = listResult.items || []; total.value = listResult.total || 0; stats.value = statsResult
  } catch (caught) { if ((caught as { code?: string }).code !== 'ERR_CANCELED') error.value = (caught as { message?: string }).message || '用量记录加载失败' }
  finally { if (controller === current) loading.value = false }
}

async function loadErrors(): Promise<void> {
  secondaryLoading.value = true
  try {
    const response = await opsAPI.listErrorLogs({ page: errorPage.value, page_size: errorPageSize.value, view: 'all', start_time: filters.startDate ? new Date(`${filters.startDate}T00:00:00`).toISOString() : undefined, end_time: filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`).toISOString() : undefined, user_id: numberValue(filters.userId), api_key_id: numberValue(filters.apiKeyId), account_id: numberValue(filters.accountId), group_id: numberValue(filters.groupId), model: filters.model || undefined, phase: filters.errorPhase || undefined, category: filters.errorCategory || undefined, status_codes: filters.statusCode || undefined, sort_by: filters.sortBy, sort_order: filters.sortOrder })
    errors.value = response.items || []; errorTotal.value = response.total || 0
  } catch (caught) { app.showError((caught as { message?: string }).message || '错误请求加载失败') }
  finally { secondaryLoading.value = false }
}

async function loadRanking(): Promise<void> {
  secondaryLoading.value = true
  try { const response = await dashboardAPI.getUserBreakdown({ start_date: filters.startDate, end_date: filters.endDate, group_id: numberValue(filters.groupId), model: filters.model || undefined, limit: 50, sort_by: 'actual_cost', api_key_id: numberValue(filters.apiKeyId), account_id: numberValue(filters.accountId), request_type: (filters.requestType || undefined) as UsageRequestType | undefined, billing_type: numberValue(filters.billingType) }); rankings.value = response.users || [] }
  catch (caught) { app.showError((caught as { message?: string }).message || '用户排行加载失败') }
  finally { secondaryLoading.value = false }
}

async function loadCleanupTasks(): Promise<void> {
  secondaryLoading.value = true
  try { const response = await usageAPI.listCleanupTasks({ page: 1, page_size: 50 }); cleanupTasks.value = response.items || []; cleanupTotal.value = response.total || 0 }
  catch (caught) { app.showError((caught as { message?: string }).message || '清理任务加载失败') }
  finally { secondaryLoading.value = false }
}

function switchTab(tab: AdminUsageTab): void {
  activeTab.value = tab
  if (tab === AdminUsageTab.ERRORS) void loadErrors()
  if (tab === AdminUsageTab.RANKING) void loadRanking()
  if (tab === AdminUsageTab.CLEANUP) void loadCleanupTasks()
}

function applyFilters(): void {
  page.value = 1; errorPage.value = 1
  void loadUsage()
  if (activeTab.value === AdminUsageTab.ERRORS) void loadErrors()
  if (activeTab.value === AdminUsageTab.RANKING) void loadRanking()
}

function resetFilters(): void {
  Object.assign(filters, { userId: '', apiKeyId: '', accountId: '', groupId: '', model: '', requestType: '', billingType: '', billingMode: '', mismatch: '', sortBy: 'created_at', sortOrder: GovernanceSortOrder.DESC, errorPhase: '', errorCategory: '', statusCode: '' })
  setDefaultRange(); applyFilters()
}

function searchUsersLater(keyword: string): void {
  if (lookupTimer) window.clearTimeout(lookupTimer)
  lookupTimer = window.setTimeout(async () => { try { userSuggestions.value = await usageAPI.searchUsers(keyword) } catch { userSuggestions.value = [] } }, 220)
}
async function searchKeys(): Promise<void> { try { keySuggestions.value = await usageAPI.searchApiKeys(numberValue(filters.userId)) } catch { keySuggestions.value = [] } }

function openDetail(item: AdminUsageLog): void { detail.value = item; detailOpen.value = true }
async function openErrorDetail(id: number): Promise<void> { errorDetailOpen.value = true; errorDetail.value = null; try { errorDetail.value = await opsAPI.getErrorLogDetail(id) } catch (caught) { app.showError((caught as { message?: string }).message || '错误详情加载失败'); errorDetailOpen.value = false } }
async function toggleResolved(item: OpsErrorLog): Promise<void> { try { await opsAPI.updateErrorResolved(item.id, !item.resolved); app.showSuccess(item.resolved ? '已重新打开错误' : '已标记为已解决'); await loadErrors() } catch (caught) { app.showError((caught as { message?: string }).message || '状态更新失败') } }

async function exportUsage(): Promise<void> {
  exporting.value = true
  try {
    const items: AdminUsageLog[] = []; let next = 1; let expected = total.value
    do { const response = await usageAPI.list(listParams(next, 100, true)); items.push(...(response.items || [])); expected = response.total || expected; next += 1; if (!response.items?.length) break } while (items.length < expected)
    downloadCSV(`admin-usage-${new Date().toISOString().slice(0, 10)}.csv`, ['时间', '请求ID', '用户ID', 'Key ID', '账号ID', '分组ID', '模型', '上游模型', '请求类型', '输入Token', '输出Token', '缓存Token', '总Token', '标准成本', '实际扣费', '账号成本', '耗时ms', 'IP'], items.map((item) => [item.created_at, item.request_id, item.user_id, item.api_key_id, item.account_id, item.group_id, item.model, item.upstream_model, item.request_type, item.input_tokens, item.output_tokens, item.cache_creation_tokens + item.cache_read_tokens, item.input_tokens + item.output_tokens + item.cache_creation_tokens + item.cache_read_tokens, item.total_cost, item.actual_cost, item.account_stats_cost, item.duration_ms, item.ip_address]))
    app.showSuccess(`已导出 ${items.length} 条用量记录`)
  } catch (caught) { app.showError((caught as { message?: string }).message || '用量导出失败') }
  finally { exporting.value = false }
}

function openCleanup(): void { cleanupForm.startDate = filters.startDate; cleanupForm.endDate = filters.endDate; cleanupOpen.value = true }
async function createCleanup(): Promise<void> {
  if (!cleanupForm.startDate || !cleanupForm.endDate) { app.showError('必须填写清理起止日期'); return }
  if (!await confirm.ask({ title: '创建用量清理任务', message: `将异步删除 ${cleanupForm.startDate} 至 ${cleanupForm.endDate} 且符合当前筛选条件的用量记录。`, confirmText: '创建任务', tone: ConfirmTone.DANGER })) return
  cleanupSaving.value = true
  try { await usageAPI.createCleanupTask({ start_date: cleanupForm.startDate, end_date: cleanupForm.endDate, user_id: numberValue(filters.userId), api_key_id: numberValue(filters.apiKeyId), account_id: numberValue(filters.accountId), group_id: numberValue(filters.groupId), model: filters.model || undefined, request_type: (filters.requestType || undefined) as UsageRequestType | undefined, billing_type: numberValue(filters.billingType), timezone: cleanupForm.timezone }); cleanupOpen.value = false; app.showSuccess('清理任务已创建'); await loadCleanupTasks(); switchTab(AdminUsageTab.CLEANUP) }
  catch (caught) { app.showError((caught as { message?: string }).message || '创建清理任务失败') }
  finally { cleanupSaving.value = false }
}
async function cancelCleanup(item: UsageCleanupTask): Promise<void> { if (!await confirm.ask({ title: '取消清理任务', message: `确认取消任务 #${item.id}？已删除的数据不会恢复。`, confirmText: '取消任务', tone: ConfirmTone.DANGER })) return; try { await usageAPI.cancelCleanupTask(item.id); app.showSuccess('任务已取消'); await loadCleanupTasks() } catch (caught) { app.showError((caught as { message?: string }).message || '任务取消失败') } }

onMounted(() => { setDefaultRange(); void loadUsage(); if (filters.userId) void searchUsersLater(filters.userId) })
onBeforeUnmount(() => { controller?.abort(); if (lookupTimer) window.clearTimeout(lookupTimer) })
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Usage Intelligence</span><h1>用量审计</h1><p>请求明细、错误详情、用户成本排行、筛选导出和异步清理任务共享同一组服务端条件。</p></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" :disabled="exporting" @click="exportUsage">{{ exporting ? '导出中…' : '导出筛选结果' }}</button><button class="resource-button resource-button--danger" @click="openCleanup">创建清理任务</button></div></header>
      <section v-if="stats" class="governance-kpis"><div><span>请求数</span><strong>{{ formatCompactNumber(stats.total_requests) }}</strong></div><div><span>总 Tokens</span><strong>{{ formatCompactNumber(stats.total_tokens) }}</strong></div><div><span>实际扣费</span><strong>{{ formatMoney(stats.total_actual_cost) }}</strong></div><div><span>账号成本</span><strong>{{ formatMoney(stats.total_account_cost) }}</strong></div><div><span>输入 / 输出</span><strong>{{ formatCompactNumber(stats.total_input_tokens) }} / {{ formatCompactNumber(stats.total_output_tokens) }}</strong></div><div><span>缓存 Tokens</span><strong>{{ formatCompactNumber(stats.total_cache_tokens) }}</strong></div><div><span>标准成本</span><strong>{{ formatMoney(stats.total_cost) }}</strong></div><div><span>平均耗时</span><strong>{{ formatDuration(stats.average_duration_ms) }}</strong></div></section>

      <section class="governance-card"><header class="governance-card__header"><div><h2>服务端筛选</h2><p>用户与 Key 可先搜索建议，也可直接输入 ID；筛选会同步应用到错误和排行。</p></div><div class="resource-inline-actions"><button class="resource-button resource-button--secondary" @click="resetFilters">重置</button><button class="resource-button" @click="applyFilters">查询</button></div></header><div class="resource-form-grid resource-form-grid--4"><label>用户 ID<input v-model="filters.userId" list="admin-usage-users" inputmode="numeric" @input="searchUsersLater(filters.userId)" /><datalist id="admin-usage-users"><option v-for="user in userSuggestions" :key="user.id" :value="user.id">{{ user.email }}</option></datalist></label><label>API Key ID<input v-model="filters.apiKeyId" list="admin-usage-keys" inputmode="numeric" @focus="searchKeys" /><datalist id="admin-usage-keys"><option v-for="key in keySuggestions" :key="key.id" :value="key.id">{{ key.name }} · 用户 #{{ key.user_id }}</option></datalist></label><label>账号 ID<input v-model="filters.accountId" inputmode="numeric" /></label><label>分组 ID<input v-model="filters.groupId" inputmode="numeric" /></label><label>模型<input v-model="filters.model" /></label><label>请求类型<select v-model="filters.requestType"><option value="">全部</option><option :value="UsageRequestType.SYNC">同步</option><option :value="UsageRequestType.STREAM">流式</option><option :value="UsageRequestType.WS_V2">WebSocket</option><option :value="UsageRequestType.CYBER">Cyber</option><option :value="UsageRequestType.LIVE">Live</option></select></label><label>计费类型<input v-model="filters.billingType" inputmode="numeric" placeholder="计费类型编码" /></label><label>计费模式<input v-model="filters.billingMode" placeholder="token / request" /></label><label>上游模型不一致<select v-model="filters.mismatch"><option value="">全部</option><option value="true">仅不一致</option><option value="false">仅一致</option></select></label><label>开始日期<input v-model="filters.startDate" type="date" /></label><label>结束日期<input v-model="filters.endDate" type="date" /></label><label>排序<select v-model="filters.sortBy"><option value="created_at">时间</option><option value="model">模型</option><option value="actual_cost">实际扣费</option><option value="duration_ms">耗时</option></select></label><label>排序方向<select v-model="filters.sortOrder"><option :value="GovernanceSortOrder.DESC">降序</option><option :value="GovernanceSortOrder.ASC">升序</option></select></label><template v-if="activeTab === AdminUsageTab.ERRORS"><label>错误阶段<input v-model="filters.errorPhase" /></label><label>错误分类<input v-model="filters.errorCategory" /></label><label>状态码<input v-model="filters.statusCode" /></label></template></div></section>

      <nav class="resource-tabs" aria-label="用量审计视图"><button :aria-selected="activeTab === AdminUsageTab.USAGE" @click="switchTab(AdminUsageTab.USAGE)">请求明细</button><button :aria-selected="activeTab === AdminUsageTab.ERRORS" @click="switchTab(AdminUsageTab.ERRORS)">错误请求</button><button :aria-selected="activeTab === AdminUsageTab.RANKING" @click="switchTab(AdminUsageTab.RANKING)">用户排行</button><button :aria-selected="activeTab === AdminUsageTab.CLEANUP" @click="switchTab(AdminUsageTab.CLEANUP)">清理任务</button></nav>

      <template v-if="activeTab === AdminUsageTab.USAGE"><PageState :loading="loading" :error="error" :empty="!loading && !error && !rows.length" empty-text="当前筛选范围没有用量记录。" @retry="loadUsage"><div class="resource-table"><table><thead><tr><th>时间 / 请求</th><th>用户 / Key</th><th>账号 / 分组</th><th>模型</th><th>类型</th><th>Tokens</th><th>费用</th><th>耗时</th><th>操作</th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td>{{ formatGovernanceDate(item.created_at) }}<small><code>{{ item.request_id }}</code></small></td><td>{{ item.user?.email || `用户 #${item.user_id}` }}<small>{{ item.api_key?.name || `Key #${item.api_key_id}` }}</small></td><td>{{ item.account?.name || (item.account_id ? `账号 #${item.account_id}` : '—') }}<small>{{ item.group?.name || (item.group_id ? `分组 #${item.group_id}` : '—') }}</small></td><td>{{ item.model }}<small v-if="item.upstream_model">上游 {{ item.upstream_model }}<template v-if="item.upstream_model_mismatch"> · 不一致</template></small></td><td>{{ item.request_type || (item.stream ? 'stream' : 'sync') }}<small>{{ item.billing_mode || `billing #${item.billing_type}` }}</small></td><td>{{ formatCompactNumber(item.input_tokens + item.output_tokens + item.cache_creation_tokens + item.cache_read_tokens) }}<small>入 {{ formatCompactNumber(item.input_tokens) }} / 出 {{ formatCompactNumber(item.output_tokens) }}</small></td><td>{{ formatMoney(item.actual_cost) }}<small>标准 {{ formatMoney(item.total_cost) }} · 账号 {{ formatMoney(item.account_stats_cost) }}</small></td><td>{{ formatDuration(item.duration_ms) }}<small>首 token {{ formatDuration(item.first_token_ms) }}</small></td><td><button class="resource-link" @click="openDetail(item)">详情</button></td></tr></tbody></table></div></PageState><footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; loadUsage()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option><option :value="100">100 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; loadUsage()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; loadUsage()">下一页</button></div></footer></template>

      <template v-else-if="activeTab === AdminUsageTab.ERRORS"><div v-if="secondaryLoading" class="page-state">正在加载错误请求…</div><div v-else-if="!errors.length" class="resource-empty-inline">当前筛选范围没有错误请求。</div><div v-else class="resource-table"><table><thead><tr><th>时间</th><th>错误</th><th>用户 / Key</th><th>账号 / 分组</th><th>模型 / 平台</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in errors" :key="item.id"><td>{{ formatGovernanceDate(item.created_at) }}<small><code>{{ item.request_id }}</code></small></td><td><strong>{{ item.message }}</strong><small>{{ item.phase }} · {{ item.type }} · {{ item.error_source }}</small></td><td>{{ item.user_email || `用户 #${item.user_id}` }}<small>{{ item.api_key_name || `Key #${item.api_key_id}` }}</small></td><td>{{ item.account_name || `#${item.account_id}` }}<small>{{ item.group_name || `#${item.group_id}` }}</small></td><td>{{ item.model }}<small>{{ item.platform }} · {{ item.status_code }}</small></td><td><span :class="['resource-status', item.resolved ? 'resource-status--active' : 'resource-status--error']">{{ item.resolved ? '已解决' : '待处理' }}</span></td><td><div class="resource-inline-actions"><button class="resource-link" @click="openErrorDetail(item.id)">详情</button><button class="resource-link" @click="toggleResolved(item)">{{ item.resolved ? '重新打开' : '标记解决' }}</button></div></td></tr></tbody></table></div><footer class="resource-pagination"><span>共 {{ errorTotal }} 条 · 第 {{ errorPage }} / {{ errorPages }} 页</span><div class="resource-pagination__actions"><button class="resource-button resource-button--secondary" :disabled="errorPage <= 1" @click="errorPage--; loadErrors()">上一页</button><button class="resource-button resource-button--secondary" :disabled="errorPage >= errorPages" @click="errorPage++; loadErrors()">下一页</button></div></footer></template>

      <template v-else-if="activeTab === AdminUsageTab.RANKING"><div v-if="secondaryLoading" class="page-state">正在计算用户排行…</div><div v-else class="resource-table"><table><thead><tr><th>排名</th><th>用户</th><th>请求</th><th>输入</th><th>输出</th><th>缓存</th><th>总 Tokens</th><th>实收</th><th>账号成本</th></tr></thead><tbody><tr v-for="(item, index) in rankings" :key="item.user_id"><td>#{{ index + 1 }}</td><td><button class="resource-link" @click="filters.userId = String(item.user_id); switchTab(AdminUsageTab.USAGE); applyFilters()">{{ item.email }}</button><small>#{{ item.user_id }}</small></td><td>{{ formatCompactNumber(item.requests) }}</td><td>{{ formatCompactNumber(item.input_tokens) }}</td><td>{{ formatCompactNumber(item.output_tokens) }}</td><td>{{ formatCompactNumber(item.cache_tokens) }}</td><td>{{ formatCompactNumber(item.total_tokens) }}</td><td>{{ formatMoney(item.actual_cost) }}</td><td>{{ formatMoney(item.account_cost) }}</td></tr></tbody></table></div></template>

      <template v-else><div v-if="secondaryLoading" class="page-state">正在加载清理任务…</div><div v-else-if="!cleanupTasks.length" class="resource-empty-inline">尚无清理任务。</div><div v-else class="resource-table"><table><thead><tr><th>任务</th><th>范围与筛选</th><th>状态</th><th>删除行数</th><th>时间</th><th>操作</th></tr></thead><tbody><tr v-for="item in cleanupTasks" :key="item.id"><td>#{{ item.id }}<small>创建人 #{{ item.created_by }}</small></td><td>{{ formatGovernanceDate(item.filters.start_time) }} → {{ formatGovernanceDate(item.filters.end_time) }}<small>{{ JSON.stringify(item.filters) }}</small></td><td><span :class="['resource-status', item.status === 'completed' ? 'resource-status--active' : item.status === 'failed' ? 'resource-status--error' : '']">{{ item.status }}</span><small v-if="item.error_message">{{ item.error_message }}</small></td><td>{{ item.deleted_rows }}</td><td>{{ formatGovernanceDate(item.created_at) }}<small>{{ item.finished_at ? `完成 ${formatGovernanceDate(item.finished_at)}` : '' }}</small></td><td><button v-if="['pending', 'queued', 'running'].includes(item.status)" class="resource-link resource-link--danger" @click="cancelCleanup(item)">取消任务</button></td></tr></tbody></table></div></template>
    </main>

    <SurfaceDialog :show="detailOpen" title="用量记录详情" description="包含端点、模型映射、分项 token、成本、图像计费与请求上下文。" :width="DialogWidth.WIDE" @close="detailOpen = false"><template v-if="detail"><dl class="governance-detail"><dt>请求 ID</dt><dd><code>{{ detail.request_id }}</code></dd><dt>用户 / Key</dt><dd>#{{ detail.user_id }} / #{{ detail.api_key_id }}</dd><dt>账号 / 分组 / 渠道</dt><dd>#{{ detail.account_id }} / #{{ detail.group_id }} / #{{ detail.channel_id || '—' }}</dd><dt>请求模型</dt><dd>{{ detail.model }}</dd><dt>上游模型</dt><dd>{{ detail.upstream_model || '—' }} · 响应 {{ detail.upstream_response_model || '—' }}</dd><dt>映射链</dt><dd>{{ detail.model_mapping_chain || '—' }}</dd><dt>入站端点</dt><dd>{{ detail.inbound_endpoint || '—' }}</dd><dt>上游端点</dt><dd>{{ detail.upstream_endpoint || '—' }}</dd><dt>请求类型</dt><dd>{{ detail.request_type }} · stream={{ detail.stream }}</dd><dt>计费</dt><dd>{{ detail.billing_mode || detail.billing_type }} · tier {{ detail.billing_tier || '—' }}</dd><dt>Tokens</dt><dd>入 {{ detail.input_tokens }} / 出 {{ detail.output_tokens }} / 缓存写 {{ detail.cache_creation_tokens }} / 缓存读 {{ detail.cache_read_tokens }}</dd><dt>费用</dt><dd>标准 {{ formatMoney(detail.total_cost) }} / 实收 {{ formatMoney(detail.actual_cost) }} / 账号 {{ formatMoney(detail.account_stats_cost) }}</dd><dt>性能</dt><dd>{{ formatDuration(detail.duration_ms) }} · 首 token {{ formatDuration(detail.first_token_ms) }}</dd><dt>图像</dt><dd>{{ detail.image_count || 0 }} 张 · {{ detail.image_size || '—' }} · {{ formatMoney(detail.image_input_cost + detail.image_output_cost) }}</dd><dt>来源</dt><dd>{{ detail.ip_address || '—' }} · {{ detail.user_agent || '—' }}</dd></dl></template></SurfaceDialog>
    <SurfaceDialog :show="errorDetailOpen" title="错误请求详情" description="标准化分类、上下游错误体与分阶段耗时。" :width="DialogWidth.WIDE" @close="errorDetailOpen = false"><div v-if="!errorDetail" class="page-state">正在加载详情…</div><template v-else><dl class="governance-detail"><dt>错误</dt><dd>{{ errorDetail.message }}</dd><dt>分类</dt><dd>{{ errorDetail.phase }} · {{ errorDetail.type }} · {{ errorDetail.error_owner }} · {{ errorDetail.error_source }}</dd><dt>状态</dt><dd>{{ errorDetail.status_code }} / 上游 {{ errorDetail.upstream_status_code || '—' }} · {{ errorDetail.resolved ? '已解决' : '待处理' }}</dd><dt>请求</dt><dd>{{ errorDetail.request_path }} · <code>{{ errorDetail.request_id }}</code></dd><dt>模型</dt><dd>{{ errorDetail.requested_model || errorDetail.model }} → {{ errorDetail.upstream_model || '—' }}</dd><dt>用户 / Key</dt><dd>{{ errorDetail.user_email }} / {{ errorDetail.api_key_name }} {{ errorDetail.api_key_deleted ? '（已删除）' : '' }}</dd><dt>账号 / 分组</dt><dd>{{ errorDetail.account_name }} / {{ errorDetail.group_name }}</dd><dt>耗时</dt><dd>认证 {{ formatDuration(errorDetail.auth_latency_ms) }} · 路由 {{ formatDuration(errorDetail.routing_latency_ms) }} · 上游 {{ formatDuration(errorDetail.upstream_latency_ms) }} · 响应 {{ formatDuration(errorDetail.response_latency_ms) }}</dd></dl><h3>错误体</h3><pre class="resource-code">{{ errorDetail.error_body || errorDetail.upstream_error_detail || errorDetail.upstream_error_message || '无' }}</pre></template></SurfaceDialog>
    <SurfaceDialog :show="cleanupOpen" title="创建用量清理任务" description="任务由后端异步执行，可在“清理任务”页签查看进度或取消。当前用户、Key、账号、分组、模型等筛选会一并提交。" :width="DialogWidth.STANDARD" @close="cleanupOpen = false"><form id="usage-cleanup-form" class="resource-form-stack" @submit.prevent="createCleanup"><div class="resource-form-grid"><label>开始日期 *<input v-model="cleanupForm.startDate" type="date" required /></label><label>结束日期 *<input v-model="cleanupForm.endDate" type="date" required /></label></div><label>时区<input v-model="cleanupForm.timezone" required /></label><pre class="resource-code">{{ JSON.stringify(listParams(1, 1), null, 2) }}</pre></form><template #footer><button class="button button--secondary" @click="cleanupOpen = false">取消</button><button type="submit" form="usage-cleanup-form" class="button resource-button--danger" :disabled="cleanupSaving">{{ cleanupSaving ? '创建中…' : '创建清理任务' }}</button></template></SurfaceDialog>
  </ConsoleShell>
</template>
