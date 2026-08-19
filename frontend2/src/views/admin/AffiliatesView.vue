<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import affiliatesAPI, {
  type AffiliateAdminEntry,
  type AffiliateInviteRecord,
  type AffiliateRebateRecord,
  type AffiliateTransferRecord,
  type AffiliateUserOverview,
  type ListAffiliateRecordsParams,
  type SimpleUser
} from '@shared-api/admin/affiliates'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { AffiliateRecordKind, SortOrder, formatCommerceDate, nextSort } from '@/features/admin/commerce/model'

type AffiliateRecord = AffiliateInviteRecord | AffiliateRebateRecord | AffiliateTransferRecord
enum AffiliateEditorMode { ADD = 'add', EDIT = 'edit' }

const props = defineProps<{ kind: AffiliateRecordKind }>()
const app = useAppStore()
const confirm = useConfirmStore()
const records = ref<AffiliateRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const error = ref('')
const filters = reactive({ search: '', startAt: '', endAt: '' })
const sort = reactive({ by: 'created_at', order: SortOrder.DESC })
let recordTimer: number | null = null

const overviewOpen = ref(false)
const overviewLoading = ref(false)
const overview = ref<AffiliateUserOverview | null>(null)
const overviewReturnToSettings = ref(false)

const settingsOpen = ref(false)
const users = ref<AffiliateAdminEntry[]>([])
const usersLoading = ref(false)
const usersTotal = ref(0)
const usersPage = ref(1)
const usersPageSize = ref(20)
const userSearch = ref('')
const selectedUsers = ref<number[]>([])
let userTimer: number | null = null

const editorOpen = ref(false)
const editorMode = ref<AffiliateEditorMode>(AffiliateEditorMode.ADD)
const editingUser = ref<AffiliateAdminEntry | null>(null)
const editorSaving = ref(false)
const userLookup = ref('')
const lookupResults = ref<SimpleUser[]>([])
const selectedLookupUser = ref<SimpleUser | null>(null)
const editorForm = reactive({ code: '', rate: '' as number | '' })
let lookupTimer: number | null = null

const batchOpen = ref(false)
const batchSaving = ref(false)
const batchRate = ref<number | ''>('')

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const userPages = computed(() => Math.max(1, Math.ceil(usersTotal.value / usersPageSize.value)))
const inviteRows = computed(() => props.kind === AffiliateRecordKind.INVITES ? records.value as AffiliateInviteRecord[] : [])
const rebateRows = computed(() => props.kind === AffiliateRecordKind.REBATES ? records.value as AffiliateRebateRecord[] : [])
const transferRows = computed(() => props.kind === AffiliateRecordKind.TRANSFERS ? records.value as AffiliateTransferRecord[] : [])
const allUsersSelected = computed(() => users.value.length > 0 && users.value.every((item) => selectedUsers.value.includes(item.user_id)))
const pageAmount = computed(() => props.kind === AffiliateRecordKind.INVITES
  ? inviteRows.value.reduce((sum, item) => sum + Number(item.total_rebate || 0), 0)
  : props.kind === AffiliateRecordKind.REBATES
    ? rebateRows.value.reduce((sum, item) => sum + Number(item.rebate_amount || 0), 0)
    : transferRows.value.reduce((sum, item) => sum + Number(item.amount || 0), 0))
const title = computed(() => props.kind === AffiliateRecordKind.INVITES ? '邀请记录' : props.kind === AffiliateRecordKind.REBATES ? '返利记录' : '转账记录')
const description = computed(() => props.kind === AffiliateRecordKind.INVITES ? '追踪邀请人与新用户的绑定关系，并下钻用户返利概览。' : props.kind === AffiliateRecordKind.REBATES ? '核对订单金额、实付、返利金额与订单状态。' : '追踪返利额度转入余额后的各项快照。')

function timezone(): string { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }
function requestParams(): ListAffiliateRecordsParams { return { page: page.value, page_size: pageSize.value, search: filters.search.trim() || undefined, start_at: filters.startAt || undefined, end_at: filters.endAt || undefined, sort_by: sort.by, sort_order: sort.order, timezone: timezone() } }

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = props.kind === AffiliateRecordKind.INVITES
      ? await affiliatesAPI.listInviteRecords(requestParams())
      : props.kind === AffiliateRecordKind.REBATES
        ? await affiliatesAPI.listRebateRecords(requestParams())
        : await affiliatesAPI.listTransferRecords(requestParams())
    records.value = response.items || []
    total.value = response.total || 0
  } catch (caught) { error.value = (caught as { message?: string }).message || `${title.value}加载失败` }
  finally { loading.value = false }
}

function applyFilters(): void { page.value = 1; void load() }
function searchLater(): void { if (recordTimer) window.clearTimeout(recordTimer); recordTimer = window.setTimeout(applyFilters, 280) }
function changeSort(by: string): void { Object.assign(sort, nextSort(sort.by, sort.order, by)); applyFilters() }

async function openOverview(userId: number): Promise<void> {
  if (!userId) return
  overview.value = null
  overviewOpen.value = true
  overviewLoading.value = true
  try { overview.value = await affiliatesAPI.getUserOverview(userId) }
  catch (caught) { overviewOpen.value = false; app.showError((caught as { message?: string }).message || '用户返利概览加载失败') }
  finally { overviewLoading.value = false }
}

async function openOverviewFromSettings(userId: number): Promise<void> {
  overviewReturnToSettings.value = true
  settingsOpen.value = false
  await openOverview(userId)
  if (!overviewOpen.value) settingsOpen.value = true
}

function closeOverview(): void {
  overviewOpen.value = false
  if (overviewReturnToSettings.value) settingsOpen.value = true
  overviewReturnToSettings.value = false
}

async function openSettings(): Promise<void> { settingsOpen.value = true; usersPage.value = 1; await loadUsers() }
async function loadUsers(): Promise<void> {
  usersLoading.value = true
  try { const response = await affiliatesAPI.listUsers({ page: usersPage.value, page_size: usersPageSize.value, search: userSearch.value.trim() }); users.value = response.items || []; usersTotal.value = response.total || 0; selectedUsers.value = selectedUsers.value.filter((id) => users.value.some((item) => item.user_id === id)) }
  catch (caught) { app.showError((caught as { message?: string }).message || '联盟用户配置加载失败') }
  finally { usersLoading.value = false }
}

function searchUsersLater(): void { if (userTimer) window.clearTimeout(userTimer); userTimer = window.setTimeout(() => { usersPage.value = 1; void loadUsers() }, 280) }
function toggleUser(id: number): void { selectedUsers.value = selectedUsers.value.includes(id) ? selectedUsers.value.filter((item) => item !== id) : [...selectedUsers.value, id] }
function toggleAllUsers(): void { selectedUsers.value = allUsersSelected.value ? [] : users.value.map((item) => item.user_id) }

function openUserEditor(entry: AffiliateAdminEntry | null): void {
  editorMode.value = entry ? AffiliateEditorMode.EDIT : AffiliateEditorMode.ADD
  editingUser.value = entry
  selectedLookupUser.value = null
  userLookup.value = ''
  lookupResults.value = []
  editorForm.code = entry?.aff_code_custom ? entry.aff_code : ''
  editorForm.rate = entry?.aff_rebate_rate_percent ?? ''
  editorOpen.value = true
}

function searchLookupLater(): void {
  if (lookupTimer) window.clearTimeout(lookupTimer)
  if (!userLookup.value.trim()) { lookupResults.value = []; return }
  lookupTimer = window.setTimeout(async () => {
    try { lookupResults.value = await affiliatesAPI.lookupUsers(userLookup.value.trim()) }
    catch (caught) { app.showError((caught as { message?: string }).message || '用户查找失败') }
  }, 280)
}

function selectLookup(user: SimpleUser): void { selectedLookupUser.value = user; userLookup.value = ''; lookupResults.value = [] }
function parseRate(value: number | ''): number | null { if (value === '') return null; const rate = Number(value); if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('返利率必须在 0–100% 之间'); return rate }

async function saveUser(): Promise<void> {
  const userId = editorMode.value === AffiliateEditorMode.ADD ? selectedLookupUser.value?.id : editingUser.value?.user_id
  if (!userId) { app.showError('请先选择用户'); return }
  editorSaving.value = true
  try {
    const rate = parseRate(editorForm.rate)
    const payload: Parameters<typeof affiliatesAPI.updateUserSettings>[1] = {}
    if (editorForm.code.trim()) payload.aff_code = editorForm.code.trim().toUpperCase()
    if (rate != null) payload.aff_rebate_rate_percent = rate
    else if (editorMode.value === AffiliateEditorMode.EDIT && editingUser.value?.aff_rebate_rate_percent != null) payload.clear_rebate_rate = true
    if (!Object.keys(payload).length) throw new Error('至少填写专属邀请码或返利率')
    await affiliatesAPI.updateUserSettings(userId, payload)
    app.showSuccess('用户专属配置已保存')
    editorOpen.value = false
    usersPage.value = 1
    await loadUsers()
  } catch (caught) { app.showError((caught as { message?: string }).message || '保存失败') }
  finally { editorSaving.value = false }
}

async function clearUser(entry: AffiliateAdminEntry): Promise<void> {
  if (!await confirm.ask({ title: '清除专属返利配置', message: `清除 ${entry.email || `用户 #${entry.user_id}`} 的专属邀请码和返利率？系统会恢复全局规则并重新生成默认邀请码。`, confirmText: '清除配置', tone: ConfirmTone.DANGER })) return
  try { await affiliatesAPI.clearUserSettings(entry.user_id); app.showSuccess('专属配置已清除'); await loadUsers() }
  catch (caught) { app.showError((caught as { message?: string }).message || '清除失败') }
}

function openBatch(): void { if (!selectedUsers.value.length) return; batchRate.value = ''; batchOpen.value = true }
async function saveBatch(): Promise<void> {
  batchSaving.value = true
  try {
    const rate = parseRate(batchRate.value)
    const response = await affiliatesAPI.batchSetRate(rate == null ? { user_ids: selectedUsers.value, clear: true } : { user_ids: selectedUsers.value, aff_rebate_rate_percent: rate })
    app.showSuccess(`已更新 ${response.affected} 个用户的返利率`)
    batchOpen.value = false
    selectedUsers.value = []
    await loadUsers()
  } catch (caught) { app.showError((caught as { message?: string }).message || '批量设置失败') }
  finally { batchSaving.value = false }
}

watch(() => props.kind, () => { page.value = 1; records.value = []; void load() })
onMounted(load)
onBeforeUnmount(() => { for (const timer of [recordTimer, userTimer, lookupTimer]) if (timer) window.clearTimeout(timer) })
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Affiliate Ledger</span><h1>{{ title }}</h1><p>{{ description }}</p></div><button class="resource-button" @click="openSettings">专属用户配置</button></header>
      <section class="resource-summary"><div><span>当前页 / 总数</span><strong>{{ records.length }} / {{ total }}</strong></div><div><span>当前页金额</span><strong>${{ pageAmount.toFixed(2) }}</strong></div><div><span>时间范围</span><strong>{{ filters.startAt || '不限' }}</strong><small>至 {{ filters.endAt || '现在' }}</small></div><div><span>排序</span><strong>{{ sort.by }}</strong><small>{{ sort.order === SortOrder.DESC ? '降序' : '升序' }}</small></div></section>
      <section class="resource-toolbar"><div class="resource-toolbar__filters"><input v-model="filters.search" type="search" placeholder="搜索用户、邀请码或订单" @input="searchLater" /><label class="commerce-affiliate-date">开始<input v-model="filters.startAt" type="date" @change="applyFilters" /></label><label class="commerce-affiliate-date">结束<input v-model="filters.endAt" type="date" @change="applyFilters" /></label></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" @click="load">刷新</button></div></section>
      <PageState :loading="loading" :error="error" :empty="!loading && !error && records.length === 0" :empty-text="`没有匹配的${title}。`" @retry="load">
        <div v-if="kind === AffiliateRecordKind.INVITES" class="resource-table"><table><thead><tr><th @click="changeSort('inviter')">邀请人 ↕</th><th @click="changeSort('invitee')">受邀人 ↕</th><th @click="changeSort('aff_code')">邀请码 ↕</th><th @click="changeSort('total_rebate')">累计返利 ↕</th><th @click="changeSort('created_at')">邀请时间 ↕</th></tr></thead><tbody><tr v-for="item in inviteRows" :key="`${item.inviter_id}-${item.invitee_id}`"><td><button class="resource-link commerce-user-link" @click="openOverview(item.inviter_id)">{{ item.inviter_email || `#${item.inviter_id}` }}</button><small>{{ item.inviter_username }} · #{{ item.inviter_id }}</small></td><td><button class="resource-link commerce-user-link" @click="openOverview(item.invitee_id)">{{ item.invitee_email || `#${item.invitee_id}` }}</button><small>{{ item.invitee_username }} · #{{ item.invitee_id }}</small></td><td><code>{{ item.aff_code }}</code></td><td><strong>${{ item.total_rebate.toFixed(2) }}</strong></td><td>{{ formatCommerceDate(item.created_at) }}</td></tr></tbody></table></div>
        <div v-else-if="kind === AffiliateRecordKind.REBATES" class="resource-table"><table><thead><tr><th @click="changeSort('order')">订单 ↕</th><th>邀请人</th><th>受邀人</th><th @click="changeSort('order_amount')">订单 / 实付 ↕</th><th>返利金额</th><th>支付 / 状态</th><th @click="changeSort('created_at')">返利时间 ↕</th></tr></thead><tbody><tr v-for="item in rebateRows" :key="item.order_id"><td><strong>#{{ item.order_id }}</strong><small>{{ item.out_trade_no }}</small></td><td><button class="resource-link commerce-user-link" @click="openOverview(item.inviter_id)">{{ item.inviter_email || `#${item.inviter_id}` }}</button><small>{{ item.inviter_username }}</small></td><td><button class="resource-link commerce-user-link" @click="openOverview(item.invitee_id)">{{ item.invitee_email || `#${item.invitee_id}` }}</button><small>{{ item.invitee_username }}</small></td><td>${{ item.order_amount.toFixed(2) }}<small>实付 ¥{{ item.pay_amount.toFixed(2) }}</small></td><td><strong>${{ item.rebate_amount.toFixed(2) }}</strong></td><td>{{ item.payment_type }}<small>{{ item.order_status }}</small></td><td>{{ formatCommerceDate(item.created_at) }}</td></tr></tbody></table></div>
        <div v-else class="resource-table"><table><thead><tr><th @click="changeSort('user')">用户 ↕</th><th @click="changeSort('amount')">转账金额 ↕</th><th>余额后</th><th>可用 / 冻结额度后</th><th>历史额度后</th><th @click="changeSort('created_at')">转账时间 ↕</th></tr></thead><tbody><tr v-for="item in transferRows" :key="item.ledger_id"><td><button class="resource-link commerce-user-link" @click="openOverview(item.user_id)">{{ item.user_email || `#${item.user_id}` }}</button><small>{{ item.username }} · #{{ item.user_id }}</small></td><td><strong>${{ item.amount.toFixed(2) }}</strong><small>流水 #{{ item.ledger_id }}</small></td><td>{{ item.snapshot_available && item.balance_after != null ? `$${item.balance_after.toFixed(2)}` : '—' }}</td><td>{{ item.snapshot_available && item.available_quota_after != null ? `$${item.available_quota_after.toFixed(2)}` : '—' }}<small>{{ item.snapshot_available && item.frozen_quota_after != null ? `$${item.frozen_quota_after.toFixed(2)}` : '—' }}</small></td><td>{{ item.snapshot_available && item.history_quota_after != null ? `$${item.history_quota_after.toFixed(2)}` : '—' }}</td><td>{{ formatCommerceDate(item.created_at) }}</td></tr></tbody></table></div>
      </PageState>
      <footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; load()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option><option :value="100">100 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; load()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; load()">下一页</button></div></footer>
    </main>

    <SurfaceDialog :show="overviewOpen" title="用户返利概览" description="从任一记录中的用户下钻，不改变当前筛选与分页。" :width="DialogWidth.STANDARD" @close="closeOverview"><div v-if="overviewLoading" class="page-state">正在加载…</div><section v-else-if="overview" class="commerce-affiliate-overview"><div class="commerce-affiliate-overview__identity"><strong>{{ overview.email || `用户 #${overview.user_id}` }}</strong><span>{{ overview.username }} · #{{ overview.user_id }}</span></div><div><span>邀请码</span><strong>{{ overview.aff_code || '—' }}</strong></div><div><span>返利率</span><strong>{{ overview.rebate_rate_percent }}%</strong></div><div><span>邀请 / 已返利人数</span><strong>{{ overview.invited_count }} / {{ overview.rebated_invitee_count }}</strong></div><div><span>可用返利</span><strong>${{ overview.available_quota.toFixed(2) }}</strong></div><div><span>历史返利</span><strong>${{ overview.history_quota.toFixed(2) }}</strong></div></section></SurfaceDialog>

    <SurfaceDialog :show="settingsOpen" title="联盟专属用户配置" description="覆盖全局邀请码或返利率；清除后恢复全局规则。" :width="DialogWidth.WIDE" @close="settingsOpen = false"><div class="resource-form-stack"><section class="resource-toolbar"><div class="resource-toolbar__filters"><input v-model="userSearch" type="search" placeholder="搜索邮箱或用户名" @input="searchUsersLater" /></div><div class="resource-toolbar__actions"><button v-if="selectedUsers.length" class="resource-button resource-button--secondary" @click="openBatch">批量返利率 {{ selectedUsers.length }}</button><button class="resource-button" @click="openUserEditor(null)">添加专属用户</button></div></section><div class="resource-table"><table><thead><tr><th class="resource-table__select"><input type="checkbox" :checked="allUsersSelected" aria-label="选择当前页用户" @change="toggleAllUsers" /></th><th>用户</th><th>邀请码</th><th>专属返利率</th><th>邀请人数</th><th>操作</th></tr></thead><tbody><tr v-if="usersLoading"><td colspan="6">加载中…</td></tr><tr v-else-if="!users.length"><td colspan="6">暂无匹配用户</td></tr><tr v-for="item in users" :key="item.user_id"><td><input type="checkbox" :checked="selectedUsers.includes(item.user_id)" :aria-label="`选择 ${item.email || `用户 ${item.user_id}`}`" @change="toggleUser(item.user_id)" /></td><td>{{ item.email || `#${item.user_id}` }}<small>{{ item.username }}</small></td><td><code>{{ item.aff_code }}</code><small>{{ item.aff_code_custom ? '专属邀请码' : '系统邀请码' }}</small></td><td>{{ item.aff_rebate_rate_percent == null ? '使用全局' : `${item.aff_rebate_rate_percent}%` }}</td><td>{{ item.aff_count }}</td><td><div class="resource-inline-actions"><button class="resource-link" @click="openUserEditor(item)">编辑</button><button class="resource-link" @click="openOverviewFromSettings(item.user_id)">概览</button><button class="resource-link resource-link--danger" @click="clearUser(item)">清除覆盖</button></div></td></tr></tbody></table></div><footer class="resource-pagination"><span>共 {{ usersTotal }} 人 · 第 {{ usersPage }} / {{ userPages }} 页</span><div class="resource-pagination__actions"><select v-model.number="usersPageSize" @change="usersPage = 1; loadUsers()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="usersPage <= 1" @click="usersPage--; loadUsers()">上一页</button><button class="resource-button resource-button--secondary" :disabled="usersPage >= userPages" @click="usersPage++; loadUsers()">下一页</button></div></footer></div></SurfaceDialog>

    <SurfaceDialog :show="editorOpen" :title="editorMode === AffiliateEditorMode.ADD ? '添加专属用户' : '编辑专属用户'" description="至少设置邀请码或返利率；返利率范围 0–100%。" :width="DialogWidth.STANDARD" @close="editorOpen = false"><form id="affiliate-user-form" class="resource-form-stack" @submit.prevent="saveUser"><div v-if="editorMode === AffiliateEditorMode.ADD" class="commerce-lookup"><label>查找用户<input v-model="userLookup" placeholder="邮箱或用户名" @input="searchLookupLater" /></label><div v-if="selectedLookupUser" class="commerce-selected-user"><strong>{{ selectedLookupUser.email }}</strong><span>{{ selectedLookupUser.username }} · #{{ selectedLookupUser.id }}</span><button type="button" @click="selectedLookupUser = null">更换</button></div><div v-else-if="lookupResults.length" class="commerce-lookup__results"><button v-for="user in lookupResults" :key="user.id" type="button" @click="selectLookup(user)">{{ user.email }} <small>{{ user.username }} · #{{ user.id }}</small></button></div></div><div v-else class="commerce-selected-user"><strong>{{ editingUser?.email }}</strong><span>{{ editingUser?.username }} · #{{ editingUser?.user_id }}</span></div><label>专属邀请码<input v-model="editorForm.code" class="commerce-uppercase" placeholder="留空表示不修改" /></label><label>专属返利率（%）<input v-model.number="editorForm.rate" type="number" min="0" max="100" step="0.01" placeholder="留空使用全局" /></label></form><template #footer><button class="button button--secondary" @click="editorOpen = false">取消</button><button type="submit" form="affiliate-user-form" class="button button--primary" :disabled="editorSaving">{{ editorSaving ? '保存中…' : '保存配置' }}</button></template></SurfaceDialog>

    <SurfaceDialog :show="batchOpen" :title="`批量设置 ${selectedUsers.length} 个用户`" description="留空返利率表示清除专属覆盖，恢复全局返利率。" :width="DialogWidth.COMPACT" @close="batchOpen = false"><label class="resource-form-stack">专属返利率（%）<input v-model.number="batchRate" type="number" min="0" max="100" step="0.01" placeholder="留空清除" /></label><template #footer><button class="button button--secondary" @click="batchOpen = false">取消</button><button class="button button--primary" :disabled="batchSaving" @click="saveBatch">{{ batchSaving ? '保存中…' : '保存批量设置' }}</button></template></SurfaceDialog>
  </ConsoleShell>
</template>

<style scoped>
.commerce-affiliate-date { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: var(--font-meta); }.commerce-affiliate-date input { width: 150px !important; }
.commerce-user-link { padding-left: 0; color: var(--text-primary); font-size: 12px; }
.commerce-affiliate-overview { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; overflow: hidden; background: var(--border-subtle); border: 1px solid var(--border-subtle); border-radius: 13px; }.commerce-affiliate-overview > div { padding: 14px; display: grid; gap: 5px; background: var(--surface-raised); }.commerce-affiliate-overview span { color: var(--text-secondary); font-size: var(--font-meta); }.commerce-affiliate-overview__identity { grid-column: 1 / -1; }
.commerce-lookup { position: relative; display: grid; gap: 10px; }.commerce-lookup__results { max-height: 190px; padding: 5px; overflow: auto; border: 1px solid var(--border-subtle); border-radius: 10px; }.commerce-lookup__results button { width: 100%; padding: 9px; display: grid; color: var(--text-primary); background: transparent; border: 0; border-radius: 7px; text-align: left; cursor: pointer; }.commerce-lookup__results button:hover { background: var(--surface-canvas); }.commerce-lookup__results small { color: var(--text-secondary); }
.commerce-selected-user { padding: 13px; display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }.commerce-selected-user span { color: var(--text-secondary); font-size: var(--font-body-sm); }.commerce-selected-user button { grid-column: 2; grid-row: 1 / 3; color: var(--accent); background: transparent; border: 0; cursor: pointer; }.commerce-uppercase { text-transform: uppercase; }
</style>
