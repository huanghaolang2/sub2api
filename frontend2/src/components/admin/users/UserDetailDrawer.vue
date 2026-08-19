<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import * as adminApiKeysAPI from '@shared-api/admin/apiKeys'
import * as groupsAPI from '@shared-api/admin/groups'
import * as userAttributesAPI from '@shared-api/admin/userAttributes'
import * as usersAPI from '@shared-api/admin/users'
import type {
  BalanceHistoryItem,
  PlatformQuotaItem,
  PlatformQuotaUpdateItem
} from '@shared-api/admin/users'
import type {
  AdminGroup,
  AdminUser,
  ApiKey,
  UserAttributeDefinition,
  UserAttributeValuesMap
} from '@/types'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog.vue'
import {
  isStepUpBlocked,
  isStepUpCancelled,
  stepUpBlockReason,
  useStepUp
} from '@/composables/useStepUp'
import { useModalInteraction } from '@/composables/useModalInteraction'
import {
  AdminUserRole,
  AdminUserStatus,
  BalanceHistoryType,
  BalanceOperation,
  formatDateTime,
  formatMoney,
  normalizeQuotaLimit,
  PlatformQuotaPlatform,
  PlatformQuotaWindow,
  UserAttributeTypeCode,
  UserPanelTab
} from '@/features/admin/users/model'
import { useAppStore } from '@/stores/app'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'

interface QuotaRow {
  platform: PlatformQuotaPlatform
  daily_limit_usd: number | null
  weekly_limit_usd: number | null
  monthly_limit_usd: number | null
  daily_usage_usd: number
  weekly_usage_usd: number
  monthly_usage_usd: number
}

type AttributeDraftValue = string | string[]

const props = defineProps<{
  show: boolean
  user: AdminUser | null
  initialTab: UserPanelTab
  attributeDefinitions: UserAttributeDefinition[]
}>()
const emit = defineEmits<{ close: []; changed: []; deleted: [] }>()
const app = useAppStore()
const confirmDialog = useConfirmStore()
const stepUp = useStepUp()

const activeTab = ref<UserPanelTab>(UserPanelTab.PROFILE)
const busy = ref(false)
const loadingProfile = ref(false)
const loadingAccess = ref(false)
const loadingKeys = ref(false)
const loadingFinance = ref(false)
const loadingQuotas = ref(false)
const groups = ref<AdminGroup[]>([])
const apiKeys = ref<ApiKey[]>([])
const updatingKeyIds = ref(new Set<number>())
const history = ref<BalanceHistoryItem[]>([])
const historyPage = ref(1)
const historyPages = ref(1)
const historyTotal = ref(0)
const totalRecharged = ref(0)
const historyType = ref<BalanceHistoryType>(BalanceHistoryType.ALL)
const adjustedBalance = ref(0)
const quotaRows = ref<QuotaRow[]>([])
const resettingQuota = reactive<Record<string, boolean>>({})
const drawer = ref<HTMLElement | null>(null)
useModalInteraction(() => props.show && Boolean(props.user), drawer, () => emit('close'))

const profile = reactive({
  email: '',
  password: '',
  username: '',
  role: AdminUserRole.USER,
  notes: '',
  concurrency: 1,
  rpmLimit: 0
})
const attributeDraft = reactive<Record<number, AttributeDraftValue>>({})
const allowedGroupIds = ref<number[]>([])
const originalGroupRates = ref<Record<number, number>>({})
const groupRateDraft = reactive<Record<number, string | number>>({})
const replaceOldGroupId = ref<number | null>(null)
const replaceNewGroupId = ref<number | null>(null)
const balanceOperation = ref<BalanceOperation>(BalanceOperation.ADD)
const balanceAmount = ref<string | number>('')
const balanceNotes = ref('')

const enabledAttributes = computed(() => props.attributeDefinitions.filter((definition) => definition.enabled))
const standardGroups = computed(() => groups.value.filter((group) => group.status === 'active' && group.subscription_type === 'standard'))
const exclusiveGroups = computed(() => standardGroups.value.filter((group) => group.is_exclusive))
const currentExclusiveGroups = computed(() => exclusiveGroups.value.filter((group) => allowedGroupIds.value.includes(group.id)))
const replacementTargets = computed(() => exclusiveGroups.value.filter((group) => group.id !== replaceOldGroupId.value))
const hasActiveSubscription = computed(() => props.user?.subscriptions?.some((subscription) => subscription.status === 'active') ?? false)
const projectedBalance = computed(() => {
  const amount = Number(balanceAmount.value)
  if (!Number.isFinite(amount) || amount <= 0) return adjustedBalance.value
  return balanceOperation.value === BalanceOperation.ADD
    ? adjustedBalance.value + amount
    : adjustedBalance.value - amount
})

const tabs: Array<{ key: UserPanelTab; label: string; hint: string }> = [
  { key: UserPanelTab.PROFILE, label: '资料', hint: '身份与状态' },
  { key: UserPanelTab.ACCESS, label: '访问', hint: '分组与倍率' },
  { key: UserPanelTab.KEYS, label: 'API Key', hint: '密钥归属' },
  { key: UserPanelTab.FINANCE, label: '资金', hint: '余额与流水' },
  { key: UserPanelTab.QUOTAS, label: '额度', hint: '平台限额' }
]
const platforms = Object.values(PlatformQuotaPlatform)

function initializeUser(user: AdminUser): void {
  Object.assign(profile, {
    email: user.email,
    password: '',
    username: user.username || '',
    role: user.role as AdminUserRole,
    notes: user.notes || '',
    concurrency: user.concurrency,
    rpmLimit: user.rpm_limit ?? 0
  })
  adjustedBalance.value = user.balance
  allowedGroupIds.value = [...(user.allowed_groups ?? [])]
  originalGroupRates.value = { ...(user.group_rates ?? {}) }
  for (const key of Object.keys(groupRateDraft)) delete groupRateDraft[Number(key)]
  for (const [groupId, rate] of Object.entries(user.group_rates ?? {})) groupRateDraft[Number(groupId)] = String(rate)
  replaceOldGroupId.value = null
  replaceNewGroupId.value = null
  balanceAmount.value = ''
  balanceNotes.value = ''
}

async function loadGroups(): Promise<void> {
  if (groups.value.length > 0 || loadingAccess.value) return
  loadingAccess.value = true
  try {
    groups.value = await groupsAPI.getAll()
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '分组加载失败')
  } finally {
    loadingAccess.value = false
  }
}

function decodeAttributeValue(value: string | undefined, definition: UserAttributeDefinition): AttributeDraftValue {
  if (definition.type !== UserAttributeTypeCode.MULTI_SELECT) return value ?? ''
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

async function loadProfile(): Promise<void> {
  if (!props.user || loadingProfile.value) return
  loadingProfile.value = true
  try {
    const values = await userAttributesAPI.getUserAttributeValues(props.user.id)
    const valuesByDefinition = Object.fromEntries(values.map((entry) => [entry.attribute_id, entry.value]))
    for (const definition of enabledAttributes.value) {
      attributeDraft[definition.id] = decodeAttributeValue(valuesByDefinition[definition.id], definition)
    }
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '用户自定义属性加载失败')
  } finally {
    loadingProfile.value = false
  }
}

async function loadKeys(): Promise<void> {
  if (!props.user || loadingKeys.value) return
  loadingKeys.value = true
  try {
    const [response] = await Promise.all([usersAPI.getUserApiKeys(props.user.id), loadGroups()])
    apiKeys.value = response.items || []
  } catch (caught) {
    app.showError((caught as { message?: string }).message || 'API Key 加载失败')
  } finally {
    loadingKeys.value = false
  }
}

async function loadHistory(page = historyPage.value): Promise<void> {
  if (!props.user || loadingFinance.value) return
  loadingFinance.value = true
  try {
    const response = await usersAPI.getUserBalanceHistory(
      props.user.id,
      page,
      15,
      historyType.value || undefined
    )
    history.value = response.items || []
    historyPage.value = response.page
    historyPages.value = response.pages || 1
    historyTotal.value = response.total
    totalRecharged.value = response.total_recharged ?? 0
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '资金流水加载失败')
  } finally {
    loadingFinance.value = false
  }
}

function emptyQuotaRow(platform: PlatformQuotaPlatform): QuotaRow {
  return {
    platform,
    daily_limit_usd: null,
    weekly_limit_usd: null,
    monthly_limit_usd: null,
    daily_usage_usd: 0,
    weekly_usage_usd: 0,
    monthly_usage_usd: 0
  }
}

function normalizeQuotaRows(items: PlatformQuotaItem[]): QuotaRow[] {
  const byPlatform = new Map(items.map((item) => [item.platform, item]))
  return platforms.map((platform) => {
    const item = byPlatform.get(platform)
    return item ? {
      platform,
      daily_limit_usd: item.daily_limit_usd ?? null,
      weekly_limit_usd: item.weekly_limit_usd ?? null,
      monthly_limit_usd: item.monthly_limit_usd ?? null,
      daily_usage_usd: item.daily_usage_usd ?? 0,
      weekly_usage_usd: item.weekly_usage_usd ?? 0,
      monthly_usage_usd: item.monthly_usage_usd ?? 0
    } : emptyQuotaRow(platform)
  })
}

async function loadQuotas(): Promise<void> {
  if (!props.user || loadingQuotas.value) return
  loadingQuotas.value = true
  try {
    const response = await usersAPI.getPlatformQuotas(props.user.id)
    quotaRows.value = normalizeQuotaRows(response.platform_quotas || [])
  } catch (caught) {
    quotaRows.value = platforms.map(emptyQuotaRow)
    app.showError((caught as { message?: string }).message || '平台额度加载失败')
  } finally {
    loadingQuotas.value = false
  }
}

function loadActiveTab(): void {
  if (activeTab.value === UserPanelTab.PROFILE) void loadProfile()
  if (activeTab.value === UserPanelTab.ACCESS) void loadGroups()
  if (activeTab.value === UserPanelTab.KEYS) void loadKeys()
  if (activeTab.value === UserPanelTab.FINANCE) void loadHistory(1)
  if (activeTab.value === UserPanelTab.QUOTAS) void loadQuotas()
}

function generatePassword(): void {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*'
  const random = new Uint32Array(16)
  crypto.getRandomValues(random)
  profile.password = Array.from(random, (value) => alphabet[value % alphabet.length]).join('')
}

async function copyPassword(): Promise<void> {
  if (!profile.password) return
  try {
    await navigator.clipboard.writeText(profile.password)
    app.showSuccess('新密码已复制')
  } catch {
    app.showError('复制失败，请手动选择密码')
  }
}

function serializeAttributes(): UserAttributeValuesMap | null {
  const values: UserAttributeValuesMap = {}
  for (const definition of enabledAttributes.value) {
    const draft = attributeDraft[definition.id]
    if (definition.required && (!draft || (Array.isArray(draft) && draft.length === 0))) {
      app.showError(`自定义属性“${definition.name}”不能为空`)
      return null
    }
    values[definition.id] = Array.isArray(draft) ? JSON.stringify(draft) : String(draft ?? '')
  }
  return values
}

async function saveProfile(): Promise<void> {
  if (!props.user || busy.value) return
  if (!profile.email.trim()) {
    app.showError('邮箱不能为空')
    return
  }
  if (!Number.isInteger(profile.concurrency) || profile.concurrency < 1 || !Number.isInteger(profile.rpmLimit) || profile.rpmLimit < 0) {
    app.showError('并发必须至少为 1，RPM 必须为非负整数')
    return
  }
  const attributeValues = serializeAttributes()
  if (!attributeValues) return
  const payload: Parameters<typeof usersAPI.update>[1] = {
    email: profile.email.trim(),
    username: profile.username.trim(),
    role: profile.role,
    notes: profile.notes.trim(),
    concurrency: profile.concurrency,
    rpm_limit: profile.rpmLimit
  }
  if (profile.password.trim()) payload.password = profile.password.trim()
  busy.value = true
  try {
    await stepUp.run(() => usersAPI.update(props.user!.id, payload))
    await userAttributesAPI.updateUserAttributeValues(props.user.id, attributeValues)
    profile.password = ''
    app.showSuccess('用户资料已更新')
    emit('changed')
  } catch (caught) {
    if (isStepUpCancelled(caught)) return
    if (isStepUpBlocked(caught)) {
      app.showError(stepUpBlockReason(caught) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'
        ? '管理员 API Key 无法完成二次验证，请使用管理员会话。'
        : '当前管理员尚未启用 TOTP，无法完成敏感权限操作。')
      return
    }
    app.showError((caught as { message?: string }).message || '用户资料更新失败')
  } finally {
    busy.value = false
  }
}

function toggleAllowedGroup(groupId: number): void {
  allowedGroupIds.value = allowedGroupIds.value.includes(groupId)
    ? allowedGroupIds.value.filter((id) => id !== groupId)
    : [...allowedGroupIds.value, groupId]
}

async function saveAccess(): Promise<void> {
  if (!props.user || busy.value) return
  const groupRates: Record<number, number | null> = {}
  for (const groupId of Object.keys(originalGroupRates.value).map(Number)) groupRates[groupId] = null
  for (const [rawGroupId, rawRate] of Object.entries(groupRateDraft)) {
    const rateText = String(rawRate ?? '').trim()
    if (!rateText) continue
    const rate = Number(rateText)
    if (!Number.isFinite(rate) || rate <= 0) {
      const group = groups.value.find((entry) => entry.id === Number(rawGroupId))
      app.showError(`${group?.name || `分组 ${rawGroupId}`} 的专属倍率必须大于 0`)
      return
    }
    groupRates[Number(rawGroupId)] = rate
  }
  busy.value = true
  try {
    await usersAPI.update(props.user.id, {
      allowed_groups: [...allowedGroupIds.value],
      group_rates: groupRates
    })
    originalGroupRates.value = Object.fromEntries(
      Object.entries(groupRates).filter(([, value]) => typeof value === 'number') as Array<[string, number]>
    )
    app.showSuccess('访问分组与专属倍率已保存')
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '访问配置保存失败')
  } finally {
    busy.value = false
  }
}

async function replaceGroup(): Promise<void> {
  if (!props.user || !replaceOldGroupId.value || !replaceNewGroupId.value || busy.value) return
  const oldGroup = groups.value.find((group) => group.id === replaceOldGroupId.value)
  const newGroup = groups.value.find((group) => group.id === replaceNewGroupId.value)
  const confirmed = await confirmDialog.ask({
    title: `替换 ${oldGroup?.name || '当前分组'}`,
    message: `将用户授权迁移到“${newGroup?.name || '目标分组'}”，并同步迁移绑定旧分组的 API Key。`,
    confirmText: '确认替换',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  busy.value = true
  try {
    const result = await usersAPI.replaceGroup(props.user.id, replaceOldGroupId.value, replaceNewGroupId.value)
    allowedGroupIds.value = Array.from(new Set(
      allowedGroupIds.value
        .filter((id) => id !== replaceOldGroupId.value)
        .concat(replaceNewGroupId.value)
    ))
    replaceOldGroupId.value = null
    replaceNewGroupId.value = null
    app.showSuccess(`分组已替换，迁移 ${result.migrated_keys} 个 API Key`)
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '分组替换失败')
  } finally {
    busy.value = false
  }
}

function maskedKey(key: string): string {
  if (key.length <= 24) return key
  return `${key.slice(0, 16)}…${key.slice(-7)}`
}

async function changeKeyGroup(key: ApiKey, rawGroupId: string): Promise<void> {
  if (updatingKeyIds.value.has(key.id)) return
  const nextGroupId = rawGroupId ? Number(rawGroupId) : null
  if ((key.group_id ?? null) === nextGroupId) return
  updatingKeyIds.value.add(key.id)
  try {
    const response = await adminApiKeysAPI.updateApiKeyGroup(key.id, nextGroupId)
    const index = apiKeys.value.findIndex((entry) => entry.id === key.id)
    if (index >= 0) apiKeys.value[index] = response.api_key
    app.showSuccess(response.auto_granted_group_access && response.granted_group_name
      ? `已切换分组，并自动授权“${response.granted_group_name}”`
      : 'API Key 分组已更新')
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || 'API Key 分组更新失败')
  } finally {
    updatingKeyIds.value.delete(key.id)
  }
}

async function updateBalance(): Promise<void> {
  if (!props.user || busy.value) return
  const amount = Number(balanceAmount.value)
  if (!Number.isFinite(amount) || amount <= 0) {
    app.showError('请输入大于 0 的金额')
    return
  }
  if (balanceOperation.value === BalanceOperation.SUBTRACT && amount > adjustedBalance.value) {
    app.showError('扣减金额不能超过当前余额')
    return
  }
  busy.value = true
  try {
    const updated = await usersAPI.updateBalance(props.user.id, amount, balanceOperation.value, balanceNotes.value.trim())
    adjustedBalance.value = updated.balance
    balanceAmount.value = ''
    balanceNotes.value = ''
    app.showSuccess(balanceOperation.value === BalanceOperation.ADD ? '余额已充值' : '余额已扣减')
    await loadHistory(1)
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '余额调整失败')
  } finally {
    busy.value = false
  }
}

function quotaWindowLabel(window: PlatformQuotaWindow): string {
  return { daily: '每日', weekly: '每周', monthly: '每月' }[window]
}

async function resetQuota(platform: PlatformQuotaPlatform, window: PlatformQuotaWindow): Promise<void> {
  if (!props.user) return
  const confirmed = await confirmDialog.ask({
    title: `重置 ${platform} ${quotaWindowLabel(window)}用量`,
    message: '当前周期已累计用量会立即归零，限额配置保持不变。',
    confirmText: '确认重置',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  const key = `${platform}.${window}`
  resettingQuota[key] = true
  try {
    const response = await usersAPI.resetPlatformQuotaWindow(props.user.id, platform, window)
    quotaRows.value = normalizeQuotaRows(response.platform_quotas || [])
    app.showSuccess(`${platform} ${quotaWindowLabel(window)}用量已重置`)
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '用量重置失败')
  } finally {
    resettingQuota[key] = false
  }
}

async function clearAllQuotaLimits(): Promise<void> {
  const confirmed = await confirmDialog.ask({
    title: '清空全部平台限额',
    message: '保存后五个平台的每日、每周、每月限额都将变为不限额；当前用量不会被重置。',
    confirmText: '清空草稿',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  quotaRows.value.forEach((row) => {
    row.daily_limit_usd = null
    row.weekly_limit_usd = null
    row.monthly_limit_usd = null
  })
  app.showSuccess('限额草稿已清空，点击“保存平台额度”后生效')
}

async function saveQuotas(): Promise<void> {
  if (!props.user || busy.value) return
  const invalid = quotaRows.value.flatMap((row) => [
    ['daily', row.daily_limit_usd], ['weekly', row.weekly_limit_usd], ['monthly', row.monthly_limit_usd]
  ].filter(([, value]) => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
    .map(([window]) => `${row.platform}.${window}`))
  if (invalid.length > 0) {
    app.showError(`以下限额不是有效的非负数：${invalid.join('、')}`)
    return
  }
  const payload: PlatformQuotaUpdateItem[] = quotaRows.value.map((row) => ({
    platform: row.platform,
    daily_limit_usd: normalizeQuotaLimit(row.daily_limit_usd),
    weekly_limit_usd: normalizeQuotaLimit(row.weekly_limit_usd),
    monthly_limit_usd: normalizeQuotaLimit(row.monthly_limit_usd)
  }))
  busy.value = true
  try {
    const response = await usersAPI.updatePlatformQuotas(props.user.id, payload)
    quotaRows.value = normalizeQuotaRows(response.platform_quotas || [])
    app.showSuccess('平台额度已保存')
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '平台额度保存失败')
  } finally {
    busy.value = false
  }
}

async function changeStatus(): Promise<void> {
  if (!props.user || props.user.role === AdminUserRole.ADMIN || busy.value) return
  const next = props.user.status === AdminUserStatus.ACTIVE ? AdminUserStatus.DISABLED : AdminUserStatus.ACTIVE
  const confirmed = await confirmDialog.ask({
    title: next === AdminUserStatus.DISABLED ? '停用用户' : '恢复用户',
    message: next === AdminUserStatus.DISABLED
      ? '停用后该用户无法继续登录或使用 API，可随时恢复。'
      : '恢复后该用户可重新登录并使用已有 API Key。',
    confirmText: next === AdminUserStatus.DISABLED ? '确认停用' : '确认恢复',
    tone: next === AdminUserStatus.DISABLED ? ConfirmTone.DANGER : ConfirmTone.DEFAULT
  })
  if (!confirmed) return
  busy.value = true
  try {
    await usersAPI.toggleStatus(props.user.id, next)
    app.showSuccess(next === AdminUserStatus.DISABLED ? '用户已停用' : '用户已恢复')
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '用户状态更新失败')
  } finally {
    busy.value = false
  }
}

async function deleteUser(): Promise<void> {
  if (!props.user || props.user.role === AdminUserRole.ADMIN || busy.value) return
  const confirmed = await confirmDialog.ask({
    title: `删除 ${props.user.email}`,
    message: '该操作会删除用户账户并终止其访问；历史账务和审计记录仍由后端策略保留。',
    confirmText: '确认删除',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  busy.value = true
  try {
    await usersAPI.deleteUser(props.user.id)
    app.showSuccess('用户已删除')
    emit('deleted')
    emit('close')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '用户删除失败')
  } finally {
    busy.value = false
  }
}

watch([() => props.show, () => props.user?.id], ([show]) => {
  if (!show || !props.user) return
  activeTab.value = props.initialTab
  initializeUser(props.user)
  apiKeys.value = []
  history.value = []
  quotaRows.value = []
  void loadGroups()
  loadActiveTab()
}, { immediate: true })

watch(() => props.initialTab, (tab) => {
  if (!props.show) return
  activeTab.value = tab
  loadActiveTab()
})

watch(activeTab, loadActiveTab)
watch(historyType, () => { historyPage.value = 1; void loadHistory(1) })
</script>

<template>
  <Teleport to="body">
    <div v-if="show && user" class="user-drawer-backdrop" role="presentation" @mousedown.self="emit('close')">
      <aside ref="drawer" class="user-drawer" role="dialog" aria-modal="true" aria-labelledby="user-drawer-title" tabindex="-1">
        <header class="drawer-header">
          <div class="user-identity">
            <span aria-hidden="true">{{ user.email.charAt(0).toUpperCase() }}</span>
            <div><p>#{{ user.id }} · {{ user.role === AdminUserRole.ADMIN ? '管理员' : '普通用户' }}</p><h2 id="user-drawer-title">{{ user.email }}</h2><small>{{ user.username || '未设置用户名' }} · {{ user.status === AdminUserStatus.ACTIVE ? '正常' : '已停用' }}</small></div>
          </div>
          <button type="button" class="drawer-close" aria-label="关闭用户工作台" @click="emit('close')">×</button>
        </header>

        <nav class="drawer-tabs" aria-label="用户工作台模块">
          <button v-for="tab in tabs" :key="tab.key" type="button" :class="{ 'is-active': activeTab === tab.key }" @click="activeTab = tab.key"><strong>{{ tab.label }}</strong><small>{{ tab.hint }}</small></button>
        </nav>

        <div class="drawer-body">
          <section v-if="activeTab === UserPanelTab.PROFILE" class="workspace-section">
            <header><div><p>基础资料</p><h3>身份、权限与自定义字段</h3></div><button type="button" class="button button--primary compact-button" :disabled="busy" @click="saveProfile">{{ busy ? '保存中…' : '保存资料' }}</button></header>
            <div class="form-grid">
              <label class="field wide"><span>邮箱 *</span><input v-model="profile.email" type="email" required></label>
              <label class="field"><span>用户名</span><input v-model="profile.username" maxlength="64"></label>
              <label class="field"><span>角色</span><select v-model="profile.role"><option :value="AdminUserRole.USER">普通用户</option><option :value="AdminUserRole.ADMIN">管理员</option></select></label>
              <label class="field"><span>并发上限</span><input v-model.number="profile.concurrency" type="number" min="1" step="1"></label>
              <label class="field"><span>RPM 上限</span><input v-model.number="profile.rpmLimit" type="number" min="0" step="1"><small>0 表示不限。</small></label>
              <label class="field wide"><span>新密码</span><div class="inline-control"><input v-model="profile.password" type="text" autocomplete="off" placeholder="留空则不修改"><button type="button" @click="generatePassword">生成</button><button type="button" :disabled="!profile.password" @click="copyPassword">复制</button></div></label>
              <label class="field wide"><span>管理员备注</span><textarea v-model="profile.notes" rows="3" maxlength="1000"></textarea></label>
            </div>

            <div class="subsection-heading"><div><p>自定义属性</p><h4>{{ enabledAttributes.length ? '随用户资料一并保存' : '尚未配置可用属性' }}</h4></div><span v-if="loadingProfile">加载中…</span></div>
            <div v-if="enabledAttributes.length" class="form-grid">
              <label v-for="definition in enabledAttributes" :key="definition.id" class="field" :class="{ wide: definition.type === UserAttributeTypeCode.TEXTAREA }">
                <span>{{ definition.name }}<template v-if="definition.required"> *</template></span>
                <textarea v-if="definition.type === UserAttributeTypeCode.TEXTAREA" v-model="attributeDraft[definition.id] as string" rows="3" :placeholder="definition.placeholder"></textarea>
                <select v-else-if="definition.type === UserAttributeTypeCode.SELECT" v-model="attributeDraft[definition.id] as string"><option value="">未选择</option><option v-for="option in definition.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
                <select v-else-if="definition.type === UserAttributeTypeCode.MULTI_SELECT" v-model="attributeDraft[definition.id] as string[]" multiple><option v-for="option in definition.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
                <input v-else v-model="attributeDraft[definition.id] as string" :type="definition.type" :placeholder="definition.placeholder">
                <small v-if="definition.description">{{ definition.description }}</small>
              </label>
            </div>

            <div class="danger-zone">
              <div><strong>账户状态</strong><p v-if="user.role === AdminUserRole.ADMIN">管理员账户不能在用户列表中停用或删除。</p><p v-else>状态变更可恢复；删除操作需要再次确认。</p></div>
              <div v-if="user.role !== AdminUserRole.ADMIN"><button type="button" :disabled="busy" @click="changeStatus">{{ user.status === AdminUserStatus.ACTIVE ? '停用用户' : '恢复用户' }}</button><button type="button" class="danger" :disabled="busy" @click="deleteUser">删除用户</button></div>
            </div>
          </section>

          <section v-else-if="activeTab === UserPanelTab.ACCESS" class="workspace-section">
            <header><div><p>访问控制</p><h3>授权分组与用户专属倍率</h3></div><button type="button" class="button button--primary compact-button" :disabled="busy || loadingAccess" @click="saveAccess">{{ busy ? '保存中…' : '保存访问配置' }}</button></header>
            <div class="notice"><strong>公共分组始终可访问</strong><span>公共分组不能取消授权，但仍可设置用户专属倍率；专属分组可独立授权。</span></div>
            <div class="access-grid">
              <article v-for="group in standardGroups" :key="group.id" :class="{ 'is-selected': !group.is_exclusive || allowedGroupIds.includes(group.id) }">
                <label><input v-if="group.is_exclusive" type="checkbox" :checked="allowedGroupIds.includes(group.id)" @change="toggleAllowedGroup(group.id)"><span v-else class="public-check" aria-label="公共分组始终授权">✓</span><span><strong>{{ group.name }}</strong><small>{{ group.platform }} · {{ group.is_exclusive ? '专属' : '公共' }} · 默认 {{ group.rate_multiplier }}×</small></span></label>
                <label class="rate-field"><span>专属倍率</span><input v-model="groupRateDraft[group.id]" type="number" min="0.000001" step="any" :placeholder="`${group.rate_multiplier}`"></label>
              </article>
              <p v-if="!loadingAccess && standardGroups.length === 0" class="empty-block">暂无启用的标准分组。</p>
            </div>
            <div class="replace-card">
              <div><p>替换专属分组</p><h4>同时迁移绑定旧分组的 API Key</h4></div>
              <select v-model="replaceOldGroupId"><option :value="null">选择当前分组</option><option v-for="group in currentExclusiveGroups" :key="group.id" :value="group.id">{{ group.name }}</option></select>
              <span aria-hidden="true">→</span>
              <select v-model="replaceNewGroupId"><option :value="null">选择目标分组</option><option v-for="group in replacementTargets" :key="group.id" :value="group.id">{{ group.name }}</option></select>
              <button type="button" :disabled="!replaceOldGroupId || !replaceNewGroupId || busy" @click="replaceGroup">执行替换</button>
            </div>
          </section>

          <section v-else-if="activeTab === UserPanelTab.KEYS" class="workspace-section">
            <header><div><p>API Key</p><h3>密钥状态与分组归属</h3></div><button type="button" class="quiet-button" :disabled="loadingKeys" @click="loadKeys">刷新</button></header>
            <div v-if="loadingKeys" class="empty-block">正在加载 API Key…</div>
            <div v-else-if="apiKeys.length === 0" class="empty-block">该用户尚未创建 API Key。</div>
            <div v-else class="key-list">
              <article v-for="key in apiKeys" :key="key.id">
                <div class="key-main"><span :class="['status-dot', `is-${key.status}`]"></span><div><strong>{{ key.name }}</strong><code>{{ maskedKey(key.key) }}</code></div></div>
                <div class="key-facts"><span>状态 <strong>{{ key.status }}</strong></span><span>配额 <strong>{{ key.quota ? `${formatMoney(key.quota_used)} / ${formatMoney(key.quota)}` : '不限' }}</strong></span><span>创建 <strong>{{ formatDateTime(key.created_at) }}</strong></span></div>
                <label><span>绑定分组</span><select :value="key.group_id ?? ''" :disabled="updatingKeyIds.has(key.id)" @change="changeKeyGroup(key, ($event.target as HTMLSelectElement).value)"><option value="">不绑定</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.platform }}</option></select></label>
              </article>
            </div>
          </section>

          <section v-else-if="activeTab === UserPanelTab.FINANCE" class="workspace-section">
            <header><div><p>资金账户</p><h3>{{ formatMoney(adjustedBalance) }} 当前余额</h3></div><span class="recharged">累计充值 {{ formatMoney(totalRecharged) }}</span></header>
            <div class="balance-editor">
              <div class="segmented"><button type="button" :class="{ 'is-active': balanceOperation === BalanceOperation.ADD }" @click="balanceOperation = BalanceOperation.ADD">充值</button><button type="button" :class="{ 'is-active': balanceOperation === BalanceOperation.SUBTRACT }" @click="balanceOperation = BalanceOperation.SUBTRACT">扣减</button></div>
              <label class="field"><span>金额（USD）</span><input v-model="balanceAmount" type="number" min="0" step="any"></label>
              <label class="field wide"><span>操作备注</span><textarea v-model="balanceNotes" rows="2" placeholder="记录原因，便于审计"></textarea></label>
              <div class="balance-preview"><span>操作后余额</span><strong>{{ formatMoney(projectedBalance) }}</strong><button v-if="balanceOperation === BalanceOperation.SUBTRACT" type="button" @click="balanceAmount = adjustedBalance">扣减全部</button></div>
              <button type="button" class="button button--primary compact-button" :disabled="busy" @click="updateBalance">{{ busy ? '提交中…' : '确认调整' }}</button>
            </div>
            <div class="history-toolbar"><div><p>资金与权益流水</p><span>共 {{ historyTotal }} 条</span></div><select v-model="historyType"><option :value="BalanceHistoryType.ALL">全部类型</option><option :value="BalanceHistoryType.BALANCE">充值码</option><option :value="BalanceHistoryType.AFFILIATE_BALANCE">推广余额</option><option :value="BalanceHistoryType.ADMIN_BALANCE">管理员余额调整</option><option :value="BalanceHistoryType.CONCURRENCY">并发权益</option><option :value="BalanceHistoryType.ADMIN_CONCURRENCY">管理员并发调整</option><option :value="BalanceHistoryType.SUBSCRIPTION">订阅权益</option></select></div>
            <div v-if="loadingFinance" class="empty-block">正在加载流水…</div>
            <div v-else-if="history.length === 0" class="empty-block">当前筛选下没有流水。</div>
            <div v-else class="history-list"><article v-for="item in history" :key="item.id"><div><strong>{{ item.type }}</strong><small>{{ item.notes || item.code || '无备注' }}</small></div><span :class="{ positive: item.value > 0, negative: item.value < 0 }">{{ item.value > 0 ? '+' : '' }}{{ item.value }}</span><time>{{ formatDateTime(item.created_at) }}</time></article></div>
            <div class="pager"><button type="button" :disabled="historyPage <= 1 || loadingFinance" @click="loadHistory(historyPage - 1)">上一页</button><span>{{ historyPage }} / {{ historyPages }}</span><button type="button" :disabled="historyPage >= historyPages || loadingFinance" @click="loadHistory(historyPage + 1)">下一页</button></div>
          </section>

          <section v-else class="workspace-section">
            <header><div><p>平台额度</p><h3>五个平台 × 三种结算周期</h3></div><div class="header-actions"><button type="button" class="quiet-button danger-text" :disabled="loadingQuotas" @click="clearAllQuotaLimits">清空限额</button><button type="button" class="button button--primary compact-button" :disabled="busy || loadingQuotas" @click="saveQuotas">{{ busy ? '保存中…' : '保存平台额度' }}</button></div></header>
            <div v-if="hasActiveSubscription" class="warning-notice">该用户存在生效中的订阅。平台额度与订阅额度会分别计算，请确认业务预期后再修改。</div>
            <div v-if="loadingQuotas" class="empty-block">正在加载平台额度…</div>
            <div v-else class="quota-table-wrap"><table><thead><tr><th>平台</th><th>每日限额 / 用量</th><th>每周限额 / 用量</th><th>每月限额 / 用量</th></tr></thead><tbody><tr v-for="row in quotaRows" :key="row.platform"><th>{{ row.platform }}</th><td><div><input v-model.number="row.daily_limit_usd" type="number" min="0" step="0.01" placeholder="不限"><span>{{ formatMoney(row.daily_usage_usd) }}</span><button type="button" :disabled="resettingQuota[`${row.platform}.${PlatformQuotaWindow.DAILY}`]" @click="resetQuota(row.platform, PlatformQuotaWindow.DAILY)">重置</button></div></td><td><div><input v-model.number="row.weekly_limit_usd" type="number" min="0" step="0.01" placeholder="不限"><span>{{ formatMoney(row.weekly_usage_usd) }}</span><button type="button" :disabled="resettingQuota[`${row.platform}.${PlatformQuotaWindow.WEEKLY}`]" @click="resetQuota(row.platform, PlatformQuotaWindow.WEEKLY)">重置</button></div></td><td><div><input v-model.number="row.monthly_limit_usd" type="number" min="0" step="0.01" placeholder="不限"><span>{{ formatMoney(row.monthly_usage_usd) }}</span><button type="button" :disabled="resettingQuota[`${row.platform}.${PlatformQuotaWindow.MONTHLY}`]" @click="resetQuota(row.platform, PlatformQuotaWindow.MONTHLY)">重置</button></div></td></tr></tbody></table><p>空值表示不限额；保存限额不会重置当前周期用量。</p></div>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
  <TotpStepUpDialog :controller="stepUp" />
</template>

<style scoped>
.user-drawer-backdrop { position: fixed; z-index: 90; inset: 0; display: flex; justify-content: flex-end; background: color-mix(in srgb, #090810 44%, transparent); backdrop-filter: blur(3px); }
.user-drawer { width: min(1040px, calc(100vw - 92px)); height: 100vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr); color: var(--text-primary); background: var(--surface-canvas); border-left: 1px solid var(--border-subtle); box-shadow: -24px 0 80px rgba(12, 10, 20, .18); }
.drawer-header { padding: 22px 28px; display: flex; align-items: center; justify-content: space-between; gap: 20px; background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle); }
.user-identity { min-width: 0; display: flex; align-items: center; gap: 13px; }
.user-identity > span { width: 42px; height: 42px; flex: 0 0 auto; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 12px; font-weight: 780; }
.user-identity div { min-width: 0; }
.user-identity p, .workspace-section header p, .subsection-heading p, .replace-card p, .history-toolbar p { margin: 0 0 4px; color: var(--text-secondary); font-size: var(--font-meta); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.user-identity h2 { margin: 0; overflow: hidden; font-size: 19px; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
.user-identity small { color: var(--text-secondary); font-size: var(--font-meta); }
.drawer-close { width: 36px; height: 36px; flex: 0 0 auto; color: var(--text-secondary); background: var(--surface-canvas); border: 0; border-radius: 10px; cursor: pointer; font-size: 21px; }
.drawer-tabs { padding: 0 28px; display: flex; gap: 3px; overflow-x: auto; background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle); }
.drawer-tabs button { min-width: 110px; padding: 13px 14px 12px; display: grid; gap: 3px; color: var(--text-secondary); background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; text-align: left; }
.drawer-tabs button strong { font-size: var(--font-body-sm); }.drawer-tabs button small { font-size: var(--font-meta); }.drawer-tabs button.is-active { color: var(--text-primary); border-bottom-color: var(--accent); }
.drawer-body { padding: clamp(22px, 3vw, 36px); overflow-y: auto; }
.workspace-section { display: grid; gap: 22px; }.workspace-section > header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }.workspace-section h3 { margin: 0; font-size: clamp(20px, 2.3vw, 28px); letter-spacing: -.04em; }
.compact-button { min-height: 40px; padding-inline: 14px; border-radius: 10px; font-size: var(--font-body-sm); }.quiet-button, .replace-card button { min-height: 38px; padding: 0 12px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; cursor: pointer; }.header-actions { display: flex; gap: 8px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }.field { display: grid; align-content: start; gap: 7px; color: var(--text-secondary); font-size: var(--font-meta); font-weight: 650; }.field.wide { grid-column: 1 / -1; }.field input, .field select, .field textarea, .replace-card select, .key-list select, .history-toolbar select { width: 100%; min-height: 43px; padding: 0 11px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; }.field textarea { padding-block: 10px; resize: vertical; }.field select[multiple] { min-height: 96px; padding-block: 7px; }.field small { font-size: var(--font-meta); font-weight: 500; }
.inline-control { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 7px; }.inline-control button { padding: 0 11px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; cursor: pointer; }
.subsection-heading { padding-top: 20px; display: flex; justify-content: space-between; border-top: 1px solid var(--border-subtle); }.subsection-heading h4, .replace-card h4 { margin: 0; font-size: 14px; }.subsection-heading span { color: var(--text-secondary); font-size: var(--font-meta); }
.danger-zone { padding: 17px; display: flex; align-items: center; justify-content: space-between; gap: 16px; background: color-mix(in srgb, var(--danger) 5%, var(--surface-raised)); border: 1px solid color-mix(in srgb, var(--danger) 22%, var(--border-subtle)); border-radius: 12px; }.danger-zone strong { font-size: 12px; }.danger-zone p { margin: 4px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.danger-zone > div:last-child { display: flex; gap: 7px; }.danger-zone button { min-height: 36px; padding: 0 11px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; }.danger-zone button.danger, .danger-text { color: var(--danger); }
.notice, .warning-notice { padding: 13px 15px; display: grid; gap: 4px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; font-size: var(--font-meta); }.notice strong { color: var(--text-primary); font-size: var(--font-body-sm); }.warning-notice { color: #916211; background: color-mix(in srgb, #f3b946 10%, var(--surface-raised)); border-color: color-mix(in srgb, #f3b946 38%, var(--border-subtle)); }
.access-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }.access-grid article { padding: 14px; display: grid; grid-template-columns: minmax(0, 1fr) 120px; align-items: center; gap: 13px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; }.access-grid article.is-selected { border-color: color-mix(in srgb, var(--accent) 48%, var(--border-subtle)); box-shadow: inset 3px 0 var(--accent); }.access-grid article > label:first-child { display: flex; align-items: flex-start; gap: 9px; cursor: pointer; }.access-grid label span { display: grid; gap: 3px; }.access-grid strong { font-size: var(--font-body-sm); }.access-grid small { color: var(--text-secondary); font-size: var(--font-meta); }.rate-field { display: grid; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); }.rate-field input { width: 100%; min-height: 35px; padding: 0 8px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; }
.access-grid .public-check { width: 14px; height: 14px; flex: 0 0 auto; display: grid; place-content: center; color: white; background: var(--success); border-radius: 4px; font-size: var(--font-meta); }
.replace-card { padding: 17px; display: grid; grid-template-columns: minmax(150px, 1fr) minmax(130px, .8fr) auto minmax(130px, .8fr) auto; align-items: center; gap: 10px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.replace-card select { min-width: 0; }.replace-card button:disabled { opacity: .45; }
.empty-block { min-height: 130px; margin: 0; display: grid; place-content: center; color: var(--text-secondary); background: var(--surface-raised); border: 1px dashed var(--border-subtle); border-radius: 12px; font-size: var(--font-body-sm); text-align: center; }
.key-list { display: grid; gap: 9px; }.key-list article { padding: 16px; display: grid; grid-template-columns: minmax(220px, 1.3fr) minmax(260px, 1fr) minmax(180px, .75fr); align-items: center; gap: 18px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.key-main { min-width: 0; display: flex; align-items: center; gap: 10px; }.status-dot { width: 8px; height: 8px; flex: 0 0 auto; background: var(--text-secondary); border-radius: 50%; }.status-dot.is-active { background: var(--success); }.status-dot.is-inactive, .status-dot.is-expired, .status-dot.is-quota_exhausted { background: var(--danger); }.key-main div { min-width: 0; display: grid; gap: 5px; }.key-main strong { font-size: var(--font-body-sm); }.key-main code { overflow: hidden; color: var(--text-secondary); font-size: var(--font-meta); text-overflow: ellipsis; }.key-facts { display: flex; flex-wrap: wrap; gap: 9px 15px; color: var(--text-secondary); font-size: var(--font-meta); }.key-facts span { display: grid; gap: 3px; }.key-facts strong { color: var(--text-primary); font-size: var(--font-meta); }.key-list article > label { display: grid; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); }
.recharged { color: var(--text-secondary); font-size: var(--font-meta); }.balance-editor { padding: 17px; display: grid; grid-template-columns: auto minmax(160px, 1fr) auto; align-items: end; gap: 12px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.balance-editor .wide { grid-column: 1 / -1; }.segmented { padding: 3px; display: flex; background: var(--surface-canvas); border-radius: 9px; }.segmented button { min-height: 36px; padding: 0 13px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 7px; cursor: pointer; }.segmented button.is-active { color: var(--text-primary); background: var(--surface-raised); box-shadow: 0 1px 3px rgba(20, 16, 30, .1); }.balance-preview { min-width: 154px; padding: 8px 10px; display: grid; gap: 3px; background: var(--surface-canvas); border-radius: 9px; }.balance-preview span { color: var(--text-secondary); font-size: var(--font-meta); }.balance-preview strong { font-size: 13px; }.balance-preview button { padding: 0; width: max-content; color: var(--accent); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }
.history-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 15px; }.history-toolbar div { display: flex; align-items: baseline; gap: 8px; }.history-toolbar p { color: var(--text-primary); font-size: var(--font-body-sm); }.history-toolbar span { color: var(--text-secondary); font-size: var(--font-meta); }.history-toolbar select { width: 190px; min-height: 38px; }.history-list { display: grid; gap: 1px; background: var(--border-subtle); border: 1px solid var(--border-subtle); }.history-list article { padding: 11px 13px; display: grid; grid-template-columns: minmax(0, 1fr) 100px 150px; align-items: center; gap: 12px; background: var(--surface-raised); }.history-list article > div { min-width: 0; display: grid; gap: 3px; }.history-list strong { font-size: var(--font-meta); }.history-list small, .history-list time { color: var(--text-secondary); font-size: var(--font-meta); }.history-list > article > span { text-align: right; font-size: var(--font-body-sm); font-weight: 700; }.history-list .positive { color: var(--success); }.history-list .negative { color: var(--danger); }.pager { display: flex; align-items: center; justify-content: center; gap: 12px; }.pager button { min-height: 34px; padding: 0 10px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; }.pager span { color: var(--text-secondary); font-size: var(--font-meta); }
.quota-table-wrap { overflow-x: auto; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.quota-table-wrap table { width: 100%; border-collapse: collapse; }.quota-table-wrap th, .quota-table-wrap td { padding: 12px; border-bottom: 1px solid var(--border-subtle); text-align: left; }.quota-table-wrap thead th { color: var(--text-secondary); font-size: var(--font-meta); letter-spacing: .04em; }.quota-table-wrap tbody th { font-size: var(--font-meta); text-transform: capitalize; }.quota-table-wrap td > div { min-width: 150px; display: grid; grid-template-columns: 78px 1fr auto; align-items: center; gap: 7px; }.quota-table-wrap input { min-width: 0; min-height: 34px; padding: 0 7px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; }.quota-table-wrap td span { color: var(--text-secondary); font-size: var(--font-meta); }.quota-table-wrap td button { padding: 0; color: var(--accent); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }.quota-table-wrap > p { margin: 0; padding: 11px 13px; color: var(--text-secondary); font-size: var(--font-meta); }
button:disabled { cursor: not-allowed; opacity: .55; }
@media (max-width: 900px) { .user-drawer { width: 100vw; }.access-grid { grid-template-columns: 1fr; }.replace-card { grid-template-columns: 1fr 1fr; }.replace-card > div { grid-column: 1 / -1; }.replace-card > span { display: none; }.replace-card button { grid-column: 1 / -1; }.key-list article { grid-template-columns: 1fr 1fr; }.key-list article > label { grid-column: 1 / -1; }.quota-table-wrap td > div { grid-template-columns: 74px 1fr; }.quota-table-wrap td button { grid-column: 1 / -1; } }
@media (max-width: 620px) { .drawer-header, .drawer-tabs { padding-inline: 18px; }.drawer-body { padding: 18px; }.drawer-tabs button { min-width: 92px; }.form-grid { grid-template-columns: 1fr; }.field.wide { grid-column: auto; }.workspace-section > header { align-items: flex-start; flex-direction: column; }.workspace-section > header .compact-button { width: 100%; }.access-grid article, .key-list article, .balance-editor { grid-template-columns: 1fr; }.replace-card { grid-template-columns: 1fr; }.replace-card > div, .replace-card button { grid-column: auto; }.danger-zone { align-items: flex-start; flex-direction: column; }.history-list article { grid-template-columns: 1fr auto; }.history-list time { grid-column: 1 / -1; }.header-actions { width: 100%; }.header-actions .compact-button { flex: 1; } }
</style>
