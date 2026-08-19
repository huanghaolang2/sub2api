<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as groupsAPI from '@shared-api/admin/groups'
import type { AdminGroup, CreateGroupRequest, GroupPlatform, UpdateGroupRequest } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import GroupEditorDialog from '@/components/admin/groups/GroupEditorDialog.vue'
import GroupCompositeRoutesDialog from '@/components/admin/groups/GroupCompositeRoutesDialog.vue'
import GroupDetailDialog from '@/components/admin/groups/GroupDetailDialog.vue'
import GroupSortDialog from '@/components/admin/groups/GroupSortDialog.vue'
import GroupUserOverridesDialog from '@/components/admin/groups/GroupUserOverridesDialog.vue'
import { GroupOverrideMode, GroupPlatformOption, ResourceStatus, SortDirection, formatResourceDate, groupPlatformOptions, platformName } from '@/features/admin/resources/model'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'

enum GroupColumn {
  PLATFORM = 'platform',
  BILLING = 'billing',
  ACCESS = 'access',
  ACCOUNTS = 'accounts',
  USAGE = 'usage',
  CAPACITY = 'capacity',
  RATE = 'rate',
  UPDATED = 'updated'
}

enum GroupSortField {
  ORDER = 'sort_order',
  NAME = 'name',
  PLATFORM = 'platform',
  UPDATED = 'updated_at'
}

const PAGE_SIZES = [20, 50, 100]
const COLUMN_KEY = 'frontend2:admin-groups:columns:v2'
const COLUMN_LABELS: Record<GroupColumn, string> = {
  [GroupColumn.PLATFORM]: '平台',
  [GroupColumn.BILLING]: '计费',
  [GroupColumn.ACCESS]: '授权类型',
  [GroupColumn.ACCOUNTS]: '账号',
  [GroupColumn.USAGE]: '用量',
  [GroupColumn.CAPACITY]: '实时容量',
  [GroupColumn.RATE]: '倍率 / RPM',
  [GroupColumn.UPDATED]: '更新时间'
}
const app = useAppStore()
const confirm = useConfirmStore()
const groups = ref<AdminGroup[]>([])
const allGroups = ref<AdminGroup[]>([])
const total = ref(0)
const pages = ref(1)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const error = ref('')
const usage = ref(new Map<number, { today_cost: number; yesterday_cost: number; total_cost: number }>())
const capacity = ref(new Map<number, { concurrency_used: number; concurrency_max: number; sessions_used: number; sessions_max: number; rpm_used: number; rpm_max: number }>())
const filters = reactive({ search: '', platform: '', status: '', exclusive: '' })
const sort = reactive({ by: GroupSortField.ORDER, order: SortDirection.ASC })
const visibleColumns = ref(new Set<GroupColumn>(Object.values(GroupColumn)))
const showColumns = ref(false)
const showEditor = ref(false)
const editing = ref<AdminGroup | null>(null)
const submitting = ref(false)
const showSort = ref(false)
const compositeGroup = ref<AdminGroup | null>(null)
const detailGroup = ref<AdminGroup | null>(null)
const overrideGroup = ref<AdminGroup | null>(null)
const overrideMode = ref(GroupOverrideMode.RATE)
let controller: AbortController | null = null
let timer: number | null = null

const activeCount = computed(() => groups.value.filter((group) => group.status === ResourceStatus.ACTIVE).length)
const accountCount = computed(() => groups.value.reduce((sum, group) => sum + (group.account_count || 0), 0))
const todayCost = computed(() => groups.value.reduce((sum, group) => sum + (usage.value.get(group.id)?.today_cost || 0), 0))
const pageCapacity = computed(() => groups.value.reduce((sum, group) => sum + (capacity.value.get(group.id)?.concurrency_used || 0), 0))

function hasColumn(column: GroupColumn): boolean { return visibleColumns.value.has(column) }
function columnLabel(column: GroupColumn): string { return COLUMN_LABELS[column] }
function toggleColumn(column: GroupColumn): void {
  const next = new Set(visibleColumns.value)
  if (next.has(column)) next.delete(column); else next.add(column)
  visibleColumns.value = next
  try { localStorage.setItem(COLUMN_KEY, JSON.stringify([...next])) } catch { /* optional preference */ }
}
function restoreColumns(): void {
  try { const raw = localStorage.getItem(COLUMN_KEY); if (raw) visibleColumns.value = new Set(JSON.parse(raw) as GroupColumn[]) } catch { /* use defaults */ }
}

async function loadSummaries(): Promise<void> {
  const [usageResult, capacityResult, allResult] = await Promise.allSettled([groupsAPI.getUsageSummary(), groupsAPI.getCapacitySummary(), groupsAPI.getAllIncludingInactive()])
  if (usageResult.status === 'fulfilled') usage.value = new Map(usageResult.value.map((item) => [item.group_id, item]))
  if (capacityResult.status === 'fulfilled') capacity.value = new Map(capacityResult.value.map((item) => [item.group_id, item]))
  if (allResult.status === 'fulfilled') allGroups.value = allResult.value
}

async function load(): Promise<void> {
  controller?.abort(); controller = new AbortController(); const current = controller
  loading.value = true; error.value = ''
  try {
    const response = await groupsAPI.list(page.value, pageSize.value, {
      search: filters.search.trim() || undefined,
      platform: (filters.platform || undefined) as GroupPlatform | undefined,
      status: (filters.status || undefined) as 'active' | 'inactive' | undefined,
      is_exclusive: filters.exclusive === '' ? undefined : filters.exclusive === 'true',
      sort_by: sort.by, sort_order: sort.order
    }, { signal: current.signal })
    total.value = response.total
    pages.value = Math.max(1, response.pages || Math.ceil(response.total / pageSize.value))
    if (page.value > pages.value) {
      page.value = pages.value
      await load()
      return
    }
    groups.value = response.items
    void loadSummaries()
  } catch (caught) {
    if ((caught as { code?: string }).code !== 'ERR_CANCELED') error.value = (caught as { message?: string }).message || '分组加载失败'
  } finally { if (controller === current) loading.value = false }
}

function searchLater(): void { if (timer) window.clearTimeout(timer); timer = window.setTimeout(() => { page.value = 1; void load() }, 280) }
function applyFilter(): void { page.value = 1; void load() }
function setPage(next: number): void { if (next < 1 || next > pages.value) return; page.value = next; void load() }
function setPageSize(): void { page.value = 1; void load() }
function setSort(by: GroupSortField): void {
  if (sort.by === by) sort.order = sort.order === SortDirection.ASC ? SortDirection.DESC : SortDirection.ASC
  else { sort.by = by; sort.order = SortDirection.ASC }
  void load()
}
function sortAria(by: GroupSortField): 'ascending' | 'descending' | 'none' {
  if (sort.by !== by) return 'none'
  return sort.order === SortDirection.ASC ? 'ascending' : 'descending'
}
function sortIndicator(by: GroupSortField): string {
  if (sort.by !== by) return '↕'
  return sort.order === SortDirection.ASC ? '↑' : '↓'
}
function modelPricingCount(group: AdminGroup): number { return (group.model_pricing || []).length }
function authorizationLabel(group: AdminGroup): string { return group.is_exclusive ? '专属' : '公共' }
function statusLabel(group: AdminGroup): string { return group.status === ResourceStatus.ACTIVE ? '启用' : '停用' }
function statusActionLabel(group: AdminGroup): string { return group.status === ResourceStatus.ACTIVE ? '停用' : '启用' }
function openCreate(): void { editing.value = null; showEditor.value = true }
async function openEdit(group: AdminGroup): Promise<void> {
  try {
    editing.value = await groupsAPI.getById(group.id)
    showEditor.value = true
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '分组详情加载失败')
  }
}

async function save(payload: CreateGroupRequest | UpdateGroupRequest): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    if (editing.value) await groupsAPI.update(editing.value.id, payload as UpdateGroupRequest)
    else await groupsAPI.create(payload as CreateGroupRequest)
    app.showSuccess(editing.value ? '分组已更新' : '分组已创建'); showEditor.value = false; await load()
  } catch (caught) { app.showError((caught as { message?: string }).message || '分组保存失败') }
  finally { submitting.value = false }
}

async function duplicate(group: AdminGroup): Promise<void> {
  try { await groupsAPI.duplicate(group.id); app.showSuccess(`已复制 ${group.name}`); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '复制失败') }
}

async function toggleStatus(group: AdminGroup): Promise<void> {
  const next = group.status === ResourceStatus.ACTIVE ? ResourceStatus.INACTIVE : ResourceStatus.ACTIVE
  if (next === ResourceStatus.INACTIVE && !await confirm.ask({ title: '停用分组', message: `停用 ${group.name} 后，该分组不再参与新请求调度。`, confirmText: '停用', tone: ConfirmTone.DANGER })) return
  try { await groupsAPI.toggleStatus(group.id, next); app.showSuccess(next === ResourceStatus.ACTIVE ? '分组已启用' : '分组已停用'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '状态更新失败') }
}

async function remove(group: AdminGroup): Promise<void> {
  if (!await confirm.ask({ title: '删除分组', message: `确认删除 ${group.name}？已绑定资源时后端会拒绝并返回原因。`, confirmText: '删除', tone: ConfirmTone.DANGER })) return
  try { await groupsAPI.deleteGroup(group.id); app.showSuccess('分组已删除'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '删除失败') }
}

function openOverride(group: AdminGroup, mode: GroupOverrideMode): void { overrideGroup.value = group; overrideMode.value = mode }
function capacityText(group: AdminGroup): string {
  const value = capacity.value.get(group.id); if (!value) return '—'
  return `${value.concurrency_used}/${value.concurrency_max || '∞'} 并发 · ${value.rpm_used}/${value.rpm_max || '∞'} RPM`
}

onMounted(() => { restoreColumns(); void load() })
onBeforeUnmount(() => { controller?.abort(); if (timer) window.clearTimeout(timer) })
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading">
        <div>
          <span class="resource-eyebrow">Routing & Billing</span>
          <h1>分组管理</h1>
          <p>授权边界、调度能力与最终计价在同一资源上管理；专属倍率、复合路由和账号容量均可下钻。</p>
        </div>
        <button class="resource-button" data-tour="groups-create-btn" @click="openCreate">创建分组</button>
      </header>
      <section class="resource-summary" aria-label="当前页分组摘要">
        <div><span>当前页 / 总数</span><strong>{{ groups.length }} / {{ total }}</strong></div>
        <div><span>当前页启用</span><strong>{{ activeCount }}</strong></div>
        <div><span>绑定账号</span><strong>{{ accountCount }}</strong></div>
        <div><span>今日费用 / 并发</span><strong>${{ todayCost.toFixed(2) }} · {{ pageCapacity }}</strong></div>
      </section>
      <section class="resource-toolbar" aria-label="分组筛选与操作">
        <div class="resource-toolbar__filters">
          <input v-model="filters.search" type="search" aria-label="搜索分组" placeholder="搜索名称或描述" @input="searchLater" />
          <select v-model="filters.platform" aria-label="平台筛选" @change="applyFilter">
            <option value="">全部平台</option>
            <option v-for="option in groupPlatformOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <select v-model="filters.status" aria-label="状态筛选" @change="applyFilter">
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
          <select v-model="filters.exclusive" aria-label="授权类型筛选" @change="applyFilter">
            <option value="">全部授权类型</option>
            <option value="true">专属</option>
            <option value="false">公共</option>
          </select>
        </div>
        <div class="resource-toolbar__actions">
          <button class="resource-button resource-button--secondary" @click="load">刷新</button>
          <button class="resource-button resource-button--secondary" @click="showSort = true">调整排序</button>
          <div>
            <button
              class="resource-button resource-button--secondary"
              aria-haspopup="true"
              :aria-expanded="showColumns"
              @click="showColumns = !showColumns"
            >列设置</button>
            <div v-if="showColumns" class="column-popover" role="group" aria-label="可见列">
              <label v-for="column in Object.values(GroupColumn)" :key="column">
                <input
                  type="checkbox"
                  :aria-label="columnLabel(column)"
                  :checked="hasColumn(column)"
                  @change="toggleColumn(column)"
                />
                {{ columnLabel(column) }}
              </label>
            </div>
          </div>
        </div>
      </section>

      <PageState :loading="loading" :error="error" :empty="!loading && !error && groups.length === 0" empty-text="没有匹配的分组。" @retry="load">
        <div class="resource-table">
          <table>
            <thead>
              <tr>
                <th :aria-sort="sortAria(GroupSortField.NAME)">
                  <button class="resource-sort-button" aria-label="按分组名称排序" @click="setSort(GroupSortField.NAME)">分组 <span aria-hidden="true">{{ sortIndicator(GroupSortField.NAME) }}</span></button>
                </th>
                <th v-if="hasColumn(GroupColumn.PLATFORM)" :aria-sort="sortAria(GroupSortField.PLATFORM)">
                  <button class="resource-sort-button" aria-label="按平台排序" @click="setSort(GroupSortField.PLATFORM)">平台 <span aria-hidden="true">{{ sortIndicator(GroupSortField.PLATFORM) }}</span></button>
                </th>
                <th v-if="hasColumn(GroupColumn.BILLING)">计费</th>
                <th v-if="hasColumn(GroupColumn.ACCESS)">授权类型</th>
                <th v-if="hasColumn(GroupColumn.ACCOUNTS)">账号</th>
                <th v-if="hasColumn(GroupColumn.USAGE)">用量</th>
                <th v-if="hasColumn(GroupColumn.CAPACITY)">实时容量</th>
                <th v-if="hasColumn(GroupColumn.RATE)">倍率 / RPM</th>
                <th>状态</th>
                <th v-if="hasColumn(GroupColumn.UPDATED)" :aria-sort="sortAria(GroupSortField.UPDATED)">
                  <button class="resource-sort-button" aria-label="按更新时间排序" @click="setSort(GroupSortField.UPDATED)">更新时间 <span aria-hidden="true">{{ sortIndicator(GroupSortField.UPDATED) }}</span></button>
                </th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="group in groups" :key="group.id">
                <td>
                  <button class="resource-link resource-name-link" :aria-label="`查看 ${group.name} 详情`" @click="detailGroup = group">{{ group.name }}</button>
                  <small>#{{ group.id }} · {{ group.description || '无描述' }}</small>
                </td>
                <td v-if="hasColumn(GroupColumn.PLATFORM)"><span class="resource-status">{{ platformName(group.platform) }}</span></td>
                <td v-if="hasColumn(GroupColumn.BILLING)">
                  {{ group.subscription_type === 'subscription' ? '订阅额度' : '标准余额' }}
                  <small>{{ modelPricingCount(group) }} 组模型价格</small>
                </td>
                <td v-if="hasColumn(GroupColumn.ACCESS)"><span class="resource-status">{{ authorizationLabel(group) }}</span></td>
                <td v-if="hasColumn(GroupColumn.ACCOUNTS)">
                  {{ group.active_account_count || 0 }} / {{ group.account_count || 0 }}
                  <small>{{ group.rate_limited_account_count || 0 }} 个限流</small>
                </td>
                <td v-if="hasColumn(GroupColumn.USAGE)">
                  ${{ (usage.get(group.id)?.today_cost || 0).toFixed(2) }} 今日
                  <small>${{ (usage.get(group.id)?.yesterday_cost || 0).toFixed(2) }} 昨日 · ${{ (usage.get(group.id)?.total_cost || 0).toFixed(2) }} 累计</small>
                </td>
                <td v-if="hasColumn(GroupColumn.CAPACITY)">{{ capacityText(group) }}</td>
                <td v-if="hasColumn(GroupColumn.RATE)">
                  {{ group.rate_multiplier }}×
                  <small>{{ group.rpm_limit || '不限' }} RPM</small>
                </td>
                <td>
                  <div class="resource-status-action">
                    <span :class="['resource-status', `resource-status--${group.status}`]">{{ statusLabel(group) }}</span>
                    <button class="resource-link" :aria-label="`${statusActionLabel(group)} ${group.name}`" @click="toggleStatus(group)">{{ statusActionLabel(group) }}</button>
                  </div>
                </td>
                <td v-if="hasColumn(GroupColumn.UPDATED)">{{ formatResourceDate(group.updated_at) }}</td>
                <td>
                  <div class="resource-inline-actions">
                    <button class="resource-link" :aria-label="`编辑 ${group.name}`" @click="openEdit(group)">编辑</button>
                    <button class="resource-link" :aria-label="`复制 ${group.name}`" @click="duplicate(group)">复制</button>
                    <button v-if="group.platform === GroupPlatformOption.COMPOSITE" class="resource-link" :aria-label="`配置 ${group.name} 路由`" @click="compositeGroup = group">路由</button>
                    <button class="resource-link" :aria-label="`配置 ${group.name} 倍率`" @click="openOverride(group, GroupOverrideMode.RATE)">倍率</button>
                    <button class="resource-link" :aria-label="`配置 ${group.name} RPM`" @click="openOverride(group, GroupOverrideMode.RPM)">RPM</button>
                    <button class="resource-link resource-link--danger" :aria-label="`删除 ${group.name}`" @click="remove(group)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageState>
      <footer class="resource-pagination">
        <span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span>
        <div class="resource-pagination__actions">
          <select v-model.number="pageSize" aria-label="每页条数" @change="setPageSize">
            <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }} / 页</option>
          </select>
          <button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="setPage(page - 1)">上一页</button>
          <button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="setPage(page + 1)">下一页</button>
        </div>
      </footer>
    </main>
    <GroupEditorDialog :show="showEditor" :group="editing" :groups="allGroups" :submitting="submitting" @close="showEditor = false" @submit="save" />
    <GroupSortDialog :show="showSort" :groups="allGroups" @close="showSort = false" @saved="load" />
    <GroupDetailDialog :show="Boolean(detailGroup)" :group="detailGroup" @close="detailGroup = null" />
    <GroupCompositeRoutesDialog :show="Boolean(compositeGroup)" :group="compositeGroup" @close="compositeGroup = null" />
    <GroupUserOverridesDialog :show="Boolean(overrideGroup)" :group="overrideGroup" :mode="overrideMode" @close="overrideGroup = null" @saved="load" />
  </ConsoleShell>
</template>

<style scoped>
.column-popover { position: absolute; z-index: 5; right: 0; margin-top: 6px; width: 180px; padding: 10px; display: grid; gap: 7px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; box-shadow: 0 14px 40px rgba(0,0,0,.12); font-size: var(--font-body-sm); }
.resource-toolbar__actions > div { position: relative; }
.resource-name-link { padding-left: 0; color: var(--text-primary); font-size: 13px; }
.resource-sort-button { padding: 0; display: inline-flex; align-items: center; gap: 5px; color: inherit; font: inherit; font-weight: inherit; background: transparent; border: 0; cursor: pointer; }
.resource-sort-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.resource-status-action { display: inline-flex; align-items: center; gap: 8px; }
</style>
