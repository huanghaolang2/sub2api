<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as dashboardAPI from '@shared-api/admin/dashboard'
import type { BatchUserUsageStats } from '@shared-api/admin/dashboard'
import * as groupsAPI from '@shared-api/admin/groups'
import * as userAttributesAPI from '@shared-api/admin/userAttributes'
import * as usersAPI from '@shared-api/admin/users'
import type { PlatformQuotaItem } from '@shared-api/admin/users'
import type { AdminGroup, AdminUser, UserAttributeDefinition } from '@/types'
import AttributeDefinitionsDialog from '@/components/admin/users/AttributeDefinitionsDialog.vue'
import BulkLimitsDialog from '@/components/admin/users/BulkLimitsDialog.vue'
import UserCreateDialog from '@/components/admin/users/UserCreateDialog.vue'
import UserDetailDrawer from '@/components/admin/users/UserDetailDrawer.vue'
import PageState from '@/components/base/PageState.vue'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import {
  AdminUserRole,
  AdminUserStatus,
  ALL_USER_COLUMNS,
  formatAttributeValue,
  formatDateTime,
  formatMoney,
  PlatformQuotaPlatform,
  SERVER_SORTABLE_COLUMNS,
  SortOrder,
  sortUsersByUsage,
  UsagePeriod,
  UserAttributeTypeCode,
  UserColumnKey,
  type UserListFilterState,
  type UserListSortState,
  UserPanelTab
} from '@/features/admin/users/model'
import { useAppStore } from '@/stores/app'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'

interface DisplayColumn {
  key: string
  label: string
  defaultVisible: boolean
}

interface UsageSortState {
  key: UserColumnKey
  platform: PlatformQuotaPlatform | null
  period: UsagePeriod
  order: SortOrder
}

const EMAIL_COLUMN = 'email'
const ACTIONS_COLUMN = 'actions'
const ATTRIBUTE_COLUMN_PREFIX = 'attr_'
const FILTER_STORAGE_KEY = 'frontend2:admin-users:filters'
const VISIBLE_FILTER_STORAGE_KEY = 'frontend2:admin-users:visible-filters'
const VISIBLE_COLUMN_STORAGE_KEY = 'frontend2:admin-users:visible-columns'
const SORT_STORAGE_KEY = 'frontend2:admin-users:sort'
const FORCED_VISIBLE_COLUMNS = new Set([UserColumnKey.LAST_ACTIVE_AT])
const PAGE_SIZES = [20, 50, 100]

const app = useAppStore()
const confirmDialog = useConfirmStore()
const users = ref<AdminUser[]>([])
const total = ref(0)
const pages = ref(1)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const secondaryLoading = ref(false)
const error = ref('')
const groups = ref<AdminGroup[]>([])
const apiKeyFilterGroups = ref<AdminGroup[]>([])
const attributeDefinitions = ref<UserAttributeDefinition[]>([])
const usageStats = ref<Record<string, BatchUserUsageStats>>({})
const attributeValues = ref<Record<number, Record<number, string>>>({})
const platformQuotaStats = ref<Record<number, PlatformQuotaItem[]>>({})
const selectedIds = ref<number[]>([])
const showCreate = ref(false)
const showBulk = ref(false)
const showAttributes = ref(false)
const showDrawer = ref(false)
const selectedUser = ref<AdminUser | null>(null)
const drawerTab = ref<UserPanelTab>(UserPanelTab.PROFILE)
const filterSettingsOpen = ref(false)
const columnSettingsOpen = ref(false)
const usageSortMenu = ref<UserColumnKey | null>(null)
const usageSort = ref<UsageSortState | null>(null)
const statusUpdatingIds = ref(new Set<number>())
let requestController: AbortController | null = null
let searchTimer: number | null = null
let secondarySequence = 0

const filters = reactive<UserListFilterState>({
  search: '',
  role: '',
  status: '',
  groupName: '',
  apiKeyGroupId: null,
  attributes: {}
})
const visibleFilters = ref(new Set<string>(['role', 'status', 'group']))
const sort = reactive<UserListSortState>({ key: UserColumnKey.CREATED_AT, order: SortOrder.DESC })
const defaultVisibleColumnKeys = ALL_USER_COLUMNS.filter((column) => column.defaultVisible).map((column) => column.key)
const visibleColumnKeys = ref(new Set<string>(defaultVisibleColumnKeys))

const filterDefinitions = computed(() => [
  { key: 'role', label: '角色' },
  { key: 'status', label: '状态' },
  { key: 'group', label: '授权分组（模糊）' },
  { key: 'apiKeyGroup', label: 'API Key 分组' },
  ...attributeDefinitions.value.filter((definition) => definition.enabled).map((definition) => ({
    key: `${ATTRIBUTE_COLUMN_PREFIX}${definition.id}`,
    label: definition.name
  }))
])

const allDisplayColumns = computed<DisplayColumn[]>(() => {
  const base: DisplayColumn[] = ALL_USER_COLUMNS.map((column) => ({ ...column }))
  const notesIndex = base.findIndex((column) => column.key === UserColumnKey.NOTES)
  const dynamic = attributeDefinitions.value.filter((definition) => definition.enabled).map((definition) => ({
    key: `${ATTRIBUTE_COLUMN_PREFIX}${definition.id}`,
    label: definition.name,
    defaultVisible: false
  }))
  base.splice(notesIndex + 1, 0, ...dynamic)
  return base
})

const visibleColumns = computed<DisplayColumn[]>(() => [
  { key: EMAIL_COLUMN, label: '用户', defaultVisible: true },
  ...allDisplayColumns.value.filter((column) => visibleColumnKeys.value.has(column.key)),
  { key: ACTIONS_COLUMN, label: '操作', defaultVisible: true }
])

const selectedCount = computed(() => selectedIds.value.length)
const currentPageSelected = computed(() => users.value.length > 0 && users.value.every((user) => selectedIds.value.includes(user.id)))
const pageDisabledCount = computed(() => users.value.filter((user) => user.status === AdminUserStatus.DISABLED).length)
const pageBalance = computed(() => users.value.reduce((sum, user) => sum + user.balance, 0))
const activeFilterCount = computed(() => [
  filters.role,
  filters.status,
  filters.groupName.trim(),
  filters.apiKeyGroupId,
  ...Object.values(filters.attributes).filter((value) => value.trim())
].filter((value) => value !== '' && value !== null).length)
const needsUsageData = computed(() => Array.from(visibleColumnKeys.value).some((key) => key === UserColumnKey.USAGE || key.startsWith('usage_')))
const needsAttributeData = computed(() => attributeDefinitions.value.some((definition) => visibleColumnKeys.value.has(`${ATTRIBUTE_COLUMN_PREFIX}${definition.id}`)))
const needsQuotaData = computed(() => visibleColumnKeys.value.has(UserColumnKey.PLATFORM_QUOTA))

const sortedUsers = computed(() => {
  if (!usageSort.value) return users.value
  return sortUsersByUsage(
    users.value,
    usageStats.value,
    usageSort.value.platform,
    usageSort.value.period,
    usageSort.value.order
  )
})

function safeParse<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function restorePreferences(): void {
  const savedFilters = safeParse<Partial<UserListFilterState>>(FILTER_STORAGE_KEY)
  if (savedFilters) {
    filters.search = typeof savedFilters.search === 'string' ? savedFilters.search : ''
    filters.role = savedFilters.role === AdminUserRole.ADMIN || savedFilters.role === AdminUserRole.USER ? savedFilters.role : ''
    filters.status = savedFilters.status === AdminUserStatus.ACTIVE || savedFilters.status === AdminUserStatus.DISABLED ? savedFilters.status : ''
    filters.groupName = typeof savedFilters.groupName === 'string' ? savedFilters.groupName : ''
    filters.apiKeyGroupId = typeof savedFilters.apiKeyGroupId === 'number' ? savedFilters.apiKeyGroupId : null
    filters.attributes = savedFilters.attributes && typeof savedFilters.attributes === 'object'
      ? Object.fromEntries(Object.entries(savedFilters.attributes).filter(([, value]) => typeof value === 'string'))
      : {}
  }
  const savedVisibleFilters = safeParse<string[]>(VISIBLE_FILTER_STORAGE_KEY)
  if (Array.isArray(savedVisibleFilters)) visibleFilters.value = new Set(savedVisibleFilters)
  const savedColumns = safeParse<string[]>(VISIBLE_COLUMN_STORAGE_KEY)
  if (Array.isArray(savedColumns)) visibleColumnKeys.value = new Set([...savedColumns, ...FORCED_VISIBLE_COLUMNS])
  const savedSort = safeParse<Partial<UserListSortState>>(SORT_STORAGE_KEY)
  if (savedSort && typeof savedSort.key === 'string' && SERVER_SORTABLE_COLUMNS.has(savedSort.key)) {
    sort.key = savedSort.key
    sort.order = savedSort.order === SortOrder.ASC ? SortOrder.ASC : SortOrder.DESC
  }
}

function persistFilters(): void {
  safeSet(FILTER_STORAGE_KEY, { ...filters, attributes: { ...filters.attributes } })
  safeSet(VISIBLE_FILTER_STORAGE_KEY, Array.from(visibleFilters.value))
}

function persistColumns(): void {
  safeSet(VISIBLE_COLUMN_STORAGE_KEY, Array.from(visibleColumnKeys.value))
}

function persistSort(): void {
  safeSet(SORT_STORAGE_KEY, sort)
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Browser storage can be unavailable in privacy-restricted contexts; keep the current session usable.
  }
}

async function loadReferenceData(): Promise<void> {
  const results = await Promise.allSettled([
    groupsAPI.getAll(),
    groupsAPI.getAllIncludingInactive(),
    userAttributesAPI.listEnabledDefinitions()
  ])
  if (results[0].status === 'fulfilled') groups.value = results[0].value
  else app.showError('授权分组加载失败')
  if (results[1].status === 'fulfilled') apiKeyFilterGroups.value = results[1].value
  else app.showError('API Key 分组筛选项加载失败')
  if (results[2].status === 'fulfilled') attributeDefinitions.value = results[2].value
  else app.showError('自定义属性定义加载失败')
}

async function loadSecondaryData(userIds: number[]): Promise<void> {
  const sequence = ++secondarySequence
  if (userIds.length === 0 || (!needsUsageData.value && !needsAttributeData.value && !needsQuotaData.value)) {
    secondaryLoading.value = false
    return
  }
  secondaryLoading.value = true
  const tasks: Promise<void>[] = []
  if (needsUsageData.value) {
    tasks.push(dashboardAPI.getBatchUsersUsage(userIds).then((response) => {
      if (sequence === secondarySequence) usageStats.value = response.stats
    }))
  }
  if (needsAttributeData.value) {
    tasks.push(userAttributesAPI.getBatchUserAttributes(userIds).then((response) => {
      if (sequence === secondarySequence) attributeValues.value = response.attributes
    }))
  }
  if (needsQuotaData.value) {
    tasks.push((async () => {
      const result: Record<number, PlatformQuotaItem[]> = {}
      for (let index = 0; index < userIds.length; index += 6) {
        if (sequence !== secondarySequence) return
        const chunk = userIds.slice(index, index + 6)
        const responses = await Promise.allSettled(chunk.map((userId) => usersAPI.getPlatformQuotas(userId)))
        responses.forEach((response, responseIndex) => {
          if (response.status === 'fulfilled') result[chunk[responseIndex]] = response.value.platform_quotas || []
        })
      }
      if (sequence === secondarySequence) platformQuotaStats.value = result
    })())
  }
  const results = await Promise.allSettled(tasks)
  if (sequence !== secondarySequence) return
  if (results.some((result) => result.status === 'rejected')) app.showError('部分扩展列加载失败，可刷新重试')
  secondaryLoading.value = false
}

async function loadUsers(): Promise<void> {
  requestController?.abort()
  requestController = new AbortController()
  const controller = requestController
  loading.value = true
  error.value = ''
  usageSortMenu.value = null
  persistFilters()
  try {
    const attributes = Object.fromEntries(Object.entries(filters.attributes)
      .filter(([, value]) => value.trim())
      .map(([id, value]) => [Number(id), value.trim()]))
    const response = await usersAPI.list(page.value, pageSize.value, {
      role: filters.role || undefined,
      status: filters.status || undefined,
      search: filters.search.trim() || undefined,
      group_name: filters.groupName.trim() || undefined,
      api_key_group_id: filters.apiKeyGroupId ?? undefined,
      attributes: Object.keys(attributes).length ? attributes : undefined,
      include_subscriptions: true,
      sort_by: sort.key,
      sort_order: sort.order
    }, { signal: controller.signal })
    if (controller.signal.aborted) return
    users.value = response.items
    total.value = response.total
    pages.value = Math.max(response.pages || 1, 1)
    if (selectedUser.value) {
      const refreshed = response.items.find((user) => user.id === selectedUser.value?.id)
      if (refreshed) selectedUser.value = refreshed
    }
    usageStats.value = {}
    attributeValues.value = {}
    platformQuotaStats.value = {}
    void loadSecondaryData(response.items.map((user) => user.id))
  } catch (caught) {
    const info = caught as { name?: string; code?: string; message?: string }
    if (info.name === 'AbortError' || info.name === 'CanceledError' || info.code === 'ERR_CANCELED') return
    error.value = info.message || '用户列表加载失败'
  } finally {
    if (requestController === controller) loading.value = false
  }
}

function scheduleSearch(): void {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    page.value = 1
    void loadUsers()
  }, 320)
}

function applyFilters(): void {
  page.value = 1
  void loadUsers()
}

function clearFilters(): void {
  filters.role = ''
  filters.status = ''
  filters.groupName = ''
  filters.apiKeyGroupId = null
  filters.attributes = {}
  applyFilters()
}

function toggleFilter(key: string): void {
  const next = new Set(visibleFilters.value)
  if (next.has(key)) {
    next.delete(key)
    if (key === 'role') filters.role = ''
    else if (key === 'status') filters.status = ''
    else if (key === 'group') filters.groupName = ''
    else if (key === 'apiKeyGroup') filters.apiKeyGroupId = null
    else if (key.startsWith(ATTRIBUTE_COLUMN_PREFIX)) delete filters.attributes[Number(key.slice(ATTRIBUTE_COLUMN_PREFIX.length))]
    applyFilters()
  } else {
    next.add(key)
  }
  visibleFilters.value = next
  persistFilters()
}

function toggleColumn(key: string): void {
  if (FORCED_VISIBLE_COLUMNS.has(key as UserColumnKey)) return
  const next = new Set(visibleColumnKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  visibleColumnKeys.value = next
  persistColumns()
  if (users.value.length > 0) void loadSecondaryData(users.value.map((user) => user.id))
}

function resetColumns(): void {
  visibleColumnKeys.value = new Set(defaultVisibleColumnKeys)
  FORCED_VISIBLE_COLUMNS.forEach((key) => visibleColumnKeys.value.add(key))
  persistColumns()
  void loadSecondaryData(users.value.map((user) => user.id))
}

function changeSort(key: string): void {
  if (!SERVER_SORTABLE_COLUMNS.has(key)) return
  usageSort.value = null
  sort.order = sort.key === key && sort.order === SortOrder.DESC ? SortOrder.ASC : SortOrder.DESC
  sort.key = key
  persistSort()
  page.value = 1
  void loadUsers()
}

function usageColumnPlatform(key: UserColumnKey): PlatformQuotaPlatform | null {
  const map: Partial<Record<UserColumnKey, PlatformQuotaPlatform>> = {
    [UserColumnKey.USAGE_ANTHROPIC]: PlatformQuotaPlatform.ANTHROPIC,
    [UserColumnKey.USAGE_OPENAI]: PlatformQuotaPlatform.OPENAI,
    [UserColumnKey.USAGE_GEMINI]: PlatformQuotaPlatform.GEMINI,
    [UserColumnKey.USAGE_ANTIGRAVITY]: PlatformQuotaPlatform.ANTIGRAVITY
  }
  return map[key] ?? null
}

function isUsageColumn(key: string): key is UserColumnKey {
  return key === UserColumnKey.USAGE || key.startsWith('usage_')
}

function cycleUsageSort(key: UserColumnKey, period: UsagePeriod): void {
  const current = usageSort.value
  if (!current || current.key !== key || current.period !== period) {
    usageSort.value = { key, platform: usageColumnPlatform(key), period, order: SortOrder.DESC }
  } else if (current.order === SortOrder.DESC) {
    usageSort.value = { ...current, order: SortOrder.ASC }
  } else {
    usageSort.value = null
  }
  usageSortMenu.value = null
}

function usageSortLabel(key: UserColumnKey, period: UsagePeriod): string {
  const current = usageSort.value
  if (!current || current.key !== key || current.period !== period) return ''
  return current.order === SortOrder.DESC ? '↓' : '↑'
}

function goToPage(nextPage: number): void {
  if (nextPage < 1 || nextPage > pages.value || nextPage === page.value) return
  page.value = nextPage
  void loadUsers()
}

function changePageSize(): void {
  page.value = 1
  void loadUsers()
}

function toggleSelection(userId: number): void {
  selectedIds.value = selectedIds.value.includes(userId)
    ? selectedIds.value.filter((id) => id !== userId)
    : [...selectedIds.value, userId]
}

function toggleCurrentPageSelection(): void {
  const currentIds = users.value.map((user) => user.id)
  selectedIds.value = currentPageSelected.value
    ? selectedIds.value.filter((id) => !currentIds.includes(id))
    : Array.from(new Set([...selectedIds.value, ...currentIds]))
}

function openUser(user: AdminUser, tab: UserPanelTab): void {
  selectedUser.value = user
  drawerTab.value = tab
  showDrawer.value = true
}

async function handleDrawerChanged(): Promise<void> {
  const selectedId = selectedUser.value?.id
  await loadUsers()
  if (!selectedId || users.value.some((user) => user.id === selectedId)) return
  try {
    const refreshed = await usersAPI.getById(selectedId)
    selectedUser.value = { ...refreshed, subscriptions: selectedUser.value?.subscriptions }
  } catch {
    showDrawer.value = false
    selectedUser.value = null
  }
}

function handleDrawerDeleted(): void {
  if (selectedUser.value) selectedIds.value = selectedIds.value.filter((id) => id !== selectedUser.value?.id)
  selectedUser.value = null
  void loadUsers()
}

async function toggleRowStatus(user: AdminUser): Promise<void> {
  if (user.role === AdminUserRole.ADMIN || statusUpdatingIds.value.has(user.id)) return
  const nextStatus = user.status === AdminUserStatus.ACTIVE ? AdminUserStatus.DISABLED : AdminUserStatus.ACTIVE
  const confirmed = await confirmDialog.ask({
    title: nextStatus === AdminUserStatus.DISABLED ? '停用用户' : '恢复用户',
    message: `${user.email} ${nextStatus === AdminUserStatus.DISABLED ? '将无法登录或继续使用 API' : '将重新获得登录和 API 访问能力'}。`,
    confirmText: nextStatus === AdminUserStatus.DISABLED ? '确认停用' : '确认恢复',
    tone: nextStatus === AdminUserStatus.DISABLED ? ConfirmTone.DANGER : ConfirmTone.DEFAULT
  })
  if (!confirmed) return
  statusUpdatingIds.value.add(user.id)
  try {
    await usersAPI.toggleStatus(user.id, nextStatus)
    app.showSuccess(nextStatus === AdminUserStatus.DISABLED ? '用户已停用' : '用户已恢复')
    await loadUsers()
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '用户状态更新失败')
  } finally {
    statusUpdatingIds.value.delete(user.id)
  }
}

function getAttributeDefinition(key: string): UserAttributeDefinition | undefined {
  return attributeDefinitions.value.find((definition) => `${ATTRIBUTE_COLUMN_PREFIX}${definition.id}` === key)
}

function getAttributeValue(userId: number, definition: UserAttributeDefinition): string {
  return formatAttributeValue(attributeValues.value[userId]?.[definition.id], definition)
}

function getUserExclusiveGroups(user: AdminUser): AdminGroup[] {
  return groups.value.filter((group) => group.status === 'active' && group.subscription_type === 'standard' && group.is_exclusive && user.allowed_groups?.includes(group.id))
}

function getPublicGroupCount(): number {
  return groups.value.filter((group) => group.status === 'active' && group.subscription_type === 'standard' && !group.is_exclusive).length
}

function getPlatformUsage(userId: number, platform: PlatformQuotaPlatform | null): BatchUserUsageStats | { today_actual_cost: number; total_actual_cost: number } | null {
  const stats = usageStats.value[String(userId)]
  if (!stats) return null
  if (!platform) return stats
  return stats.by_platform?.find((entry) => entry.platform === platform) ?? { today_actual_cost: 0, total_actual_cost: 0 }
}

function quotaSummary(userId: number): string {
  const quotas = platformQuotaStats.value[userId]
  if (!quotas) return secondaryLoading.value ? '加载中…' : '不限额'
  const limited = quotas.reduce((count, quota) => count + [quota.daily_limit_usd, quota.weekly_limit_usd, quota.monthly_limit_usd].filter((value) => value !== null).length, 0)
  return limited ? `${limited} 项限制` : '不限额'
}

function daysRemaining(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
}

async function reloadAttributeDefinitions(): Promise<void> {
  try {
    attributeDefinitions.value = await userAttributesAPI.listEnabledDefinitions()
    await loadUsers()
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '自定义属性刷新失败')
  }
}

onMounted(async () => {
  restorePreferences()
  await loadReferenceData()
  await loadUsers()
})

onBeforeUnmount(() => {
  requestController?.abort()
  secondarySequence += 1
  if (searchTimer !== null) window.clearTimeout(searchTimer)
})
</script>

<template>
  <ConsoleShell>
    <section class="users-heading">
      <div><p>身份与访问控制</p><h1>用户管理</h1><span>完整管理用户资料、分组、密钥、资金与平台额度。</span></div>
      <div class="heading-actions"><button type="button" class="button button--secondary" @click="showAttributes = true">自定义属性</button><button type="button" class="button button--primary" @click="showCreate = true">创建用户</button></div>
    </section>

    <section class="user-metrics" aria-label="用户列表摘要">
      <div><span>匹配用户</span><strong>{{ total.toLocaleString() }}</strong><small>服务端筛选结果</small></div>
      <div><span>本页停用</span><strong>{{ pageDisabledCount }}</strong><small>当前 {{ users.length }} 条记录</small></div>
      <div><span>本页余额</span><strong>{{ formatMoney(pageBalance) }}</strong><small>仅当前页汇总</small></div>
      <div><span>已选择</span><strong>{{ selectedCount }}</strong><small>跨页选择会保留</small></div>
    </section>

    <section class="users-toolbar">
      <div class="search-control"><span aria-hidden="true">⌕</span><input v-model="filters.search" type="search" placeholder="搜索邮箱、用户名或用户 ID" aria-label="搜索用户" @input="scheduleSearch" @keyup.enter="applyFilters"></div>
      <div class="toolbar-actions">
        <button type="button" :class="{ 'is-active': filterSettingsOpen }" @click="filterSettingsOpen = !filterSettingsOpen; columnSettingsOpen = false">筛选项 <span v-if="activeFilterCount">{{ activeFilterCount }}</span></button>
        <button type="button" :class="{ 'is-active': columnSettingsOpen }" @click="columnSettingsOpen = !columnSettingsOpen; filterSettingsOpen = false">显示列</button>
        <button type="button" :disabled="loading" @click="loadUsers">{{ loading ? '刷新中…' : '刷新' }}</button>
      </div>
    </section>

    <section v-if="filterSettingsOpen" class="settings-panel">
      <header><div><p>筛选项设置</p><h2>选择固定在工具栏中的筛选器</h2></div><button type="button" @click="filterSettingsOpen = false">完成</button></header>
      <div class="settings-options"><label v-for="definition in filterDefinitions" :key="definition.key"><input type="checkbox" :checked="visibleFilters.has(definition.key)" @change="toggleFilter(definition.key)"><span>{{ definition.label }}</span></label></div>
    </section>

    <section v-if="columnSettingsOpen" class="settings-panel">
      <header><div><p>列显示设置</p><h2>扩展列按需加载，选择结果会保存</h2></div><div><button type="button" @click="resetColumns">恢复默认</button><button type="button" @click="columnSettingsOpen = false">完成</button></div></header>
      <div class="settings-options settings-options--columns"><label v-for="column in allDisplayColumns" :key="column.key" :class="{ locked: FORCED_VISIBLE_COLUMNS.has(column.key as UserColumnKey) }"><input type="checkbox" :checked="visibleColumnKeys.has(column.key)" :disabled="FORCED_VISIBLE_COLUMNS.has(column.key as UserColumnKey)" @change="toggleColumn(column.key)"><span>{{ column.label }}</span><small v-if="FORCED_VISIBLE_COLUMNS.has(column.key as UserColumnKey)">始终显示</small></label></div>
    </section>

    <section class="active-filters">
      <label v-if="visibleFilters.has('role')"><span>角色</span><select v-model="filters.role" @change="applyFilters"><option value="">全部角色</option><option :value="AdminUserRole.ADMIN">管理员</option><option :value="AdminUserRole.USER">普通用户</option></select></label>
      <label v-if="visibleFilters.has('status')"><span>状态</span><select v-model="filters.status" @change="applyFilters"><option value="">全部状态</option><option :value="AdminUserStatus.ACTIVE">正常</option><option :value="AdminUserStatus.DISABLED">已停用</option></select></label>
      <label v-if="visibleFilters.has('group')"><span>授权分组</span><input v-model="filters.groupName" list="authorized-group-options" placeholder="输入名称模糊匹配" @keyup.enter="applyFilters"><datalist id="authorized-group-options"><option v-for="group in groups.filter((entry) => entry.is_exclusive && entry.subscription_type === 'standard')" :key="group.id" :value="group.name" /></datalist></label>
      <label v-if="visibleFilters.has('apiKeyGroup')"><span>API Key 分组</span><select v-model="filters.apiKeyGroupId" @change="applyFilters"><option :value="null">全部分组</option><option v-for="group in apiKeyFilterGroups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.status === 'active' ? group.platform : '已停用' }}</option></select></label>
      <label v-for="definition in attributeDefinitions.filter((entry) => entry.enabled && visibleFilters.has(`${ATTRIBUTE_COLUMN_PREFIX}${entry.id}`))" :key="definition.id"><span>{{ definition.name }}</span><select v-if="definition.type === UserAttributeTypeCode.SELECT || definition.type === UserAttributeTypeCode.MULTI_SELECT" v-model="filters.attributes[definition.id]" @change="applyFilters"><option value="">全部</option><option v-for="option in definition.options" :key="option.value" :value="option.value">{{ option.label }}</option></select><input v-else v-model="filters.attributes[definition.id]" :type="definition.type === UserAttributeTypeCode.NUMBER ? 'number' : definition.type === UserAttributeTypeCode.DATE ? 'date' : 'text'" :placeholder="definition.placeholder || `筛选${definition.name}`" @keyup.enter="applyFilters"></label>
      <div class="filter-commit"><button type="button" class="button button--primary" @click="applyFilters">应用筛选</button><button v-if="activeFilterCount" type="button" @click="clearFilters">清空条件</button></div>
    </section>

    <section v-if="selectedCount" class="selection-bar"><div><strong>已选择 {{ selectedCount }} 个用户</strong><span>跨页选择保持；批量修改最多处理 500 个。</span></div><div><button type="button" @click="selectedIds = []">取消选择</button><button type="button" class="button button--primary" @click="showBulk = true">批量修改并发 / RPM</button></div></section>

    <PageState :loading="loading" :error="error" :empty="!loading && !error && users.length === 0" empty-text="当前条件下没有用户。" @retry="loadUsers">
      <template #empty-action><button type="button" class="button button--primary" @click="showCreate = true">创建首位用户</button></template>
      <section class="users-table-shell">
        <div class="table-scroll">
          <table>
            <thead><tr><th class="selection-column"><input type="checkbox" :checked="currentPageSelected" aria-label="选择当前页全部用户" @change="toggleCurrentPageSelection"></th><th v-for="column in visibleColumns" :key="column.key" :class="{ sortable: SERVER_SORTABLE_COLUMNS.has(column.key), actions: column.key === ACTIONS_COLUMN }"><button v-if="SERVER_SORTABLE_COLUMNS.has(column.key)" type="button" @click="changeSort(column.key)">{{ column.label }} <span>{{ sort.key === column.key ? (sort.order === SortOrder.DESC ? '↓' : '↑') : '↕' }}</span></button><div v-else-if="isUsageColumn(column.key)" class="usage-sort"><button type="button" @click="usageSortMenu = usageSortMenu === column.key ? null : column.key">{{ column.label }} <span>{{ usageSort?.key === column.key ? (usageSort.period === UsagePeriod.TODAY ? '今日' : '累计') + usageSortLabel(column.key as UserColumnKey, usageSort.period) : '↕' }}</span></button><div v-if="usageSortMenu === column.key"><button type="button" @click="cycleUsageSort(column.key as UserColumnKey, UsagePeriod.TODAY)">今日 {{ usageSortLabel(column.key as UserColumnKey, UsagePeriod.TODAY) || '↕' }}</button><button type="button" @click="cycleUsageSort(column.key as UserColumnKey, UsagePeriod.TOTAL)">累计 {{ usageSortLabel(column.key as UserColumnKey, UsagePeriod.TOTAL) || '↕' }}</button><small>仅排序当前页</small></div></div><span v-else>{{ column.label }}</span></th></tr></thead>
            <tbody>
              <tr v-for="user in sortedUsers" :key="user.id" :class="{ selected: selectedIds.includes(user.id) }">
                <td class="selection-column"><input type="checkbox" :checked="selectedIds.includes(user.id)" :aria-label="`选择 ${user.email}`" @change="toggleSelection(user.id)"></td>
                <td v-for="column in visibleColumns" :key="column.key" :class="[`cell-${column.key}`, { actions: column.key === ACTIONS_COLUMN }]">
                  <button v-if="column.key === EMAIL_COLUMN" type="button" class="identity-cell" @click="openUser(user, UserPanelTab.PROFILE)"><span>{{ user.email.charAt(0).toUpperCase() }}</span><div><strong>{{ user.email }}</strong><small>#{{ user.id }} · {{ user.username || '未设置用户名' }}</small></div></button>
                  <span v-else-if="column.key === UserColumnKey.ID" class="numeric">{{ user.id }}</span>
                  <span v-else-if="column.key === UserColumnKey.USERNAME">{{ user.username || '—' }}</span>
                  <span v-else-if="column.key === UserColumnKey.NOTES" class="clamped" :title="user.notes">{{ user.notes || '—' }}</span>
                  <span v-else-if="column.key === UserColumnKey.ROLE" :class="['role-chip', { admin: user.role === AdminUserRole.ADMIN }]">{{ user.role === AdminUserRole.ADMIN ? '管理员' : '用户' }}</span>
                  <button v-else-if="column.key === UserColumnKey.GROUPS" type="button" class="link-cell" @click="openUser(user, UserPanelTab.ACCESS)"><strong>{{ getUserExclusiveGroups(user).length }} 个专属</strong><small>{{ getUserExclusiveGroups(user).map((group) => group.name).join('、') || '未授权专属分组' }} · {{ getPublicGroupCount() }} 个公共</small></button>
                  <div v-else-if="column.key === UserColumnKey.SUBSCRIPTIONS" class="subscription-cell"><template v-if="user.subscriptions?.length"><span v-for="subscription in user.subscriptions" :key="subscription.id"><strong>{{ subscription.group?.name || `分组 ${subscription.group_id}` }}</strong><small>{{ subscription.status }}<template v-if="daysRemaining(subscription.expires_at) !== null"> · {{ daysRemaining(subscription.expires_at) }} 天</template></small></span></template><span v-else>无订阅</span></div>
                  <button v-else-if="column.key === UserColumnKey.BALANCE" type="button" class="money-cell" @click="openUser(user, UserPanelTab.FINANCE)">{{ formatMoney(user.balance) }}</button>
                  <button v-else-if="column.key === UserColumnKey.PLATFORM_QUOTA" type="button" class="link-cell" @click="openUser(user, UserPanelTab.QUOTAS)"><strong>{{ quotaSummary(user.id) }}</strong><small>点击管理五个平台限额</small></button>
                  <div v-else-if="isUsageColumn(column.key)" class="usage-cell"><template v-if="getPlatformUsage(user.id, usageColumnPlatform(column.key as UserColumnKey))"><strong>{{ formatMoney(getPlatformUsage(user.id, usageColumnPlatform(column.key as UserColumnKey))?.today_actual_cost) }}</strong><small>累计 {{ formatMoney(getPlatformUsage(user.id, usageColumnPlatform(column.key as UserColumnKey))?.total_actual_cost) }}</small></template><span v-else>{{ secondaryLoading ? '加载中…' : '—' }}</span></div>
                  <div v-else-if="column.key === UserColumnKey.CONCURRENCY" class="limit-cell"><strong>{{ user.current_concurrency ?? 0 }} / {{ user.concurrency }}</strong><small>RPM {{ user.rpm_limit ? user.rpm_limit : '不限' }}</small></div>
                  <button v-else-if="column.key === UserColumnKey.STATUS" type="button" class="status-cell" :class="user.status" :disabled="user.role === AdminUserRole.ADMIN || statusUpdatingIds.has(user.id)" :title="user.role === AdminUserRole.ADMIN ? '管理员状态不可在此修改' : '点击变更状态'" @click="toggleRowStatus(user)"><span></span>{{ statusUpdatingIds.has(user.id) ? '更新中…' : user.status === AdminUserStatus.ACTIVE ? '正常' : '已停用' }}</button>
                  <span v-else-if="column.key === UserColumnKey.LAST_ACTIVE_AT">{{ formatDateTime(user.last_active_at) }}</span>
                  <span v-else-if="column.key === UserColumnKey.LAST_USED_AT">{{ formatDateTime(user.last_used_at) }}</span>
                  <span v-else-if="column.key === UserColumnKey.CREATED_AT">{{ formatDateTime(user.created_at) }}</span>
                  <span v-else-if="column.key.startsWith(ATTRIBUTE_COLUMN_PREFIX)" class="clamped" :title="getAttributeDefinition(column.key) ? getAttributeValue(user.id, getAttributeDefinition(column.key)!) : ''">{{ getAttributeDefinition(column.key) ? getAttributeValue(user.id, getAttributeDefinition(column.key)!) : '—' }}</span>
                  <div v-else-if="column.key === ACTIONS_COLUMN" class="row-actions"><button type="button" @click="openUser(user, UserPanelTab.PROFILE)">资料</button><button type="button" @click="openUser(user, UserPanelTab.ACCESS)">访问</button><button type="button" @click="openUser(user, UserPanelTab.KEYS)">密钥</button><button type="button" @click="openUser(user, UserPanelTab.FINANCE)">资金</button><button type="button" @click="openUser(user, UserPanelTab.QUOTAS)">额度</button></div>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="table-footer"><div><span>第 {{ page }} / {{ pages }} 页 · 共 {{ total }} 条</span><label>每页<select v-model.number="pageSize" @change="changePageSize"><option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option></select></label></div><div><button type="button" :disabled="page <= 1" @click="goToPage(page - 1)">上一页</button><button type="button" :disabled="page >= pages" @click="goToPage(page + 1)">下一页</button></div></footer>
      </section>
    </PageState>

    <UserCreateDialog :show="showCreate" @close="showCreate = false" @created="loadUsers" />
    <BulkLimitsDialog :show="showBulk" :selected-ids="selectedIds" @close="showBulk = false" @applied="selectedIds = []; loadUsers()" />
    <AttributeDefinitionsDialog :show="showAttributes" @close="showAttributes = false" @changed="reloadAttributeDefinitions" />
    <UserDetailDrawer :show="showDrawer" :user="selectedUser" :initial-tab="drawerTab" :attribute-definitions="attributeDefinitions" @close="showDrawer = false" @changed="handleDrawerChanged" @deleted="handleDrawerDeleted" />
  </ConsoleShell>
</template>

<style scoped>
.users-heading { margin-bottom: 28px; display: flex; align-items: end; justify-content: space-between; gap: 24px; }.users-heading p { margin: 0 0 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .12em; text-transform: uppercase; }.users-heading h1 { margin: 0; font-size: clamp(38px, 5vw, 62px); line-height: 1; letter-spacing: -.055em; }.users-heading > div > span { margin-top: 12px; display: block; color: var(--text-secondary); font-size: 12px; }.heading-actions { display: flex; gap: 9px; }.heading-actions .button { min-height: 42px; padding-inline: 15px; border-radius: 10px; font-size: var(--font-body-sm); }
.user-metrics { margin-bottom: 20px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--border-subtle); border: 1px solid var(--border-subtle); gap: 1px; }.user-metrics div { padding: 18px; display: grid; gap: 5px; background: var(--surface-raised); }.user-metrics span, .user-metrics small { color: var(--text-secondary); font-size: var(--font-meta); }.user-metrics strong { font-size: 22px; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
.users-toolbar { position: relative; z-index: 5; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }.search-control { width: min(430px, 100%); position: relative; }.search-control > span { position: absolute; top: 50%; left: 13px; color: var(--text-secondary); transform: translateY(-50%); }.search-control input { width: 100%; min-height: 44px; padding: 0 13px 0 38px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; }.toolbar-actions { display: flex; gap: 7px; }.toolbar-actions > button, .settings-panel header button, .filter-commit > button:not(.button), .selection-bar button:not(.button), .table-footer button { min-height: 40px; padding: 0 12px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; cursor: pointer; font-size: var(--font-meta); }.toolbar-actions button.is-active { color: var(--accent); border-color: var(--accent); }.toolbar-actions button span { min-width: 17px; height: 17px; padding: 0 5px; display: inline-grid; place-content: center; color: white; background: var(--accent); border-radius: 8px; font-size: var(--font-meta); }
.settings-panel { margin-bottom: 10px; padding: 17px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.settings-panel header { margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 18px; }.settings-panel header p { margin: 0 0 3px; color: var(--text-secondary); font-size: var(--font-meta); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }.settings-panel h2 { margin: 0; font-size: 14px; }.settings-panel header > div:last-child { display: flex; gap: 7px; }.settings-options { display: flex; flex-wrap: wrap; gap: 7px; }.settings-options label { min-height: 34px; padding: 0 10px; display: flex; align-items: center; gap: 7px; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.settings-options label:has(input:checked) { color: var(--text-primary); box-shadow: inset 0 0 0 1px var(--accent); }.settings-options label.locked { cursor: not-allowed; opacity: .68; }.settings-options small { color: var(--text-secondary); font-size: var(--font-meta); }
.active-filters { margin-bottom: 14px; display: flex; align-items: end; flex-wrap: wrap; gap: 8px; }.active-filters > label { min-width: 128px; display: grid; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); }.active-filters input, .active-filters select { min-height: 39px; padding: 0 10px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; font-size: var(--font-meta); }.filter-commit { margin-left: auto; display: flex; gap: 6px; }.filter-commit .button { min-height: 39px; padding-inline: 12px; border-radius: 9px; font-size: var(--font-meta); }
.selection-bar { margin-bottom: 12px; padding: 13px 15px; display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--text-primary); background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border-subtle)); border-radius: 11px; }.selection-bar > div { display: flex; align-items: center; gap: 10px; }.selection-bar strong { font-size: var(--font-body-sm); }.selection-bar span { color: var(--text-secondary); font-size: var(--font-meta); }.selection-bar .button { min-height: 38px; padding-inline: 12px; border-radius: 9px; font-size: var(--font-meta); }
.users-table-shell { background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; overflow: hidden; }.table-scroll { overflow: auto; }.users-table-shell table { width: 100%; min-width: 1040px; border-collapse: collapse; }.users-table-shell th, .users-table-shell td { padding: 12px 13px; border-bottom: 1px solid var(--border-subtle); text-align: left; vertical-align: middle; white-space: nowrap; }.users-table-shell thead th { position: relative; color: var(--text-secondary); background: color-mix(in srgb, var(--surface-canvas) 58%, var(--surface-raised)); font-size: var(--font-meta); font-weight: 740; letter-spacing: .055em; text-transform: uppercase; }.users-table-shell thead th > button, .usage-sort > button { padding: 0; color: inherit; background: transparent; border: 0; cursor: pointer; font: inherit; letter-spacing: inherit; text-transform: inherit; }.users-table-shell thead button span { color: var(--accent); }.selection-column { position: sticky; z-index: 3; left: 0; width: 42px; padding-inline: 13px !important; background: var(--surface-raised) !important; }.users-table-shell tbody tr.selected td { background: color-mix(in srgb, var(--accent) 5%, var(--surface-raised)); }.users-table-shell tbody tr:hover td { background: color-mix(in srgb, var(--accent) 3%, var(--surface-raised)); }.users-table-shell tbody tr:last-child td { border-bottom: 0; }.users-table-shell td { color: var(--text-secondary); font-size: var(--font-meta); }.users-table-shell td.actions, .users-table-shell th.actions { position: sticky; z-index: 2; right: 0; background: var(--surface-raised); box-shadow: -8px 0 16px rgba(20, 16, 28, .035); }
.usage-sort { position: relative; }.usage-sort > div { position: absolute; z-index: 20; top: calc(100% + 9px); left: 0; min-width: 130px; padding: 5px; display: grid; gap: 2px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; box-shadow: 0 12px 32px rgba(20, 16, 28, .15); }.usage-sort > div button { min-height: 31px; padding: 0 8px; color: var(--text-primary); background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: var(--font-meta); text-align: left; }.usage-sort > div button:hover { background: var(--accent-soft); }.usage-sort small { padding: 4px 8px; color: var(--text-secondary); font-size: var(--font-meta); font-weight: 500; letter-spacing: 0; text-transform: none; }
.identity-cell { min-width: 230px; padding: 0; display: flex; align-items: center; gap: 10px; color: var(--text-primary); background: transparent; border: 0; cursor: pointer; text-align: left; }.identity-cell > span { width: 31px; height: 31px; flex: 0 0 auto; display: grid; place-content: center; color: var(--accent); background: var(--accent-soft); border-radius: 9px; font-weight: 780; }.identity-cell div { min-width: 0; display: grid; gap: 3px; }.identity-cell strong { max-width: 250px; overflow: hidden; font-size: var(--font-meta); text-overflow: ellipsis; }.identity-cell small { color: var(--text-secondary); font-size: var(--font-meta); }.numeric { color: var(--text-primary); font-variant-numeric: tabular-nums; }.clamped { max-width: 190px; display: block; overflow: hidden; text-overflow: ellipsis; }.role-chip { padding: 4px 7px; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 6px; }.role-chip.admin { color: var(--accent); background: var(--accent-soft); }.link-cell { padding: 0; display: grid; gap: 3px; color: var(--text-primary); background: transparent; border: 0; cursor: pointer; text-align: left; }.link-cell strong { font-size: var(--font-meta); }.link-cell small { max-width: 190px; overflow: hidden; color: var(--text-secondary); font-size: var(--font-meta); text-overflow: ellipsis; }.subscription-cell { display: flex; gap: 5px; }.subscription-cell > span { padding: 5px 7px; display: grid; gap: 2px; background: var(--surface-canvas); border-radius: 6px; }.subscription-cell strong { color: var(--text-primary); font-size: var(--font-meta); }.subscription-cell small { font-size: var(--font-meta); }.money-cell { padding: 0; color: var(--text-primary); background: transparent; border: 0; border-bottom: 1px dashed var(--border-subtle); cursor: pointer; font-weight: 720; font-variant-numeric: tabular-nums; }.usage-cell, .limit-cell { display: grid; gap: 3px; }.usage-cell strong, .limit-cell strong { color: var(--text-primary); font-size: var(--font-meta); font-variant-numeric: tabular-nums; }.usage-cell small, .limit-cell small { font-size: var(--font-meta); }.status-cell { padding: 0; display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }.status-cell span { width: 7px; height: 7px; background: var(--danger); border-radius: 50%; }.status-cell.active span { background: var(--success); }.row-actions { display: flex; gap: 3px; }.row-actions button { min-height: 29px; padding: 0 7px; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid transparent; border-radius: 6px; cursor: pointer; font-size: var(--font-meta); }.row-actions button:hover { color: var(--text-primary); border-color: var(--border-subtle); }
.table-footer { padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid var(--border-subtle); }.table-footer > div { display: flex; align-items: center; gap: 11px; color: var(--text-secondary); font-size: var(--font-meta); }.table-footer label { display: flex; align-items: center; gap: 5px; }.table-footer select { min-height: 32px; padding: 0 24px 0 7px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; }.table-footer button { min-height: 34px; }.table-footer button:disabled, button:disabled { cursor: not-allowed; opacity: .5; }
@media (max-width: 900px) { .users-heading { align-items: flex-start; flex-direction: column; }.user-metrics { grid-template-columns: repeat(2, 1fr); }.users-toolbar { align-items: stretch; flex-direction: column; }.search-control { width: 100%; }.toolbar-actions { overflow-x: auto; }.active-filters > label { flex: 1 1 160px; }.filter-commit { width: 100%; margin-left: 0; }.filter-commit .button { flex: 1; }.selection-bar { align-items: flex-start; flex-direction: column; } }
@media (max-width: 560px) { .heading-actions { width: 100%; }.heading-actions .button { flex: 1; }.user-metrics { grid-template-columns: 1fr; }.selection-bar > div { width: 100%; align-items: flex-start; flex-wrap: wrap; }.table-footer { align-items: flex-start; flex-direction: column; }.table-footer > div:last-child { width: 100%; }.table-footer > div:last-child button { flex: 1; } }
</style>
