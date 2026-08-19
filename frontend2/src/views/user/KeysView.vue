<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as authAPI from '@shared-api/auth'
import * as userGroupsAPI from '@shared-api/groups'
import * as keysAPI from '@shared-api/keys'
import * as usageAPI from '@shared-api/usage'
import type { BatchApiKeyUsageStats } from '@shared-api/usage'
import { buildCcSwitchImportDeeplink, type CcSwitchClientType } from '@shared-utils/ccswitchImport'
import type { ApiKey, Group, PublicSettings } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import KeyEditorDialog from '@/components/user/keys/KeyEditorDialog.vue'
import KeyUseDialog from '@/components/user/keys/KeyUseDialog.vue'
import {
  CcSwitchClient,
  formatMoney,
  formatResetCountdown,
  KeyColumnKey,
  keyColumns,
  KeyEditorMode,
  KeySortOrder,
  KeyStatusFilter,
  maskApiKey,
  quotaPercent
} from '@/features/user/keys/model'
import { useAppStore } from '@/stores/app'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'

interface EndpointItem {
  name: string
  url: string
  description: string
}

const COLUMN_STORAGE_KEY = 'frontend2-api-key-hidden-columns-v1'
const app = useAppStore()
const confirmDialog = useConfirmStore()
const apiKeys = ref<ApiKey[]>([])
const groups = ref<Group[]>([])
const userGroupRates = ref<Record<number, number>>({})
const publicSettings = ref<PublicSettings | null>(null)
const usageStats = ref<Record<string, BatchApiKeyUsageStats>>({})
const loading = ref(true)
const error = ref('')
const editorOpen = ref(false)
const editorMode = ref(KeyEditorMode.CREATE)
const selectedKey = ref<ApiKey | null>(null)
const useDialogOpen = ref(false)
const endpointsDialogOpen = ref(false)
const ccsDialogOpen = ref(false)
const revealedKey = ref('')
const copiedKeyId = ref<number | null>(null)
const showColumnMenu = ref(false)
const busyKeyIds = ref(new Set<number>())
const testingEndpoint = ref('')
const hiddenColumns = ref(new Set<KeyColumnKey>())
const filters = reactive({ search: '', status: KeyStatusFilter.ALL, groupId: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0, pages: 1 })
const sort = reactive({ by: KeyColumnKey.CREATED_AT, order: KeySortOrder.DESC })
let abortController: AbortController | null = null
let searchTimer: number | undefined

const statusLabels: Record<ApiKey['status'], string> = {
  active: '运行中',
  inactive: '已停用',
  quota_exhausted: '额度耗尽',
  expired: '已过期'
}

const groupMap = computed(() => new Map(groups.value.map((group) => [group.id, group])))
const visibleColumns = computed(() => keyColumns.filter((column) => !hiddenColumns.value.has(column.key)))
const pageSizes = computed(() => {
  const configured = publicSettings.value?.table_page_size_options ?? [10, 20, 50, 100]
  return Array.from(new Set([...configured.filter((value) => value > 0), pagination.pageSize])).sort((a, b) => a - b)
})
const summary = computed(() => ({
  visible: apiKeys.value.length,
  active: apiKeys.value.filter((key) => key.status === 'active').length,
  today: Object.values(usageStats.value).reduce((total, item) => total + Number(item.today_actual_cost || 0), 0),
  lifetime: Object.values(usageStats.value).reduce((total, item) => total + Number(item.total_actual_cost || 0), 0)
}))
const selectedGroup = computed(() => selectedKey.value?.group ?? (selectedKey.value?.group_id ? groupMap.value.get(selectedKey.value.group_id) : undefined))
const endpointItems = computed<EndpointItem[]>(() => {
  const root = (publicSettings.value?.api_base_url || window.location.origin).replace(/\/+$/, '').replace(/\/v1$/, '')
  const defaults: EndpointItem[] = [
    { name: '统一 API 地址', url: `${root}/v1`, description: 'OpenAI / Anthropic 兼容客户端的推荐入口' },
    { name: '模型列表', url: `${root}/v1/models`, description: '用于连通性检查与模型发现' }
  ]
  const custom = (publicSettings.value?.custom_endpoints ?? []).map((item) => ({
    name: item.name,
    url: item.endpoint,
    description: item.description || '管理员配置的自定义端点'
  }))
  return [...defaults, ...custom]
})

function isAbortError(caught: unknown): boolean {
  const candidate = caught as { name?: string; code?: string }
  return candidate?.name === 'AbortError' || candidate?.code === 'ERR_CANCELED'
}

function restoreColumns(): void {
  try {
    const stored = localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!stored) {
      hiddenColumns.value = new Set(keyColumns.filter((column) => !column.defaultVisible).map((column) => column.key))
      return
    }
    const parsed = JSON.parse(stored) as string[]
    const valid = new Set(keyColumns.map((column) => column.key))
    hiddenColumns.value = new Set(parsed.filter((key): key is KeyColumnKey => valid.has(key as KeyColumnKey)))
  } catch {
    hiddenColumns.value = new Set(keyColumns.filter((column) => !column.defaultVisible).map((column) => column.key))
  }
}

function persistColumns(): void {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...hiddenColumns.value]))
  } catch {
    // Storage can be unavailable in privacy mode; current-session state still works.
  }
}

function toggleColumn(key: KeyColumnKey): void {
  const column = keyColumns.find((item) => item.key === key)
  if (column?.alwaysVisible) return
  const next = new Set(hiddenColumns.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hiddenColumns.value = next
  persistColumns()
}

function setBusy(id: number, busy: boolean): void {
  const next = new Set(busyKeyIds.value)
  if (busy) next.add(id)
  else next.delete(id)
  busyKeyIds.value = next
}

function replaceRow(saved: ApiKey): void {
  const index = apiKeys.value.findIndex((item) => item.id === saved.id)
  if (index >= 0) apiKeys.value.splice(index, 1, saved)
}

async function loadSupport(): Promise<void> {
  const [groupResult, rateResult, settingsResult] = await Promise.allSettled([
    userGroupsAPI.getAvailable(),
    userGroupsAPI.getUserGroupRates(),
    authAPI.getPublicSettings()
  ])
  if (groupResult.status === 'fulfilled') groups.value = groupResult.value
  if (rateResult.status === 'fulfilled') userGroupRates.value = rateResult.value
  if (settingsResult.status === 'fulfilled') {
    publicSettings.value = settingsResult.value
    const defaultSize = Number(settingsResult.value.table_default_page_size)
    if (Number.isFinite(defaultSize) && defaultSize > 0) pagination.pageSize = defaultSize
  }
}

async function loadKeys(): Promise<void> {
  abortController?.abort()
  const controller = new AbortController()
  abortController = controller
  loading.value = true
  error.value = ''
  try {
    const response = await keysAPI.list(pagination.page, pagination.pageSize, {
      search: filters.search.trim() || undefined,
      status: filters.status || undefined,
      group_id: filters.groupId || undefined,
      sort_by: sort.by,
      sort_order: sort.order
    }, { signal: controller.signal })
    if (controller.signal.aborted) return
    apiKeys.value = response.items
    pagination.total = response.total
    pagination.pages = Math.max(1, response.pages)
    usageStats.value = {}
    if (response.items.length > 0) {
      try {
        const usage = await usageAPI.getDashboardApiKeysUsage(response.items.map((key) => key.id), { signal: controller.signal })
        if (!controller.signal.aborted) usageStats.value = usage.stats
      } catch (caught) {
        if (!isAbortError(caught)) app.showError('Key 用量摘要暂时无法加载，配置管理不受影响')
      }
    }
  } catch (caught) {
    if (!isAbortError(caught)) error.value = (caught as { message?: string }).message || 'API Key 加载失败'
  } finally {
    if (abortController === controller) loading.value = false
  }
}

function applyFilters(): void {
  pagination.page = 1
  void loadKeys()
}

function onSearchInput(): void {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(applyFilters, 320)
}

function clearFilters(): void {
  filters.search = ''
  filters.status = KeyStatusFilter.ALL
  filters.groupId = ''
  applyFilters()
}

function changePage(page: number): void {
  if (page < 1 || page > pagination.pages || page === pagination.page) return
  pagination.page = page
  void loadKeys()
}

function changePageSize(event: Event): void {
  pagination.pageSize = Number((event.target as HTMLSelectElement).value)
  pagination.page = 1
  void loadKeys()
}

function changeSort(key: KeyColumnKey): void {
  const column = keyColumns.find((item) => item.key === key)
  if (!column?.sortable) return
  if (sort.by === key) sort.order = sort.order === KeySortOrder.ASC ? KeySortOrder.DESC : KeySortOrder.ASC
  else {
    sort.by = key
    sort.order = KeySortOrder.ASC
  }
  pagination.page = 1
  void loadKeys()
}

function openCreate(): void {
  selectedKey.value = null
  editorMode.value = KeyEditorMode.CREATE
  editorOpen.value = true
}

function openEdit(key: ApiKey): void {
  selectedKey.value = key
  editorMode.value = KeyEditorMode.EDIT
  editorOpen.value = true
}

function handleSaved(key: ApiKey, mode: KeyEditorMode): void {
  if (mode === KeyEditorMode.CREATE) revealedKey.value = key.key
  replaceRow(key)
  void loadKeys()
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    app.showSuccess(successMessage)
  } catch {
    app.showError('复制失败，请手动选择内容')
  }
}

async function copyKey(key: ApiKey): Promise<void> {
  await copyText(key.key, '完整 API Key 已复制')
  copiedKeyId.value = key.id
  window.setTimeout(() => { if (copiedKeyId.value === key.id) copiedKeyId.value = null }, 1000)
}

async function toggleStatus(key: ApiKey): Promise<void> {
  if (busyKeyIds.value.has(key.id)) return
  const next = key.status === 'active' ? 'inactive' : 'active'
  setBusy(key.id, true)
  try {
    replaceRow(await keysAPI.toggleStatus(key.id, next))
    app.showSuccess(next === 'active' ? 'API Key 已启用' : 'API Key 已停用')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '状态更新失败')
  } finally {
    setBusy(key.id, false)
  }
}

async function changeGroup(key: ApiKey, event: Event): Promise<void> {
  if (busyKeyIds.value.has(key.id)) return
  const groupId = Number((event.target as HTMLSelectElement).value)
  if (!Number.isFinite(groupId) || groupId === key.group_id) return
  setBusy(key.id, true)
  try {
    replaceRow(await keysAPI.update(key.id, { group_id: groupId }))
    app.showSuccess('访问分组已更新')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '分组更新失败')
    ;(event.target as HTMLSelectElement).value = String(key.group_id ?? '')
  } finally {
    setBusy(key.id, false)
  }
}

async function resetRateUsage(key: ApiKey): Promise<void> {
  if (busyKeyIds.value.has(key.id)) return
  const confirmed = await confirmDialog.ask({
    title: '重置周期用量',
    message: `将“${key.name}”的 5 小时、1 天和 7 天滚动窗口用量同时清零。`,
    confirmText: '确认重置',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  setBusy(key.id, true)
  try {
    replaceRow(await keysAPI.update(key.id, { reset_rate_limit_usage: true }))
    app.showSuccess('周期用量已重置')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '周期用量重置失败')
  } finally {
    setBusy(key.id, false)
  }
}

async function removeKey(key: ApiKey): Promise<void> {
  if (busyKeyIds.value.has(key.id)) return
  const confirmed = await confirmDialog.ask({
    title: '删除 API Key',
    message: `将永久删除“${key.name}”，依赖该凭据的客户端会立即停止工作。`,
    confirmText: '永久删除',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  setBusy(key.id, true)
  try {
    await keysAPI.deleteKey(key.id)
    app.showSuccess('API Key 已删除')
    if (apiKeys.value.length === 1 && pagination.page > 1) pagination.page -= 1
    await loadKeys()
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '删除失败')
  } finally {
    setBusy(key.id, false)
  }
}

function openUseDialog(key: ApiKey): void {
  selectedKey.value = key
  useDialogOpen.value = true
}

function openEndpoints(key: ApiKey): void {
  selectedKey.value = key
  endpointsDialogOpen.value = true
}

async function testEndpoint(endpoint: EndpointItem): Promise<void> {
  if (!selectedKey.value || testingEndpoint.value) return
  const modelsUrl = endpoint.url.endsWith('/models') ? endpoint.url : `${endpoint.url.replace(/\/+$/, '')}/models`
  testingEndpoint.value = endpoint.url
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10_000)
  const started = performance.now()
  try {
    const response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${selectedKey.value.key}` },
      signal: controller.signal
    })
    const duration = Math.round(performance.now() - started)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    app.showSuccess(`端点可用 · ${duration} ms`)
  } catch (caught) {
    app.showError(controller.signal.aborted ? '测速超时（10 秒）' : `端点不可用：${(caught as { message?: string }).message || '请求失败'}`)
  } finally {
    window.clearTimeout(timeout)
    testingEndpoint.value = ''
  }
}

function openCcSwitch(key: ApiKey): void {
  selectedKey.value = key
  if (selectedGroup.value?.platform === 'antigravity') ccsDialogOpen.value = true
  else executeCcSwitch(selectedGroup.value?.platform === 'gemini' ? CcSwitchClient.GEMINI : CcSwitchClient.CLAUDE)
}

function executeCcSwitch(client: CcSwitchClient | CcSwitchClientType): void {
  if (!selectedKey.value) return
  const baseUrl = publicSettings.value?.api_base_url || window.location.origin
  const usageScript = `({request:{url:"{{baseUrl}}/v1/usage",method:"GET",headers:{Authorization:"Bearer {{apiKey}}"}},extractor:function(response){const remaining=response?.remaining??response?.quota?.remaining??response?.balance;return{isValid:response?.is_active??response?.isValid??true,remaining,unit:response?.unit??response?.quota?.unit??"USD"};}})`
  try {
    const deeplink = buildCcSwitchImportDeeplink({
      baseUrl,
      platform: selectedGroup.value?.platform,
      clientType: client,
      providerName: publicSettings.value?.site_name?.trim() || 'Sub2API',
      apiKey: selectedKey.value.key,
      usageScript
    })
    window.open(deeplink, '_self')
    ccsDialogOpen.value = false
  } catch {
    app.showError('无法唤起 CC Switch，请确认客户端已安装')
  }
}

function groupFor(key: ApiKey): Group | undefined {
  return key.group ?? (key.group_id ? groupMap.value.get(key.group_id) : undefined)
}

function formatDate(value: string | null): string {
  if (!value) return '从未'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatRate(value: number): string {
  return Number(value || 0) > 0 ? formatMoney(value, 2) : '不限'
}

function ratePercent(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.max(0, used / limit * 100)) : 0
}

onMounted(async () => {
  restoreColumns()
  await loadSupport()
  await loadKeys()
})

onBeforeUnmount(() => {
  abortController?.abort()
  window.clearTimeout(searchTimer)
})
</script>

<template>
  <ConsoleShell>
    <section class="keys-page">
      <header class="page-heading keys-heading">
        <div>
          <p>开发者凭据 · 服务端实时数据</p>
          <h1>API Key 工作台</h1>
          <span>创建、分组、限额、接入和故障检查集中在一个页面完成。</span>
        </div>
        <button class="button button--primary" type="button" data-tour="keys-create-btn" @click="openCreate">＋ 创建 API Key</button>
      </header>

      <section class="key-metrics" aria-label="当前页 Key 摘要">
        <div><span>全部 Key</span><strong>{{ pagination.total }}</strong><small>服务端结果总数</small></div>
        <div><span>本页运行中</span><strong>{{ summary.active }} / {{ summary.visible }}</strong><small>当前结果页</small></div>
        <div><span>本页今日消费</span><strong>{{ formatMoney(summary.today) }}</strong><small>批量用量统计</small></div>
        <div><span>本页累计消费</span><strong>{{ formatMoney(summary.lifetime) }}</strong><small>批量用量统计</small></div>
      </section>

      <aside v-if="revealedKey" class="secret-reveal" role="status">
        <div><strong>新 Key 已创建，请立即保存</strong><small>离开本页面后仍只建议通过复制按钮使用，避免在公开场合展示。</small></div>
        <code>{{ revealedKey }}</code>
        <button type="button" @click="copyText(revealedKey, '新 API Key 已复制')">复制完整 Key</button>
        <button type="button" aria-label="关闭提示" @click="revealedKey = ''">×</button>
      </aside>

      <section class="key-toolbar" aria-label="API Key 筛选">
        <label class="search-field"><span>搜索</span><input v-model="filters.search" type="search" placeholder="名称、Key 或 ID" @input="onSearchInput"></label>
        <label><span>状态</span><select v-model="filters.status" @change="applyFilters"><option :value="KeyStatusFilter.ALL">全部状态</option><option :value="KeyStatusFilter.ACTIVE">运行中</option><option :value="KeyStatusFilter.INACTIVE">已停用</option><option :value="KeyStatusFilter.QUOTA_EXHAUSTED">额度耗尽</option><option :value="KeyStatusFilter.EXPIRED">已过期</option></select></label>
        <label><span>访问分组</span><select v-model="filters.groupId" @change="applyFilters"><option value="">全部分组</option><option v-for="group in groups" :key="group.id" :value="String(group.id)">{{ group.name }} · {{ group.platform }}</option></select></label>
        <button class="toolbar-button" type="button" @click="clearFilters">清空筛选</button>
        <div class="column-control">
          <button class="toolbar-button" type="button" :aria-expanded="showColumnMenu" @click="showColumnMenu = !showColumnMenu">显示字段 · {{ visibleColumns.length }}</button>
          <div v-if="showColumnMenu" class="column-menu">
            <strong>表格字段</strong>
            <label v-for="column in keyColumns" :key="column.key"><input type="checkbox" :checked="!hiddenColumns.has(column.key)" :disabled="column.alwaysVisible" @change="toggleColumn(column.key)"><span>{{ column.label }}</span></label>
          </div>
        </div>
        <button class="toolbar-button toolbar-button--refresh" type="button" :disabled="loading" @click="loadKeys">{{ loading ? '刷新中…' : '刷新数据' }}</button>
      </section>

      <PageState :loading="loading" :error="error" :empty="!loading && !error && apiKeys.length === 0" empty-text="没有符合当前条件的 API Key。" @retry="loadKeys">
        <template #empty-action><button class="button button--primary" type="button" @click="openCreate">创建第一个 Key</button></template>
        <div class="keys-table-wrap">
          <table>
            <thead><tr><th v-for="column in visibleColumns" :key="column.key"><button v-if="column.sortable" type="button" @click="changeSort(column.key)">{{ column.label }} <span v-if="sort.by === column.key">{{ sort.order === KeySortOrder.ASC ? '↑' : '↓' }}</span></button><span v-else>{{ column.label }}</span></th></tr></thead>
            <tbody>
              <tr v-for="key in apiKeys" :key="key.id">
                <td v-if="!hiddenColumns.has(KeyColumnKey.NAME)" class="name-cell"><strong>{{ key.name }}</strong><small>{{ groupFor(key)?.platform || '未绑定平台' }}</small></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.ID)"><code>#{{ key.id }}</code></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.KEY)" class="key-cell"><code>{{ maskApiKey(key.key) }}</code><button type="button" @click="copyKey(key)">{{ copiedKeyId === key.id ? '已复制' : '复制' }}</button></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.GROUP)" class="group-cell"><select :value="key.group_id ?? ''" :disabled="busyKeyIds.has(key.id)" :title="groupFor(key)?.description || undefined" @change="changeGroup(key, $event)"><option value="" disabled>选择分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }} · {{ userGroupRates[group.id] ?? group.rate_multiplier }}×</option></select><small v-if="groupFor(key)?.peak_rate_enabled">高峰 {{ groupFor(key)?.peak_start }}–{{ groupFor(key)?.peak_end }} · {{ groupFor(key)?.peak_rate_multiplier }}×</small></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.CONCURRENCY)" class="number-cell"><strong>{{ key.current_concurrency || 0 }}</strong></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.USAGE)" class="usage-cell"><div><span>今日</span><strong>{{ formatMoney(usageStats[String(key.id)]?.today_actual_cost || 0) }}</strong></div><div><span>累计</span><strong>{{ formatMoney(usageStats[String(key.id)]?.total_actual_cost || key.quota_used) }}</strong></div><div v-if="key.quota > 0" class="mini-progress"><i :style="{ width: `${quotaPercent(key.quota_used, key.quota)}%` }"></i></div><small>{{ key.quota > 0 ? `额度 ${formatMoney(key.quota, 2)}` : '总额度不限' }}</small></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.RATE_LIMIT)" class="rate-cell"><div v-for="windowItem in [{ label: '5h', used: key.usage_5h, limit: key.rate_limit_5h, reset: key.reset_5h_at }, { label: '1d', used: key.usage_1d, limit: key.rate_limit_1d, reset: key.reset_1d_at }, { label: '7d', used: key.usage_7d, limit: key.rate_limit_7d, reset: key.reset_7d_at }]" :key="windowItem.label"><span>{{ windowItem.label }}</span><strong>{{ formatMoney(windowItem.used || 0, 2) }} / {{ formatRate(windowItem.limit) }}</strong><i><b :style="{ width: `${ratePercent(windowItem.used, windowItem.limit)}%` }"></b></i><small v-if="windowItem.limit > 0">{{ formatResetCountdown(windowItem.reset) }}</small></div><button v-if="key.usage_5h > 0 || key.usage_1d > 0 || key.usage_7d > 0" type="button" :disabled="busyKeyIds.has(key.id)" @click="resetRateUsage(key)">重置周期用量</button></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.EXPIRES_AT)"><span :class="['date-value', { warning: key.status === 'expired' }]">{{ key.expires_at ? formatDate(key.expires_at) : '永不过期' }}</span></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.STATUS)"><span :class="['key-status', `key-status--${key.status}`]">{{ statusLabels[key.status] }}</span></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.LAST_USED_AT)">{{ formatDate(key.last_used_at) }}</td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.LAST_USED_IP)"><code>{{ key.last_used_ip || '—' }}</code></td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.CREATED_AT)">{{ formatDate(key.created_at) }}</td>
                <td v-if="!hiddenColumns.has(KeyColumnKey.ACTIONS)" class="actions-cell"><div><button type="button" @click="openUseDialog(key)">接入</button><button type="button" @click="openEdit(key)">编辑</button><button type="button" @click="openEndpoints(key)">端点</button><button v-if="!publicSettings?.hide_ccs_import_button" type="button" @click="openCcSwitch(key)">CC Switch</button><button type="button" :disabled="busyKeyIds.has(key.id)" @click="toggleStatus(key)">{{ key.status === 'active' ? '停用' : '启用' }}</button><button class="danger" type="button" :disabled="busyKeyIds.has(key.id)" @click="removeKey(key)">删除</button></div></td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer class="pagination-bar">
          <p>第 {{ pagination.page }} / {{ pagination.pages }} 页 · 共 {{ pagination.total }} 条</p>
          <label>每页 <select :value="pagination.pageSize" @change="changePageSize"><option v-for="size in pageSizes" :key="size" :value="size">{{ size }}</option></select> 条</label>
          <nav aria-label="API Key 分页"><button type="button" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">上一页</button><button type="button" :disabled="pagination.page >= pagination.pages" @click="changePage(pagination.page + 1)">下一页</button></nav>
        </footer>
      </PageState>
    </section>

    <KeyEditorDialog :show="editorOpen" :mode="editorMode" :api-key="selectedKey" :groups="groups" :user-group-rates="userGroupRates" @close="editorOpen = false" @saved="handleSaved" />
    <KeyUseDialog :show="useDialogOpen" :api-key="selectedKey?.key || ''" :base-url="publicSettings?.api_base_url || ''" :platform="selectedGroup?.platform || null" :allow-messages-dispatch="Boolean(selectedGroup?.allow_messages_dispatch)" @close="useDialogOpen = false" />

    <SurfaceDialog :show="endpointsDialogOpen" title="端点与连通性" :description="selectedKey ? `使用“${selectedKey.name}”复制地址或执行真实鉴权测速。` : ''" :width="DialogWidth.STANDARD" @close="endpointsDialogOpen = false">
      <div class="endpoint-list"><article v-for="endpoint in endpointItems" :key="endpoint.url"><div><strong>{{ endpoint.name }}</strong><code>{{ endpoint.url }}</code><small>{{ endpoint.description }}</small></div><div><button type="button" @click="copyText(endpoint.url, '端点地址已复制')">复制</button><button type="button" :disabled="Boolean(testingEndpoint)" @click="testEndpoint(endpoint)">{{ testingEndpoint === endpoint.url ? '测速中…' : '测速' }}</button></div></article></div>
      <template #footer><button type="button" class="button button--secondary" @click="endpointsDialogOpen = false">关闭</button></template>
    </SurfaceDialog>

    <SurfaceDialog :show="ccsDialogOpen" title="选择 CC Switch 客户端" description="Antigravity 分组同时支持 Claude 与 Gemini 入口。" :width="DialogWidth.COMPACT" @close="ccsDialogOpen = false">
      <div class="ccs-options"><button type="button" @click="executeCcSwitch(CcSwitchClient.CLAUDE)"><strong>Claude</strong><span>导入 Anthropic / Claude Code 配置</span></button><button type="button" @click="executeCcSwitch(CcSwitchClient.GEMINI)"><strong>Gemini</strong><span>导入 Gemini CLI 配置</span></button></div>
    </SurfaceDialog>
  </ConsoleShell>
</template>

<style scoped>
.keys-page { min-width: 0; }
.keys-heading { align-items: flex-end; }
.keys-heading > div { max-width: 760px; }
.keys-heading h1 { font-size: clamp(38px, 5vw, 66px); }
.keys-heading span { display: block; margin-top: 12px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.key-metrics { margin-bottom: 24px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-block: 1px solid var(--border-subtle); }
.key-metrics > div { padding: 19px 20px; display: grid; gap: 7px; border-right: 1px solid var(--border-subtle); }
.key-metrics > div:first-child { padding-left: 0; }.key-metrics > div:last-child { border-right: 0; }
.key-metrics span, .key-metrics small { color: var(--text-secondary); font-size: var(--font-meta); }.key-metrics strong { font-size: 23px; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
.secret-reveal { margin-bottom: 16px; padding: 15px; display: grid; grid-template-columns: minmax(210px, .7fr) minmax(240px, 1.3fr) auto auto; align-items: center; gap: 12px; color: var(--text-primary); background: color-mix(in srgb, var(--accent) 8%, var(--surface-raised)); border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border-subtle)); border-radius: 12px; }
.secret-reveal > div { display: grid; gap: 4px; }.secret-reveal small { color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.4; }.secret-reveal code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.secret-reveal button { min-height: 32px; padding: 0 9px; color: var(--accent); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; }.secret-reveal button:last-child { width: 32px; padding: 0; color: var(--text-secondary); }
.key-toolbar { position: relative; z-index: 4; margin-bottom: 12px; padding: 12px; display: grid; grid-template-columns: minmax(190px, 1.4fr) minmax(130px, .7fr) minmax(170px, .9fr) auto auto auto; align-items: end; gap: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }
.key-toolbar label { display: grid; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); }.key-toolbar input, .key-toolbar select { width: 100%; min-height: 39px; padding: 0 10px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; outline: none; }.key-toolbar input:focus, .key-toolbar select:focus { border-color: var(--accent); }
.toolbar-button { min-height: 39px; padding: 0 11px; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; white-space: nowrap; font-size: var(--font-meta); }.toolbar-button--refresh { color: var(--accent); }
.column-control { position: relative; }.column-menu { position: absolute; z-index: 8; top: calc(100% + 7px); right: 0; width: 220px; max-height: 390px; padding: 12px; display: grid; gap: 3px; overflow: auto; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; box-shadow: 0 18px 45px rgba(16, 13, 28, .16); }.column-menu > strong { padding: 4px 5px 9px; font-size: var(--font-body-sm); }.column-menu label { padding: 6px; display: flex; align-items: center; gap: 8px; color: var(--text-primary); border-radius: 6px; cursor: pointer; }.column-menu label:hover { background: var(--surface-canvas); }.column-menu input { width: auto; min-height: auto; accent-color: var(--accent); }
.keys-table-wrap { overflow: auto; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }
table { width: 100%; min-width: 1420px; border-collapse: collapse; }th, td { padding: 13px 14px; vertical-align: top; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }th { position: sticky; z-index: 2; top: 0; color: var(--text-secondary); background: var(--surface-raised); font-size: var(--font-meta); letter-spacing: .06em; text-transform: uppercase; }th button { padding: 0; color: inherit; background: transparent; border: 0; cursor: pointer; font: inherit; letter-spacing: inherit; text-transform: inherit; }tbody tr:last-child td { border-bottom: 0; }tbody tr:hover td { background: color-mix(in srgb, var(--accent) 2.5%, var(--surface-raised)); }
.name-cell { min-width: 150px; }.name-cell strong, .name-cell small { display: block; }.name-cell strong { max-width: 190px; overflow: hidden; font-size: 12px; text-overflow: ellipsis; }.name-cell small { margin-top: 5px; color: var(--text-secondary); text-transform: uppercase; }
.key-cell { min-width: 220px; }.key-cell code { display: block; font-size: var(--font-meta); }.key-cell button, .rate-cell button { margin-top: 6px; padding: 3px 6px; color: var(--accent); background: transparent; border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border-subtle)); border-radius: 5px; cursor: pointer; font-size: var(--font-meta); }
.group-cell { min-width: 210px; }.group-cell select { width: 100%; min-height: 34px; padding: 0 8px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; }.group-cell small { display: block; margin-top: 6px; color: var(--text-secondary); }
.number-cell strong { font-size: 15px; }.usage-cell { min-width: 155px; }.usage-cell > div:not(.mini-progress) { display: flex; justify-content: space-between; gap: 10px; }.usage-cell > div + div { margin-top: 4px; }.usage-cell span, .usage-cell small { color: var(--text-secondary); }.mini-progress { height: 4px; margin-top: 8px; overflow: hidden; background: var(--border-subtle); border-radius: 99px; }.mini-progress i { height: 100%; display: block; background: var(--accent); }
.rate-cell { min-width: 245px; }.rate-cell > div { display: grid; grid-template-columns: 23px minmax(90px, 1fr) 50px auto; align-items: center; gap: 5px; margin-bottom: 5px; }.rate-cell span, .rate-cell small { color: var(--text-secondary); font-size: var(--font-meta); }.rate-cell i { height: 3px; overflow: hidden; background: var(--border-subtle); border-radius: 9px; }.rate-cell i b { height: 100%; display: block; background: var(--accent); }.rate-cell button { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 28%, var(--border-subtle)); }
.date-value { white-space: nowrap; }.date-value.warning { color: var(--danger); }.key-status { padding: 4px 7px; display: inline-flex; border: 1px solid var(--border-subtle); border-radius: 99px; white-space: nowrap; }.key-status--active { color: var(--success); border-color: color-mix(in srgb, var(--success) 45%, var(--border-subtle)); }.key-status--inactive { color: var(--text-secondary); }.key-status--quota_exhausted, .key-status--expired { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--border-subtle)); }
.actions-cell { position: sticky; right: 0; min-width: 174px; background: var(--surface-raised); box-shadow: -12px 0 18px -18px rgba(0, 0, 0, .45); }.actions-cell > div { display: flex; flex-wrap: wrap; gap: 4px; }.actions-cell button { min-height: 25px; padding: 0 6px; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 5px; cursor: pointer; font-size: var(--font-meta); }.actions-cell button:hover { color: var(--accent); border-color: var(--accent); }.actions-cell button.danger { color: var(--danger); }
.pagination-bar { min-height: 66px; padding: 12px 3px; display: flex; align-items: center; gap: 18px; color: var(--text-secondary); font-size: var(--font-meta); }.pagination-bar p { margin: 0 auto 0 0; }.pagination-bar label { display: flex; align-items: center; gap: 6px; }.pagination-bar select, .pagination-bar button { min-height: 34px; padding: 0 9px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; }.pagination-bar nav { display: flex; gap: 5px; }.pagination-bar button { cursor: pointer; }.pagination-bar button:disabled { opacity: .45; cursor: default; }
.endpoint-list { display: grid; gap: 8px; }.endpoint-list article { padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }.endpoint-list article > div:first-child { min-width: 0; display: grid; gap: 5px; }.endpoint-list code { overflow: hidden; color: var(--accent); text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-meta); }.endpoint-list small { color: var(--text-secondary); font-size: var(--font-meta); }.endpoint-list article > div:last-child { display: flex; align-items: center; gap: 5px; }.endpoint-list button { min-height: 32px; padding: 0 8px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; }
.ccs-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 9px; }.ccs-options button { min-height: 120px; padding: 16px; display: grid; align-content: center; gap: 7px; color: var(--text-primary); text-align: left; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 11px; cursor: pointer; }.ccs-options button:hover { border-color: var(--accent); }.ccs-options strong { font-size: 16px; }.ccs-options span { color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.45; }
@media (max-width: 1100px) { .key-metrics { grid-template-columns: repeat(2, 1fr); }.key-metrics > div:nth-child(2) { border-right: 0; }.key-metrics > div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); }.key-toolbar { grid-template-columns: repeat(3, minmax(0, 1fr)); }.search-field { grid-column: span 2; }.toolbar-button--refresh { grid-column: auto; }.secret-reveal { grid-template-columns: 1fr auto; }.secret-reveal code { grid-column: 1 / -1; grid-row: 2; }.secret-reveal button:last-child { grid-column: 2; grid-row: 1; } }
@media (max-width: 680px) { .keys-heading { align-items: stretch; }.keys-heading .button { width: 100%; }.key-metrics { grid-template-columns: 1fr 1fr; }.key-metrics > div { padding: 14px 10px; }.key-metrics > div:first-child { padding-left: 10px; }.key-metrics strong { font-size: 18px; }.key-toolbar { grid-template-columns: 1fr 1fr; }.search-field { grid-column: 1 / -1; }.key-toolbar label:nth-child(3) { grid-column: 1 / -1; }.secret-reveal { grid-template-columns: 1fr auto; }.secret-reveal code { grid-column: 1 / -1; }.pagination-bar { align-items: flex-start; flex-wrap: wrap; }.pagination-bar p { width: 100%; }.ccs-options { grid-template-columns: 1fr; } }
</style>
