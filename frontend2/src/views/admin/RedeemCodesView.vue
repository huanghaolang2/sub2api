<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import redeemAPI from '@shared-api/admin/redeem'
import * as groupsAPI from '@shared-api/admin/groups'
import type { AdminGroup, BatchUpdateRedeemCodeFields, RedeemCode, RedeemCodeType } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import {
  RedeemCodeStatus,
  RedeemCodeTypeOption,
  SortOrder,
  formatCommerceDate,
  nextSort,
  redeemStatusLabels,
  redeemTypeLabels
} from '@/features/admin/commerce/model'

interface RedeemStats {
  total_codes: number
  active_codes: number
  used_codes: number
  expired_codes: number
  total_value_distributed: number
  by_type: Record<RedeemCodeType, number>
}

const app = useAppStore()
const confirm = useConfirmStore()
const rows = ref<RedeemCode[]>([])
const stats = ref<RedeemStats | null>(null)
const groups = ref<AdminGroup[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const error = ref('')
const filters = reactive({ search: '', type: '', status: '' })
const sort = reactive({ by: 'created_at', order: SortOrder.DESC })
const selected = ref<number[]>([])
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<RedeemCode | null>(null)
const generateOpen = ref(false)
const generating = ref(false)
const generateForm = reactive({ count: 10, type: RedeemCodeTypeOption.BALANCE as RedeemCodeType, value: 10, groupId: '', validityDays: 30, expiresInDays: 0 })
const generated = ref<RedeemCode[]>([])
const resultOpen = ref(false)
const batchOpen = ref(false)
const batchSaving = ref(false)
const batchForm = reactive({ useStatus: false, status: RedeemCodeStatus.UNUSED as 'unused' | 'disabled', useExpiry: false, expiry: '', clearExpiry: false, useNotes: false, notes: '', useGroup: false, groupId: '' })
let timer: number | null = null

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const allSelected = computed(() => rows.value.length > 0 && rows.value.every((item) => selected.value.includes(item.id)))
const subscriptionGroups = computed(() => groups.value.filter((item) => item.subscription_type === 'subscription'))

function requestFilters() {
  return {
    search: filters.search.trim() || undefined,
    type: (filters.type || undefined) as RedeemCodeType | undefined,
    status: (filters.status || undefined) as RedeemCodeStatus | undefined,
    sort_by: sort.by,
    sort_order: sort.order
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await redeemAPI.list(page.value, pageSize.value, requestFilters())
    rows.value = response.items || []
    total.value = response.total || 0
    selected.value = selected.value.filter((id) => rows.value.some((item) => item.id === id))
  } catch (caught) { error.value = (caught as { message?: string }).message || '兑换码加载失败' }
  finally { loading.value = false }
}

async function loadStats(): Promise<void> { try { stats.value = await redeemAPI.getStats() } catch { /* table remains usable */ } }
function refresh(): void { void Promise.all([load(), loadStats()]) }
function applyFilters(): void { page.value = 1; refresh() }
function searchLater(): void { if (timer) window.clearTimeout(timer); timer = window.setTimeout(applyFilters, 280) }
function changeSort(by: string): void { Object.assign(sort, nextSort(sort.by, sort.order, by)); applyFilters() }
function toggle(id: number): void { selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : [...selected.value, id] }
function toggleAll(): void { selected.value = allSelected.value ? [] : rows.value.map((item) => item.id) }
function typeLabel(value: string): string { return redeemTypeLabels[value as RedeemCodeTypeOption] || value }
function statusLabel(value: string): string { return redeemStatusLabels[value as RedeemCodeStatus] || value }

async function copy(value: string): Promise<void> { try { await navigator.clipboard.writeText(value); app.showSuccess('兑换码已复制') } catch { app.showError('复制失败，请检查剪贴板权限') } }

async function openDetail(row: RedeemCode): Promise<void> {
  detail.value = row
  detailOpen.value = true
  detailLoading.value = true
  try { detail.value = await redeemAPI.getById(row.id) }
  catch (caught) { app.showError((caught as { message?: string }).message || '兑换码详情加载失败') }
  finally { detailLoading.value = false }
}

function openGenerate(): void { Object.assign(generateForm, { count: 10, type: RedeemCodeTypeOption.BALANCE, value: 10, groupId: '', validityDays: 30, expiresInDays: 0 }); generateOpen.value = true }
async function submitGenerate(): Promise<void> {
  if (!Number.isInteger(generateForm.count) || generateForm.count < 1 || generateForm.count > 1000) { app.showError('一次生成数量需为 1–1000'); return }
  if (generateForm.type === RedeemCodeTypeOption.SUBSCRIPTION && !generateForm.groupId) { app.showError('订阅兑换码必须选择分组'); return }
  if (generateForm.type !== RedeemCodeTypeOption.INVITATION && Number(generateForm.value) <= 0) { app.showError('兑换值必须大于 0'); return }
  generating.value = true
  try {
    generated.value = await redeemAPI.generate(generateForm.count, generateForm.type, Number(generateForm.value), generateForm.groupId ? Number(generateForm.groupId) : undefined, generateForm.type === RedeemCodeTypeOption.SUBSCRIPTION ? Number(generateForm.validityDays) : undefined, Number(generateForm.expiresInDays) || null)
    generateOpen.value = false
    resultOpen.value = true
    app.showSuccess(`已生成 ${generated.value.length} 个兑换码`)
    refresh()
  } catch (caught) { app.showError((caught as { message?: string }).message || '兑换码生成失败') }
  finally { generating.value = false }
}

async function copyGenerated(): Promise<void> { await copy(generated.value.map((item) => item.code).join('\n')) }
function downloadGenerated(): void { const blob = new Blob([generated.value.map((item) => item.code).join('\n')], { type: 'text/plain;charset=utf-8' }); downloadBlob(blob, `redeem-codes-${new Date().toISOString().slice(0, 10)}.txt`) }
function downloadBlob(blob: Blob, filename: string): void { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url) }

async function exportCodes(): Promise<void> {
  const exportFilters = {
    search: filters.search.trim() || undefined,
    type: (filters.type || undefined) as RedeemCodeType | undefined,
    status: (filters.status || undefined) as 'used' | 'expired' | 'unused' | 'disabled' | undefined,
    sort_by: sort.by,
    sort_order: sort.order
  }
  try { const blob = await redeemAPI.exportCodes(exportFilters); downloadBlob(blob, `redeem-codes-${new Date().toISOString().slice(0, 10)}.csv`); app.showSuccess('兑换码 CSV 已下载') }
  catch (caught) { app.showError((caught as { message?: string }).message || '导出失败') }
}

async function expire(row: RedeemCode): Promise<void> {
  if (!await confirm.ask({ title: '立即过期兑换码', message: `让 ${row.code} 立即失效？该操作不会删除历史使用记录。`, confirmText: '立即过期', tone: ConfirmTone.DANGER })) return
  try { await redeemAPI.expire(row.id); app.showSuccess('兑换码已过期'); refresh() }
  catch (caught) { app.showError((caught as { message?: string }).message || '过期操作失败') }
}

async function remove(row: RedeemCode): Promise<void> {
  if (!await confirm.ask({ title: '删除兑换码', message: `永久删除 ${row.code}？`, confirmText: '删除', tone: ConfirmTone.DANGER })) return
  try { await redeemAPI.delete(row.id); app.showSuccess('兑换码已删除'); refresh() }
  catch (caught) { app.showError((caught as { message?: string }).message || '删除失败') }
}

async function batchDelete(): Promise<void> {
  if (!selected.value.length || !await confirm.ask({ title: '批量删除兑换码', message: `永久删除选中的 ${selected.value.length} 个兑换码？`, confirmText: '批量删除', tone: ConfirmTone.DANGER })) return
  try { const response = await redeemAPI.batchDelete(selected.value); app.showSuccess(`已删除 ${response.deleted} 个兑换码`); selected.value = []; refresh() }
  catch (caught) { app.showError((caught as { message?: string }).message || '批量删除失败') }
}

async function deleteAllUnused(): Promise<void> {
  if (!await confirm.ask({ title: '删除全部未使用兑换码', message: '将跨分页删除所有未使用兑换码；已使用和已过期记录不受影响。', confirmText: '删除全部未使用', tone: ConfirmTone.DANGER })) return
  try {
    const ids: number[] = []
    let current = 1
    let pageCount = 1
    do { const response = await redeemAPI.list(current, 100, { status: RedeemCodeStatus.UNUSED }); ids.push(...response.items.map((item) => item.id)); pageCount = response.pages || 1; current += 1 } while (current <= pageCount)
    if (!ids.length) { app.showSuccess('没有未使用兑换码'); return }
    const response = await redeemAPI.batchDelete(ids)
    app.showSuccess(`已删除 ${response.deleted} 个未使用兑换码`)
    selected.value = []
    refresh()
  } catch (caught) { app.showError((caught as { message?: string }).message || '清理未使用兑换码失败') }
}

function openBatch(): void { if (!selected.value.length) { app.showError('请先选择兑换码'); return } Object.assign(batchForm, { useStatus: false, status: RedeemCodeStatus.UNUSED, useExpiry: false, expiry: '', clearExpiry: false, useNotes: false, notes: '', useGroup: false, groupId: '' }); batchOpen.value = true }
function batchFields(): BatchUpdateRedeemCodeFields {
  const fields: BatchUpdateRedeemCodeFields = {}
  if (batchForm.useStatus) fields.status = batchForm.status
  if (batchForm.useExpiry) fields.expires_at = batchForm.clearExpiry ? null : batchForm.expiry ? new Date(batchForm.expiry).toISOString() : null
  if (batchForm.useNotes) fields.notes = batchForm.notes
  if (batchForm.useGroup) fields.group_id = batchForm.groupId ? Number(batchForm.groupId) : null
  return fields
}

async function submitBatch(): Promise<void> {
  const fields = batchFields()
  if (!Object.keys(fields).length) { app.showError('至少选择一个要更新的字段'); return }
  batchSaving.value = true
  try { const response = await redeemAPI.batchUpdate(selected.value, fields); app.showSuccess(`已更新 ${response.updated} 个兑换码`); batchOpen.value = false; selected.value = []; refresh() }
  catch (caught) { app.showError((caught as { message?: string }).message || '批量更新失败') }
  finally { batchSaving.value = false }
}

onMounted(async () => { try { groups.value = await groupsAPI.getAllIncludingInactive() } catch { /* subscription option can stay empty */ } refresh() })
onBeforeUnmount(() => { if (timer) window.clearTimeout(timer) })
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Voucher Operations</span><h1>兑换码管理</h1><p>生成不同权益类型的兑换码，完成筛选、批量编辑、失效、删除、复制和 CSV 导出。</p></div><button class="resource-button" @click="openGenerate">生成兑换码</button></header>
      <section class="resource-summary"><div><span>兑换码总数</span><strong>{{ stats?.total_codes ?? total }}</strong></div><div><span>可用</span><strong>{{ stats?.active_codes ?? '—' }}</strong></div><div><span>已使用 / 已过期</span><strong>{{ stats ? `${stats.used_codes} / ${stats.expired_codes}` : '—' }}</strong></div><div><span>累计发放价值</span><strong>{{ stats?.total_value_distributed?.toFixed(2) ?? '—' }}</strong></div></section>
      <section class="resource-toolbar"><div class="resource-toolbar__filters"><input v-model="filters.search" type="search" placeholder="搜索兑换码、备注或用户" @input="searchLater" /><select v-model="filters.type" @change="applyFilters"><option value="">全部类型</option><option v-for="type in RedeemCodeTypeOption" :key="type" :value="type">{{ typeLabel(type) }}</option></select><select v-model="filters.status" @change="applyFilters"><option value="">全部状态</option><option :value="RedeemCodeStatus.UNUSED">未使用</option><option :value="RedeemCodeStatus.USED">已使用</option><option :value="RedeemCodeStatus.EXPIRED">已过期</option><option :value="RedeemCodeStatus.DISABLED">已停用</option></select></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" @click="refresh">刷新</button><button class="resource-button resource-button--secondary" @click="exportCodes">导出 CSV</button><button v-if="selected.length" class="resource-button resource-button--secondary" @click="openBatch">批量编辑 {{ selected.length }}</button><button v-if="selected.length" class="resource-button resource-button--danger" @click="batchDelete">批量删除 {{ selected.length }}</button><button class="resource-button resource-button--danger" @click="deleteAllUnused">清理未使用</button></div></section>
      <PageState :loading="loading" :error="error" :empty="!loading && !error && rows.length === 0" empty-text="没有匹配的兑换码。" @retry="load"><div class="resource-table"><table><thead><tr><th class="resource-table__select"><input type="checkbox" :checked="allSelected" aria-label="选择当前页" @change="toggleAll" /></th><th>兑换码</th><th>类型</th><th @click="changeSort('value')">权益值 ↕</th><th @click="changeSort('status')">状态 ↕</th><th>使用者</th><th>有效期</th><th @click="changeSort('created_at')">创建 ↕</th><th>操作</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td><input type="checkbox" :checked="selected.includes(row.id)" :aria-label="`选择 ${row.code}`" @change="toggle(row.id)" /></td><td><button class="resource-link commerce-code-link" @click="openDetail(row)">{{ row.code }}</button><small>#{{ row.id }} · {{ row.notes || '无备注' }}</small></td><td>{{ typeLabel(row.type) }}<small v-if="row.group_id">{{ row.group?.name || `分组 #${row.group_id}` }}</small></td><td>{{ row.type === RedeemCodeTypeOption.BALANCE ? `$${row.value.toFixed(2)}` : row.value }}<small v-if="row.validity_days">权益 {{ row.validity_days }} 天</small></td><td><span :class="['resource-status', [RedeemCodeStatus.ACTIVE, RedeemCodeStatus.UNUSED].includes(row.status as RedeemCodeStatus) ? 'resource-status--active' : row.status === RedeemCodeStatus.EXPIRED ? 'resource-status--expired' : row.status === RedeemCodeStatus.USED ? '' : 'resource-status--degraded']">{{ statusLabel(row.status) }}</span></td><td>{{ row.user?.email || (row.used_by ? `用户 #${row.used_by}` : '—') }}<small>{{ formatCommerceDate(row.used_at) }}</small></td><td>{{ formatCommerceDate(row.expires_at) }}</td><td>{{ formatCommerceDate(row.created_at) }}</td><td><div class="resource-inline-actions"><button class="resource-link" @click="copy(row.code)">复制</button><button class="resource-link" @click="openDetail(row)">详情</button><button v-if="[RedeemCodeStatus.ACTIVE, RedeemCodeStatus.UNUSED].includes(row.status as RedeemCodeStatus)" class="resource-link" @click="expire(row)">过期</button><button class="resource-link resource-link--danger" @click="remove(row)">删除</button></div></td></tr></tbody></table></div></PageState>
      <footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; load()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option><option :value="100">100 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; load()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; load()">下一页</button></div></footer>
    </main>

    <SurfaceDialog :show="generateOpen" title="生成兑换码" description="码本身的过期时间与订阅权益有效期相互独立。" :width="DialogWidth.WIDE" @close="generateOpen = false"><form id="redeem-generate-form" class="resource-form-stack" @submit.prevent="submitGenerate"><div class="resource-form-grid resource-form-grid--3"><label>数量 *<input v-model.number="generateForm.count" type="number" min="1" max="1000" step="1" /></label><label>类型 *<select v-model="generateForm.type"><option v-for="type in RedeemCodeTypeOption" :key="type" :value="type">{{ typeLabel(type) }}</option></select></label><label>{{ generateForm.type === RedeemCodeTypeOption.BALANCE ? '余额金额' : generateForm.type === RedeemCodeTypeOption.CONCURRENCY ? '并发数量' : '权益值' }} *<input v-model.number="generateForm.value" type="number" min="0" step="0.01" :disabled="generateForm.type === RedeemCodeTypeOption.INVITATION" /></label><label v-if="generateForm.type === RedeemCodeTypeOption.SUBSCRIPTION">订阅分组 *<select v-model="generateForm.groupId"><option value="">请选择</option><option v-for="group in subscriptionGroups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label><label v-if="generateForm.type === RedeemCodeTypeOption.SUBSCRIPTION">兑换后权益天数<input v-model.number="generateForm.validityDays" type="number" min="1" step="1" /></label><label>兑换码有效天数（0 永久）<input v-model.number="generateForm.expiresInDays" type="number" min="0" step="1" /></label></div></form><template #footer><button class="button button--secondary" @click="generateOpen = false">取消</button><button type="submit" form="redeem-generate-form" class="button button--primary" :disabled="generating">{{ generating ? '生成中…' : '生成兑换码' }}</button></template></SurfaceDialog>

    <SurfaceDialog :show="resultOpen" :title="`已生成 ${generated.length} 个兑换码`" description="请及时复制或下载；列表中仍可逐条查询。" :width="DialogWidth.WIDE" @close="resultOpen = false"><pre class="resource-code commerce-generated-codes">{{ generated.map(item => item.code).join('\n') }}</pre><template #footer><button class="button button--secondary" @click="copyGenerated">复制全部</button><button class="button button--primary" @click="downloadGenerated">下载 TXT</button></template></SurfaceDialog>

    <SurfaceDialog :show="batchOpen" :title="`批量编辑 ${selected.length} 个兑换码`" description="只提交勾选字段；未勾选内容保持不变。" :width="DialogWidth.WIDE" @close="batchOpen = false"><div class="resource-form-stack"><section class="commerce-batch-field"><label class="resource-check"><input v-model="batchForm.useStatus" type="checkbox" /><span>更新状态</span></label><select v-model="batchForm.status" :disabled="!batchForm.useStatus"><option :value="RedeemCodeStatus.UNUSED">未使用</option><option :value="RedeemCodeStatus.DISABLED">停用</option></select></section><section class="commerce-batch-field"><label class="resource-check"><input v-model="batchForm.useExpiry" type="checkbox" /><span>更新过期时间</span></label><input v-model="batchForm.expiry" type="datetime-local" :disabled="!batchForm.useExpiry || batchForm.clearExpiry" /><label class="resource-check"><input v-model="batchForm.clearExpiry" type="checkbox" :disabled="!batchForm.useExpiry" /><span>清除过期时间</span></label></section><section class="commerce-batch-field"><label class="resource-check"><input v-model="batchForm.useNotes" type="checkbox" /><span>更新备注</span></label><input v-model="batchForm.notes" :disabled="!batchForm.useNotes" /></section><section class="commerce-batch-field"><label class="resource-check"><input v-model="batchForm.useGroup" type="checkbox" /><span>更新订阅分组</span></label><select v-model="batchForm.groupId" :disabled="!batchForm.useGroup"><option value="">清除分组</option><option v-for="group in subscriptionGroups" :key="group.id" :value="group.id">{{ group.name }}</option></select></section></div><template #footer><button class="button button--secondary" @click="batchOpen = false">取消</button><button class="button button--primary" :disabled="batchSaving" @click="submitBatch">{{ batchSaving ? '保存中…' : '保存批量更新' }}</button></template></SurfaceDialog>

    <SurfaceDialog :show="detailOpen" :title="`兑换码详情 · ${detail?.code || ''}`" description="展示权益、使用者、备注与完整时间状态。" :width="DialogWidth.STANDARD" @close="detailOpen = false"><div v-if="detailLoading" class="page-state">正在加载…</div><section v-else-if="detail" class="commerce-code-detail"><div><span>类型</span><strong>{{ typeLabel(detail.type) }}</strong></div><div><span>权益值</span><strong>{{ detail.value }}</strong></div><div><span>状态</span><strong>{{ statusLabel(detail.status) }}</strong></div><div><span>订阅分组</span><strong>{{ detail.group?.name || (detail.group_id ? `#${detail.group_id}` : '—') }}</strong></div><div><span>使用者</span><strong>{{ detail.user?.email || (detail.used_by ? `#${detail.used_by}` : '—') }}</strong><small>{{ formatCommerceDate(detail.used_at) }}</small></div><div><span>创建 / 过期</span><strong>{{ formatCommerceDate(detail.created_at) }}</strong><small>{{ formatCommerceDate(detail.expires_at) }}</small></div><div class="commerce-code-detail__wide"><span>备注</span><strong>{{ detail.notes || '—' }}</strong></div></section></SurfaceDialog>
  </ConsoleShell>
</template>

<style scoped>
.commerce-code-link { padding-left: 0; color: var(--text-primary); font: 700 12px ui-monospace, monospace; }
.commerce-generated-codes { max-height: 55vh; }
.commerce-batch-field { padding: 13px; display: grid; grid-template-columns: minmax(150px, .5fr) minmax(200px, 1fr) auto; align-items: center; gap: 12px; border: 1px solid var(--border-subtle); border-radius: 11px; }
.commerce-batch-field input, .commerce-batch-field select { min-height: 40px; padding: 8px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 8px; }
.commerce-code-detail { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; overflow: hidden; background: var(--border-subtle); border: 1px solid var(--border-subtle); border-radius: 13px; }
.commerce-code-detail > div { padding: 14px; display: grid; gap: 6px; background: var(--surface-raised); }
.commerce-code-detail span, .commerce-code-detail small { color: var(--text-secondary); font-size: var(--font-meta); }
.commerce-code-detail__wide { grid-column: 1 / -1; }
@media (max-width: 700px) { .commerce-batch-field { grid-template-columns: 1fr; } }
</style>
