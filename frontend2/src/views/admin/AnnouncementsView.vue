<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import announcementsAPI from '@shared-api/admin/announcements'
import * as groupsAPI from '@shared-api/admin/groups'
import type { AdminGroup, Announcement, AnnouncementCondition, AnnouncementConditionGroup, AnnouncementTargeting, AnnouncementUserReadStatus, CreateAnnouncementRequest, UpdateAnnouncementRequest } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { AnnouncementNotifyMode, AnnouncementStatus, AnnouncementTargetMode, GovernanceSortOrder, datetimeLocalToEpoch, formatGovernanceDate, toDatetimeLocal } from '@/features/admin/governance/model'

const app = useAppStore()
const confirm = useConfirmStore()
const rows = ref<Announcement[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const error = ref('')
const filters = reactive({ search: '', status: '', sortBy: 'created_at', sortOrder: GovernanceSortOrder.DESC })
const groups = ref<AdminGroup[]>([])
const editorOpen = ref(false)
const previewOpen = ref(false)
const readOpen = ref(false)
const editing = ref<Announcement | null>(null)
const viewing = ref<Announcement | null>(null)
const saving = ref(false)
const targetMode = ref(AnnouncementTargetMode.ALL)
const targetGroups = ref<AnnouncementConditionGroup[]>([])
const readRows = ref<AnnouncementUserReadStatus[]>([])
const readTotal = ref(0)
const readPage = ref(1)
const readSearch = ref('')
const readLoading = ref(false)
const form = reactive({ title: '', content: '', status: AnnouncementStatus.DRAFT, notifyMode: AnnouncementNotifyMode.SILENT, startsAt: '', endsAt: '' })
let controller: AbortController | null = null
let searchTimer: number | null = null

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const readPages = computed(() => Math.max(1, Math.ceil(readTotal.value / 20)))
const previewHTML = computed(() => DOMPurify.sanitize(marked.parse(viewing.value?.content || '') as string))
const activeCount = computed(() => rows.value.filter((item) => item.status === AnnouncementStatus.ACTIVE).length)
const popupCount = computed(() => rows.value.filter((item) => item.notify_mode === AnnouncementNotifyMode.POPUP).length)

function blankCondition(): AnnouncementCondition { return { type: 'subscription', operator: 'in', group_ids: [] } }
function addOrGroup(): void { if (targetGroups.value.length < 50) targetGroups.value.push({ all_of: [blankCondition()] }) }
function removeOrGroup(index: number): void { targetGroups.value.splice(index, 1) }
function addCondition(group: AnnouncementConditionGroup): void { if ((group.all_of?.length || 0) < 50) (group.all_of ||= []).push(blankCondition()) }
function removeCondition(group: AnnouncementConditionGroup, index: number): void { group.all_of?.splice(index, 1) }
function changeConditionType(condition: AnnouncementCondition): void {
  if (condition.type === 'subscription') { condition.operator = 'in'; condition.group_ids = []; delete condition.value }
  else { condition.operator = 'gte'; condition.value = 0; delete condition.group_ids }
}

function targetingSummary(targeting: AnnouncementTargeting): string {
  const anyOf = targeting?.any_of || []
  if (!anyOf.length) return '全部用户'
  return `${anyOf.length} 组 OR 条件 · 组内 AND`
}

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  const current = controller
  loading.value = true
  error.value = ''
  try {
    const response = await announcementsAPI.list(page.value, pageSize.value, {
      search: filters.search.trim() || undefined, status: filters.status || undefined,
      sort_by: filters.sortBy, sort_order: filters.sortOrder,
    }, { signal: current.signal })
    rows.value = response.items || []
    total.value = response.total || 0
  } catch (caught) {
    if ((caught as { code?: string }).code !== 'ERR_CANCELED') error.value = (caught as { message?: string }).message || '公告加载失败'
  } finally { if (controller === current) loading.value = false }
}

function searchLater(): void { if (searchTimer) window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { page.value = 1; void load() }, 260) }
function applyFilters(): void { page.value = 1; void load() }
function changeSort(key: string): void {
  filters.sortOrder = filters.sortBy === key && filters.sortOrder === GovernanceSortOrder.DESC ? GovernanceSortOrder.ASC : GovernanceSortOrder.DESC
  filters.sortBy = key
  applyFilters()
}

function resetForm(): void {
  Object.assign(form, { title: '', content: '', status: AnnouncementStatus.DRAFT, notifyMode: AnnouncementNotifyMode.SILENT, startsAt: '', endsAt: '' })
  targetMode.value = AnnouncementTargetMode.ALL
  targetGroups.value = []
}

function openCreate(): void { editing.value = null; resetForm(); editorOpen.value = true }
async function openEdit(item: Announcement): Promise<void> {
  try { editing.value = await announcementsAPI.getById(item.id) } catch { editing.value = item }
  const value = editing.value
  Object.assign(form, { title: value.title, content: value.content, status: value.status, notifyMode: value.notify_mode, startsAt: toDatetimeLocal(value.starts_at), endsAt: toDatetimeLocal(value.ends_at) })
  targetGroups.value = JSON.parse(JSON.stringify(value.targeting?.any_of || [])) as AnnouncementConditionGroup[]
  targetMode.value = targetGroups.value.length ? AnnouncementTargetMode.CUSTOM : AnnouncementTargetMode.ALL
  editorOpen.value = true
}

function validateTargeting(): boolean {
  if (targetMode.value === AnnouncementTargetMode.ALL) return true
  if (!targetGroups.value.length) { app.showError('自定义目标至少需要一组 OR 条件'); return false }
  for (const group of targetGroups.value) {
    if (!group.all_of?.length) { app.showError('每组 OR 条件至少需要一条 AND 条件'); return false }
    for (const condition of group.all_of) {
      if (condition.type === 'subscription' && !condition.group_ids?.length) { app.showError('订阅条件必须选择至少一个订阅分组'); return false }
      if (condition.type === 'balance' && !Number.isFinite(Number(condition.value))) { app.showError('余额条件必须填写有效金额'); return false }
    }
  }
  return true
}

async function save(): Promise<void> {
  if (!form.title.trim() || !form.content.trim() || !validateTargeting()) return
  const targeting: AnnouncementTargeting = { any_of: targetMode.value === AnnouncementTargetMode.ALL ? [] : JSON.parse(JSON.stringify(targetGroups.value)) as AnnouncementConditionGroup[] }
  const common = {
    title: form.title.trim(), content: form.content, status: form.status, notify_mode: form.notifyMode,
    targeting, starts_at: datetimeLocalToEpoch(form.startsAt), ends_at: datetimeLocalToEpoch(form.endsAt),
  }
  saving.value = true
  try {
    if (editing.value) {
      const payload: UpdateAnnouncementRequest = { ...common, starts_at: common.starts_at ?? 0, ends_at: common.ends_at ?? 0 }
      await announcementsAPI.update(editing.value.id, payload)
      app.showSuccess('公告已更新')
    } else {
      const payload: CreateAnnouncementRequest = common
      await announcementsAPI.create(payload)
      app.showSuccess('公告已创建')
    }
    editorOpen.value = false
    await load()
  } catch (caught) { app.showError((caught as { message?: string }).message || '公告保存失败') }
  finally { saving.value = false }
}

async function remove(item: Announcement): Promise<void> {
  if (!await confirm.ask({ title: '删除公告', message: `确认删除“${item.title}”？读取记录也将不可再查看。`, confirmText: '删除', tone: ConfirmTone.DANGER })) return
  try { await announcementsAPI.delete(item.id); app.showSuccess('公告已删除'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '公告删除失败') }
}

function openPreview(item: Announcement): void { viewing.value = item; previewOpen.value = true }
async function openReadStatus(item: Announcement): Promise<void> { viewing.value = item; readPage.value = 1; readSearch.value = ''; readOpen.value = true; await loadReadStatus() }
async function loadReadStatus(): Promise<void> {
  if (!viewing.value) return
  readLoading.value = true
  try {
    const response = await announcementsAPI.getReadStatus(viewing.value.id, readPage.value, 20, { search: readSearch.value.trim() || undefined, sort_by: 'read_at', sort_order: 'desc' })
    readRows.value = response.items || []; readTotal.value = response.total || 0
  } catch (caught) { app.showError((caught as { message?: string }).message || '读取状态加载失败') }
  finally { readLoading.value = false }
}

onMounted(async () => {
  const result = await Promise.allSettled([groupsAPI.getAll(), load()])
  if (result[0].status === 'fulfilled') groups.value = result[0].value.filter((item) => item.subscription_type === 'subscription')
})
onBeforeUnmount(() => { controller?.abort(); if (searchTimer) window.clearTimeout(searchTimer) })
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Audience Messaging</span><h1>公告与内容</h1><p>从草稿、定向、排期、弹窗预览到用户读取状态，都在同一工作台完成。</p></div><button class="resource-button" @click="openCreate">创建公告</button></header>
      <section class="resource-summary"><div><span>总公告</span><strong>{{ total }}</strong></div><div><span>当前页发布中</span><strong>{{ activeCount }}</strong></div><div><span>当前页弹窗提醒</span><strong>{{ popupCount }}</strong></div><div><span>当前页草稿</span><strong>{{ rows.filter((item) => item.status === AnnouncementStatus.DRAFT).length }}</strong></div></section>
      <section class="resource-toolbar"><div class="resource-toolbar__filters"><input v-model="filters.search" type="search" placeholder="搜索标题或内容" @input="searchLater" /><select v-model="filters.status" @change="applyFilters"><option value="">全部状态</option><option :value="AnnouncementStatus.DRAFT">草稿</option><option :value="AnnouncementStatus.ACTIVE">发布中</option><option :value="AnnouncementStatus.ARCHIVED">已归档</option></select></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" @click="load">刷新</button></div></section>
      <PageState :loading="loading" :error="error" :empty="!loading && !error && !rows.length" empty-text="暂无公告，可以先创建一条草稿。" @retry="load"><div class="resource-table"><table><thead><tr><th @click="changeSort('title')">标题 ↕</th><th>目标</th><th>提醒</th><th @click="changeSort('status')">状态 ↕</th><th>生效区间</th><th @click="changeSort('created_at')">更新 ↕</th><th>操作</th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td><strong>{{ item.title }}</strong><small>#{{ item.id }}</small></td><td>{{ targetingSummary(item.targeting) }}</td><td>{{ item.notify_mode === AnnouncementNotifyMode.POPUP ? '弹窗' : '静默' }}</td><td><span :class="['resource-status', item.status === AnnouncementStatus.ACTIVE ? 'resource-status--active' : '']">{{ item.status === AnnouncementStatus.ACTIVE ? '发布中' : item.status === AnnouncementStatus.DRAFT ? '草稿' : '已归档' }}</span></td><td>{{ item.starts_at ? formatGovernanceDate(item.starts_at) : '立即' }}<small>至 {{ item.ends_at ? formatGovernanceDate(item.ends_at) : '长期' }}</small></td><td>{{ formatGovernanceDate(item.updated_at) }}</td><td><div class="resource-inline-actions"><button class="resource-link" @click="openPreview(item)">预览</button><button class="resource-link" @click="openReadStatus(item)">读取状态</button><button class="resource-link" @click="openEdit(item)">编辑</button><button class="resource-link resource-link--danger" @click="remove(item)">删除</button></div></td></tr></tbody></table></div></PageState>
      <footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; load()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; load()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; load()">下一页</button></div></footer>
    </main>

    <SurfaceDialog :show="editorOpen" :title="editing ? '编辑公告' : '创建公告'" description="自定义目标采用 OR 组、组内 AND 的规则；发布前可先保存为草稿并预览。" :width="DialogWidth.WIDE" @close="editorOpen = false">
      <form id="announcement-form" class="resource-form-stack" @submit.prevent="save"><label>标题 *<input v-model="form.title" required maxlength="200" /></label><label>正文（Markdown） *<textarea v-model="form.content" rows="8" required /></label><div class="resource-form-grid resource-form-grid--4"><label>状态<select v-model="form.status"><option :value="AnnouncementStatus.DRAFT">草稿</option><option :value="AnnouncementStatus.ACTIVE">发布中</option><option :value="AnnouncementStatus.ARCHIVED">归档</option></select></label><label>提醒方式<select v-model="form.notifyMode"><option :value="AnnouncementNotifyMode.SILENT">静默</option><option :value="AnnouncementNotifyMode.POPUP">弹窗</option></select></label><label>开始时间<input v-model="form.startsAt" type="datetime-local" /></label><label>结束时间<input v-model="form.endsAt" type="datetime-local" /></label></div>
        <fieldset class="resource-form-section"><legend>目标用户</legend><div class="governance-chip-list"><button type="button" :class="['governance-chip', targetMode === AnnouncementTargetMode.ALL && 'governance-chip--active']" @click="targetMode = AnnouncementTargetMode.ALL">全部用户</button><button type="button" :class="['governance-chip', targetMode === AnnouncementTargetMode.CUSTOM && 'governance-chip--active']" @click="targetMode = AnnouncementTargetMode.CUSTOM; if (!targetGroups.length) addOrGroup()">自定义条件</button></div><template v-if="targetMode === AnnouncementTargetMode.CUSTOM"><article v-for="(group, groupIndex) in targetGroups" :key="groupIndex" class="announcement-condition-group"><header><strong>OR 组 #{{ groupIndex + 1 }}（组内 AND）</strong><button type="button" class="resource-link resource-link--danger" @click="removeOrGroup(groupIndex)">删除组</button></header><div v-for="(condition, conditionIndex) in group.all_of" :key="conditionIndex" class="announcement-condition"><label>条件类型<select v-model="condition.type" @change="changeConditionType(condition)"><option value="subscription">订阅分组</option><option value="balance">余额</option></select></label><template v-if="condition.type === 'subscription'"><label>包含任一分组<select v-model="condition.group_ids" multiple><option v-for="groupOption in groups" :key="groupOption.id" :value="groupOption.id">{{ groupOption.name }}</option></select></label></template><template v-else><label>运算符<select v-model="condition.operator"><option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option><option value="eq">等于</option></select></label><label>余额<input v-model.number="condition.value" type="number" step="0.01" /></label></template><button type="button" class="resource-link resource-link--danger" @click="removeCondition(group, conditionIndex)">移除</button></div><button type="button" class="resource-button resource-button--secondary" @click="addCondition(group)">添加 AND 条件</button></article><button type="button" class="resource-button resource-button--secondary" @click="addOrGroup">添加 OR 组</button></template></fieldset>
      </form><template #footer><button class="button button--secondary" @click="editorOpen = false">取消</button><button type="submit" form="announcement-form" class="button button--primary" :disabled="saving">{{ saving ? '保存中…' : '保存公告' }}</button></template>
    </SurfaceDialog>

    <SurfaceDialog :show="previewOpen" :title="viewing?.title || '公告预览'" :description="viewing ? `${viewing.notify_mode === AnnouncementNotifyMode.POPUP ? '弹窗提醒' : '静默提醒'} · ${targetingSummary(viewing.targeting)}` : ''" :width="DialogWidth.WIDE" @close="previewOpen = false"><article class="announcement-preview" v-html="previewHTML"></article><template #footer><button class="button button--primary" @click="previewOpen = false">关闭预览</button></template></SurfaceDialog>

    <SurfaceDialog :show="readOpen" :title="`读取状态 · ${viewing?.title || ''}`" :description="`覆盖 ${readTotal} 位目标用户，包含未读用户。`" :width="DialogWidth.WIDE" @close="readOpen = false"><div class="resource-toolbar"><div class="resource-toolbar__filters"><input v-model="readSearch" type="search" placeholder="搜索用户邮箱" @keyup.enter="readPage = 1; loadReadStatus()" /></div><button class="resource-button" @click="readPage = 1; loadReadStatus()">查询</button></div><div v-if="readLoading" class="page-state">加载读取状态…</div><div v-else class="resource-table"><table><thead><tr><th>用户</th><th>余额</th><th>是否命中目标</th><th>读取时间</th></tr></thead><tbody><tr v-for="item in readRows" :key="item.user_id"><td>{{ item.username || item.email }}<small>#{{ item.user_id }} · {{ item.email }}</small></td><td>${{ Number(item.balance).toFixed(2) }}</td><td>{{ item.eligible ? '是' : '否' }}</td><td>{{ item.read_at ? formatGovernanceDate(item.read_at) : '未读' }}</td></tr></tbody></table></div><footer class="resource-pagination"><span>第 {{ readPage }} / {{ readPages }} 页</span><div class="resource-pagination__actions"><button class="resource-button resource-button--secondary" :disabled="readPage <= 1" @click="readPage--; loadReadStatus()">上一页</button><button class="resource-button resource-button--secondary" :disabled="readPage >= readPages" @click="readPage++; loadReadStatus()">下一页</button></div></footer></SurfaceDialog>
  </ConsoleShell>
</template>

<style scoped>
.announcement-condition-group { padding: 14px; display: grid; gap: 11px; border: 1px solid var(--border-subtle); border-radius: 12px; }
.announcement-condition-group > header { display: flex; justify-content: space-between; gap: 10px; }
.announcement-condition { padding: 10px; display: grid; grid-template-columns: 140px minmax(160px, 1fr) auto; align-items: end; gap: 9px; background: var(--surface-canvas); border-radius: 10px; }
.announcement-condition select[multiple] { min-height: 90px; }
.announcement-preview { min-height: 220px; line-height: 1.7; }
.announcement-preview :deep(img) { max-width: 100%; }
@media (max-width: 700px) { .announcement-condition { grid-template-columns: 1fr; } }
</style>
