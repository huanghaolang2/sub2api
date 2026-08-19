<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as subscriptionsAPI from '@shared-api/admin/subscriptions'
import * as groupsAPI from '@shared-api/admin/groups'
import * as usageAPI from '@shared-api/admin/usage'
import type { SimpleUser } from '@shared-api/admin/usage'
import type { AdminGroup, SubscriptionProgress, UserSubscription } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import {
  SortOrder,
  SubscriptionStatus,
  formatCommerceDate,
  nextSort,
  splitNumericIds,
  subscriptionStatusLabels
} from '@/features/admin/commerce/model'

enum AssignmentMode { SINGLE = 'single', BATCH = 'batch' }
enum UserColumnMode { EMAIL = 'email', USERNAME = 'username' }

const app = useAppStore()
const confirm = useConfirmStore()
const rows = ref<UserSubscription[]>([])
const groups = ref<AdminGroup[]>([])
const loading = ref(true)
const error = ref('')
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filters = reactive({ userKeyword: '', userId: null as number | null, status: SubscriptionStatus.ACTIVE as string, groupId: '', platform: '' })
const sort = reactive({ by: 'created_at', order: SortOrder.DESC })
const filterUserResults = ref<SimpleUser[]>([])
const filterUserLoading = ref(false)
const selectedFilterUser = ref<SimpleUser | null>(null)
const showFilterUsers = ref(false)
const columnsOpen = ref(false)
const guideOpen = ref(false)
const visibleColumns = reactive({ group: true, usage: true, expires: true, status: true })
const userColumnMode = ref<UserColumnMode>(UserColumnMode.EMAIL)

const assignOpen = ref(false)
const assignMode = ref<AssignmentMode>(AssignmentMode.SINGLE)
const assignForm = reactive({ userId: null as number | null, userIds: '', groupId: '', validityDays: 30, keyword: '' })
const assignResults = ref<SimpleUser[]>([])
const assignSearching = ref(false)
const selectedAssignUser = ref<SimpleUser | null>(null)
const submitting = ref(false)

const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<UserSubscription | null>(null)
const progress = ref<SubscriptionProgress | null>(null)
const extendOpen = ref(false)
const extending = ref<UserSubscription | null>(null)
const extendDays = ref(30)
const resetOpen = ref(false)
const resetting = ref<UserSubscription | null>(null)
const resetWindows = reactive({ daily: true, weekly: true, monthly: true })

let controller: AbortController | null = null
let filterTimer: number | null = null
let assignTimer: number | null = null

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const activeCount = computed(() => rows.value.filter((item) => item.status === SubscriptionStatus.ACTIVE).length)
const expiringCount = computed(() => rows.value.filter((item) => item.expires_at && new Date(item.expires_at).getTime() < Date.now() + 7 * 86400000 && new Date(item.expires_at).getTime() > Date.now()).length)
const usedThisMonth = computed(() => rows.value.reduce((sum, item) => sum + Number(item.monthly_usage_usd || 0), 0))
const subscriptionGroups = computed(() => groups.value.filter((item) => item.subscription_type === 'subscription' && item.status === 'active'))

function saveColumnPreferences(): void {
  localStorage.setItem('frontend2.subscription-columns', JSON.stringify({ ...visibleColumns, userColumnMode: userColumnMode.value }))
}

function loadColumnPreferences(): void {
  try {
    const parsed = JSON.parse(localStorage.getItem('frontend2.subscription-columns') || '{}') as Partial<typeof visibleColumns> & { userColumnMode?: UserColumnMode }
    for (const key of Object.keys(visibleColumns) as Array<keyof typeof visibleColumns>) {
      if (typeof parsed[key] === 'boolean') visibleColumns[key] = parsed[key] as boolean
    }
    if (Object.values(UserColumnMode).includes(parsed.userColumnMode as UserColumnMode)) userColumnMode.value = parsed.userColumnMode!
  } catch { /* keep accessible defaults */ }
}

function userLabel(row: UserSubscription): string {
  if (userColumnMode.value === UserColumnMode.USERNAME) return row.user?.username || `用户 #${row.user_id}`
  return row.user?.email || `用户 #${row.user_id}`
}

function requestFilters() {
  return {
    status: (filters.status || undefined) as SubscriptionStatus | undefined,
    user_id: filters.userId || undefined,
    group_id: filters.groupId ? Number(filters.groupId) : undefined,
    platform: filters.platform || undefined,
    sort_by: sort.by,
    sort_order: sort.order
  }
}

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  const current = controller
  loading.value = true
  error.value = ''
  try {
    const response = await subscriptionsAPI.list(page.value, pageSize.value, requestFilters(), { signal: current.signal })
    rows.value = response.items || []
    total.value = response.total || 0
  } catch (caught) {
    if ((caught as { code?: string }).code !== 'ERR_CANCELED') error.value = (caught as { message?: string }).message || '订阅加载失败'
  } finally {
    if (controller === current) loading.value = false
  }
}

async function loadGroups(): Promise<void> {
  try { groups.value = await groupsAPI.getAllIncludingInactive() }
  catch { app.showError('订阅分组加载失败') }
}

function applyFilters(): void { page.value = 1; void load() }

function changeSort(by: string): void {
  Object.assign(sort, nextSort(sort.by, sort.order, by))
  applyFilters()
}

function scheduleFilterUserSearch(): void {
  if (filterTimer) window.clearTimeout(filterTimer)
  if (selectedFilterUser.value && filters.userKeyword !== selectedFilterUser.value.email) {
    selectedFilterUser.value = null
    filters.userId = null
    applyFilters()
  }
  if (!filters.userKeyword.trim()) { filterUserResults.value = []; showFilterUsers.value = false; return }
  filterTimer = window.setTimeout(async () => {
    filterUserLoading.value = true
    try { filterUserResults.value = await usageAPI.searchUsers(filters.userKeyword.trim()); showFilterUsers.value = true }
    catch { filterUserResults.value = [] }
    finally { filterUserLoading.value = false }
  }, 280)
}

function selectFilterUser(user: SimpleUser): void {
  selectedFilterUser.value = user
  filters.userKeyword = user.email
  filters.userId = user.id
  showFilterUsers.value = false
  applyFilters()
}

function clearFilterUser(): void {
  selectedFilterUser.value = null
  filters.userKeyword = ''
  filters.userId = null
  filterUserResults.value = []
  showFilterUsers.value = false
  applyFilters()
}

function openAssign(): void {
  Object.assign(assignForm, { userId: null, userIds: '', groupId: '', validityDays: 30, keyword: '' })
  assignMode.value = AssignmentMode.SINGLE
  assignResults.value = []
  selectedAssignUser.value = null
  assignOpen.value = true
}

function scheduleAssignSearch(): void {
  if (assignTimer) window.clearTimeout(assignTimer)
  if (selectedAssignUser.value && assignForm.keyword !== selectedAssignUser.value.email) {
    selectedAssignUser.value = null
    assignForm.userId = null
  }
  if (!assignForm.keyword.trim()) { assignResults.value = []; return }
  assignTimer = window.setTimeout(async () => {
    assignSearching.value = true
    try { assignResults.value = await usageAPI.searchUsers(assignForm.keyword.trim()) }
    catch { assignResults.value = [] }
    finally { assignSearching.value = false }
  }, 280)
}

function selectAssignUser(user: SimpleUser): void {
  selectedAssignUser.value = user
  assignForm.userId = user.id
  assignForm.keyword = user.email
  assignResults.value = []
}

async function submitAssignment(): Promise<void> {
  if (!assignForm.groupId) { app.showError('请选择订阅分组'); return }
  if (!Number.isInteger(assignForm.validityDays) || assignForm.validityDays < 1) { app.showError('有效期至少为 1 天'); return }
  submitting.value = true
  try {
    if (assignMode.value === AssignmentMode.SINGLE) {
      if (!assignForm.userId) throw new Error('请选择用户')
      await subscriptionsAPI.assign({ user_id: assignForm.userId, group_id: Number(assignForm.groupId), validity_days: assignForm.validityDays })
      app.showSuccess('订阅已发放')
    } else {
      const userIds = splitNumericIds(assignForm.userIds)
      if (!userIds.length) throw new Error('请填写至少一个用户 ID')
      await subscriptionsAPI.bulkAssign({ user_ids: userIds, group_id: Number(assignForm.groupId), validity_days: assignForm.validityDays })
      app.showSuccess(`已向 ${userIds.length} 个用户发放订阅`)
    }
    assignOpen.value = false
    await load()
  } catch (caught) { app.showError((caught as { message?: string }).message || '订阅发放失败') }
  finally { submitting.value = false }
}

async function openDetail(row: UserSubscription): Promise<void> {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = row
  progress.value = null
  try {
    const [record, usage] = await Promise.all([subscriptionsAPI.getById(row.id), subscriptionsAPI.getProgress(row.id)])
    detail.value = record
    progress.value = usage
  } catch (caught) { app.showError((caught as { message?: string }).message || '订阅详情加载失败') }
  finally { detailLoading.value = false }
}

function openExtend(row: UserSubscription): void { extending.value = row; extendDays.value = 30; extendOpen.value = true }

async function submitExtend(): Promise<void> {
  if (!extending.value || !Number.isInteger(extendDays.value) || extendDays.value === 0) { app.showError('调整天数必须是非零整数'); return }
  if (extending.value.expires_at && new Date(extending.value.expires_at).getTime() + extendDays.value * 86400000 <= Date.now()) { app.showError('调整后的过期时间必须晚于当前时间'); return }
  submitting.value = true
  try { await subscriptionsAPI.extend(extending.value.id, { days: extendDays.value }); app.showSuccess('订阅有效期已调整'); extendOpen.value = false; await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '有效期调整失败') }
  finally { submitting.value = false }
}

async function revoke(row: UserSubscription): Promise<void> {
  if (!await confirm.ask({ title: '撤销订阅', message: `撤销 ${userLabel(row)} 的“${row.group?.name || `分组 #${row.group_id}`}”订阅？已有用量记录会保留。`, confirmText: '撤销', tone: ConfirmTone.DANGER })) return
  try { await subscriptionsAPI.revoke(row.id); app.showSuccess('订阅已撤销'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '撤销失败') }
}

async function restore(row: UserSubscription): Promise<void> {
  if (!await confirm.ask({ title: '恢复订阅', message: `恢复 ${userLabel(row)} 的订阅，并沿用原有效期与用量窗口。`, confirmText: '恢复' })) return
  try { await subscriptionsAPI.restore(row.id); app.showSuccess('订阅已恢复'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '恢复失败') }
}

function openReset(row: UserSubscription): void {
  resetting.value = row
  Object.assign(resetWindows, { daily: true, weekly: true, monthly: true })
  resetOpen.value = true
}

async function submitReset(): Promise<void> {
  if (!resetting.value || !Object.values(resetWindows).some(Boolean)) { app.showError('至少选择一个额度窗口'); return }
  submitting.value = true
  try { await subscriptionsAPI.resetQuota(resetting.value.id, { ...resetWindows }); app.showSuccess('所选额度窗口已重置'); resetOpen.value = false; await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '额度重置失败') }
  finally { submitting.value = false }
}

function usagePercent(used: number, limit: number | null | undefined): number { return limit ? Math.min(100, Math.max(0, used / limit * 100)) : 0 }
function groupFor(row: UserSubscription): AdminGroup | undefined { return row.group as AdminGroup | undefined || groups.value.find((item) => item.id === row.group_id) }
function statusLabel(status: string): string { return subscriptionStatusLabels[status as SubscriptionStatus] || status }

watch([visibleColumns, userColumnMode], saveColumnPreferences, { deep: true })
onMounted(() => { loadColumnPreferences(); void Promise.all([load(), loadGroups()]) })
onBeforeUnmount(() => { controller?.abort(); if (filterTimer) window.clearTimeout(filterTimer); if (assignTimer) window.clearTimeout(assignTimer) })
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading">
        <div><span class="resource-eyebrow">Entitlements</span><h1>用户订阅</h1><p>从用户、分组、平台和状态定位权益；发放、调整、撤销与额度窗口操作均保留完整状态反馈。</p></div>
        <button class="resource-button" @click="openAssign">发放订阅</button>
      </header>

      <section class="resource-summary">
        <div><span>当前页 / 总数</span><strong>{{ rows.length }} / {{ total }}</strong></div>
        <div><span>当前页生效</span><strong>{{ activeCount }}</strong></div>
        <div><span>7 天内到期</span><strong>{{ expiringCount }}</strong></div>
        <div><span>当前页月用量</span><strong>${{ usedThisMonth.toFixed(2) }}</strong></div>
      </section>

      <section class="resource-toolbar">
        <div class="resource-toolbar__filters">
          <div class="commerce-search-picker">
            <input v-model="filters.userKeyword" type="search" placeholder="搜索并选择用户邮箱" @focus="showFilterUsers = true" @input="scheduleFilterUserSearch" />
            <button v-if="selectedFilterUser" type="button" aria-label="清除用户筛选" @click="clearFilterUser">×</button>
            <div v-if="showFilterUsers && (filterUserLoading || filterUserResults.length)" class="commerce-search-picker__results">
              <span v-if="filterUserLoading">搜索中…</span>
              <button v-for="user in filterUserResults" :key="user.id" type="button" @click="selectFilterUser(user)">{{ user.email }} <small>#{{ user.id }}</small></button>
            </div>
          </div>
          <select v-model="filters.status" @change="applyFilters"><option value="">全部状态</option><option v-for="item in SubscriptionStatus" :key="item" :value="item">{{ statusLabel(item) }}</option></select>
          <select v-model="filters.groupId" @change="applyFilters"><option value="">全部分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select>
          <select v-model="filters.platform" @change="applyFilters"><option value="">全部平台</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="antigravity">Antigravity</option><option value="grok">Grok</option></select>
        </div>
        <div class="resource-toolbar__actions">
          <button class="resource-button resource-button--secondary" @click="load">刷新</button>
          <button class="resource-button resource-button--secondary" @click="columnsOpen = true">列设置</button>
          <button class="resource-button resource-button--secondary" @click="guideOpen = true">使用说明</button>
        </div>
      </section>

      <PageState :loading="loading" :error="error" :empty="!loading && !error && rows.length === 0" empty-text="没有匹配的订阅。" @retry="load">
        <div class="resource-table"><table><thead><tr><th>用户</th><th v-if="visibleColumns.group">订阅分组</th><th v-if="visibleColumns.usage">额度用量</th><th v-if="visibleColumns.expires" @click="changeSort('expires_at')">有效期 ↕</th><th v-if="visibleColumns.status" @click="changeSort('status')">状态 ↕</th><th>操作</th></tr></thead><tbody>
          <tr v-for="row in rows" :key="row.id">
            <td><button class="resource-link commerce-primary-link" @click="openDetail(row)">{{ userLabel(row) }}</button><small>#{{ row.user_id }} · 订阅 #{{ row.id }}</small></td>
            <td v-if="visibleColumns.group"><strong>{{ row.group?.name || `分组 #${row.group_id}` }}</strong><small>{{ row.group?.platform || groupFor(row)?.platform || '—' }}</small></td>
            <td v-if="visibleColumns.usage" class="commerce-usage-cell">
              <div v-for="window in [{ key: '日', used: row.daily_usage_usd, limit: groupFor(row)?.daily_limit_usd }, { key: '周', used: row.weekly_usage_usd, limit: groupFor(row)?.weekly_limit_usd }, { key: '月', used: row.monthly_usage_usd, limit: groupFor(row)?.monthly_limit_usd }]" :key="window.key" class="commerce-usage-row">
                <span>{{ window.key }}</span><i><b :style="{ width: `${usagePercent(window.used, window.limit)}%` }"></b></i><small>${{ Number(window.used || 0).toFixed(2) }} / {{ window.limit == null ? '∞' : `$${Number(window.limit).toFixed(2)}` }}</small>
              </div>
            </td>
            <td v-if="visibleColumns.expires">{{ formatCommerceDate(row.expires_at) }}<small>{{ row.expires_at ? `${Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 86400000)} 天` : '永久有效' }}</small></td>
            <td v-if="visibleColumns.status"><span :class="['resource-status', row.status === SubscriptionStatus.ACTIVE ? 'resource-status--active' : row.status === SubscriptionStatus.EXPIRED ? 'resource-status--expired' : 'resource-status--degraded']">{{ statusLabel(row.status) }}</span></td>
            <td><div class="resource-inline-actions"><button class="resource-link" @click="openDetail(row)">详情</button><button v-if="row.status === SubscriptionStatus.ACTIVE || row.status === SubscriptionStatus.EXPIRED" class="resource-link" @click="openExtend(row)">调整</button><button v-if="row.status === SubscriptionStatus.ACTIVE" class="resource-link" @click="openReset(row)">重置额度</button><button v-if="row.status === SubscriptionStatus.ACTIVE" class="resource-link resource-link--danger" @click="revoke(row)">撤销</button><button v-if="row.status === SubscriptionStatus.REVOKED" class="resource-link" @click="restore(row)">恢复</button></div></td>
          </tr>
        </tbody></table></div>
      </PageState>

      <footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; load()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option><option :value="100">100 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; load()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; load()">下一页</button></div></footer>
    </main>

    <SurfaceDialog :show="assignOpen" title="发放用户订阅" description="单用户支持邮箱查找；批量模式按用户 ID 一次发放，沿用现有批量接口。" :width="DialogWidth.WIDE" @close="assignOpen = false">
      <form id="subscription-assign-form" class="resource-form-stack" @submit.prevent="submitAssignment">
        <div class="resource-tabs"><button v-for="mode in AssignmentMode" :key="mode" type="button" :aria-selected="assignMode === mode" @click="assignMode = mode">{{ mode === AssignmentMode.SINGLE ? '单个用户' : '批量用户' }}</button></div>
        <div v-if="assignMode === AssignmentMode.SINGLE" class="commerce-search-picker"><label>用户邮箱 *</label><input v-model="assignForm.keyword" autocomplete="off" placeholder="输入邮箱关键词" @input="scheduleAssignSearch" /><div v-if="assignSearching || assignResults.length" class="commerce-search-picker__results commerce-search-picker__results--flow"><span v-if="assignSearching">搜索中…</span><button v-for="user in assignResults" :key="user.id" type="button" @click="selectAssignUser(user)">{{ user.email }} <small>#{{ user.id }}</small></button></div></div>
        <label v-else>用户 ID（逗号、空格或换行分隔）*<textarea v-model="assignForm.userIds" rows="6" placeholder="2, 18, 42" /></label>
        <div class="resource-form-grid"><label>订阅分组 *<select v-model="assignForm.groupId"><option value="">请选择</option><option v-for="group in subscriptionGroups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.platform }}</option></select></label><label>有效期（天）*<input v-model.number="assignForm.validityDays" type="number" min="1" step="1" /></label></div>
      </form>
      <template #footer><button class="button button--secondary" @click="assignOpen = false">取消</button><button type="submit" form="subscription-assign-form" class="button button--primary" :disabled="submitting">{{ submitting ? '发放中…' : '确认发放' }}</button></template>
    </SurfaceDialog>

    <SurfaceDialog :show="detailOpen" :title="`订阅详情 · #${detail?.id || ''}`" description="详情与进度分别读取现有订阅接口；用量窗口不会由前端推断。" :width="DialogWidth.WIDE" @close="detailOpen = false">
      <div v-if="detailLoading" class="page-state">正在加载详情…</div><div v-else-if="detail" class="resource-form-stack">
        <section class="commerce-detail-grid"><div><span>用户</span><strong>{{ userLabel(detail) }}</strong><small>#{{ detail.user_id }}</small></div><div><span>订阅分组</span><strong>{{ detail.group?.name || `#${detail.group_id}` }}</strong><small>{{ detail.group?.platform || '—' }}</small></div><div><span>状态</span><strong>{{ statusLabel(detail.status) }}</strong></div><div><span>开始 / 到期</span><strong>{{ formatCommerceDate(detail.starts_at) }}</strong><small>{{ formatCommerceDate(detail.expires_at) }}</small></div></section>
        <section v-if="progress" class="commerce-progress-list"><article v-for="item in [{ label: '日额度', data: progress.daily }, { label: '周额度', data: progress.weekly }, { label: '月额度', data: progress.monthly }]" :key="item.label"><div><strong>{{ item.label }}</strong><span v-if="item.data">${{ item.data.used.toFixed(2) }} / {{ item.data.limit == null ? '∞' : `$${item.data.limit.toFixed(2)}` }}</span><span v-else>未配置</span></div><i><b :style="{ width: `${Math.min(100, item.data?.percentage || 0)}%` }"></b></i><small v-if="item.data?.reset_in_seconds != null">约 {{ Math.ceil(item.data.reset_in_seconds / 3600) }} 小时后重置</small></article></section>
      </div>
    </SurfaceDialog>

    <SurfaceDialog :show="extendOpen" title="调整订阅有效期" description="可填写正数延期或负数缩短；调整结果必须仍晚于当前时间。" :width="DialogWidth.COMPACT" @close="extendOpen = false"><form id="subscription-extend-form" class="resource-form-stack" @submit.prevent="submitExtend"><p>{{ extending ? userLabel(extending) : '' }} · 当前到期 {{ formatCommerceDate(extending?.expires_at) }}</p><label>调整天数<input v-model.number="extendDays" type="number" step="1" /></label></form><template #footer><button class="button button--secondary" @click="extendOpen = false">取消</button><button type="submit" form="subscription-extend-form" class="button button--primary" :disabled="submitting">保存调整</button></template></SurfaceDialog>

    <SurfaceDialog :show="resetOpen" title="重置额度窗口" description="只重置选中的窗口；用量审计记录不删除。" :width="DialogWidth.COMPACT" @close="resetOpen = false"><div class="resource-form-stack"><label class="resource-check"><input v-model="resetWindows.daily" type="checkbox" /><span>日额度</span></label><label class="resource-check"><input v-model="resetWindows.weekly" type="checkbox" /><span>周额度</span></label><label class="resource-check"><input v-model="resetWindows.monthly" type="checkbox" /><span>月额度</span></label></div><template #footer><button class="button button--secondary" @click="resetOpen = false">取消</button><button class="button button--primary" :disabled="submitting" @click="submitReset">确认重置</button></template></SurfaceDialog>

    <SurfaceDialog :show="columnsOpen" title="订阅列表列设置" description="用户列始终可见；选择会保存在当前浏览器。" :width="DialogWidth.COMPACT" @close="columnsOpen = false"><div class="resource-form-stack"><label>用户主标识<select v-model="userColumnMode"><option :value="UserColumnMode.EMAIL">邮箱</option><option :value="UserColumnMode.USERNAME">用户名</option></select></label><label v-for="(label, key) in { group: '订阅分组', usage: '额度用量', expires: '有效期', status: '状态' }" :key="key" class="resource-check"><input v-model="visibleColumns[key as keyof typeof visibleColumns]" type="checkbox" /><span>{{ label }}</span></label></div></SurfaceDialog>

    <SurfaceDialog :show="guideOpen" title="订阅操作说明" description="主任务均可在列表两步内完成。" :width="DialogWidth.STANDARD" @close="guideOpen = false"><ol class="commerce-guide"><li><strong>发放</strong><span>选择单用户或填写多个用户 ID，再选择订阅分组与有效期。</span></li><li><strong>调整与撤销</strong><span>调整保留原用量；撤销保留记录，可从列表恢复。</span></li><li><strong>额度重置</strong><span>按日、周、月窗口独立重置，不会删除用量审计。</span></li></ol></SurfaceDialog>
  </ConsoleShell>
</template>

<style scoped>
.commerce-primary-link { padding-left: 0; color: var(--text-primary); font-size: 13px; }
.commerce-usage-cell { min-width: 260px; }
.commerce-usage-row { display: grid; grid-template-columns: 18px minmax(70px, 1fr) 120px; align-items: center; gap: 8px; margin: 5px 0; }
.commerce-usage-row > i, .commerce-progress-list i { height: 5px; overflow: hidden; background: var(--surface-canvas); border-radius: 999px; }
.commerce-usage-row b, .commerce-progress-list b { height: 100%; display: block; background: var(--accent); border-radius: inherit; }
.commerce-usage-row small { margin: 0; text-align: right; }
.commerce-search-picker { position: relative; min-width: min(280px, 70vw); display: grid; gap: 6px; }
.commerce-search-picker > button[aria-label] { position: absolute; top: 7px; right: 8px; width: 26px; height: 26px; color: var(--text-secondary); background: transparent; border: 0; cursor: pointer; }
.commerce-search-picker__results { position: absolute; z-index: 10; top: calc(100% + 5px); left: 0; right: 0; max-height: 220px; padding: 5px; overflow: auto; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; box-shadow: 0 16px 36px rgba(0,0,0,.14); }
.commerce-search-picker__results--flow { position: static; }
.commerce-search-picker__results > span, .commerce-search-picker__results > button { width: 100%; padding: 9px; display: block; color: var(--text-secondary); background: transparent; border: 0; border-radius: 7px; text-align: left; }
.commerce-search-picker__results > button { color: var(--text-primary); cursor: pointer; }
.commerce-search-picker__results > button:hover { background: var(--surface-canvas); }
.commerce-detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; overflow: hidden; background: var(--border-subtle); border: 1px solid var(--border-subtle); border-radius: 14px; }
.commerce-detail-grid > div { padding: 15px; display: grid; gap: 6px; background: var(--surface-raised); }
.commerce-detail-grid span, .commerce-detail-grid small { color: var(--text-secondary); font-size: var(--font-body-sm); }
.commerce-progress-list { display: grid; gap: 12px; }
.commerce-progress-list article { padding: 14px; display: grid; gap: 8px; border: 1px solid var(--border-subtle); border-radius: 12px; }
.commerce-progress-list article > div { display: flex; justify-content: space-between; gap: 12px; }
.commerce-progress-list small { color: var(--text-secondary); }
.commerce-guide { margin: 0; padding-left: 24px; display: grid; gap: 18px; }
.commerce-guide li { padding-left: 6px; }
.commerce-guide strong, .commerce-guide span { display: block; }
.commerce-guide span { margin-top: 5px; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
@media (max-width: 800px) { .commerce-detail-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
