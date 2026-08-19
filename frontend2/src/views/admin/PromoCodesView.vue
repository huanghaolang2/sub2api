<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import promoAPI from '@shared-api/admin/promo'
import type { CreatePromoCodeRequest, PromoCode, PromoCodeUsage, UpdatePromoCodeRequest } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { PromoCodeStatus, SortOrder, formatCommerceDate, nextSort } from '@/features/admin/commerce/model'

const app = useAppStore()
const confirm = useConfirmStore()
const rows = ref<PromoCode[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const error = ref('')
const filters = reactive({ search: '', status: '' })
const sort = reactive({ by: 'created_at', order: SortOrder.DESC })
const editorOpen = ref(false)
const editing = ref<PromoCode | null>(null)
const saving = ref(false)
const form = reactive({ code: '', bonusAmount: 1, maxUses: 0, status: PromoCodeStatus.ACTIVE as PromoCodeStatus, expiresAt: '', notes: '' })
const usagesOpen = ref(false)
const usagesLoading = ref(false)
const usages = ref<PromoCodeUsage[]>([])
const usagesTotal = ref(0)
const usagesPage = ref(1)
const usagesPageSize = ref(20)
const viewing = ref<PromoCode | null>(null)
let timer: number | null = null
let controller: AbortController | null = null

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const active = computed(() => rows.value.filter((item) => effectiveStatus(item) === '可用').length)
const exhausted = computed(() => rows.value.filter((item) => item.max_uses > 0 && item.used_count >= item.max_uses).length)
const granted = computed(() => rows.value.reduce((sum, item) => sum + item.used_count * item.bonus_amount, 0))
const usagePages = computed(() => Math.max(1, Math.ceil(usagesTotal.value / usagesPageSize.value)))

function effectiveStatus(item: PromoCode): string {
  if (item.expires_at && new Date(item.expires_at).getTime() < Date.now()) return '已过期'
  if (item.max_uses > 0 && item.used_count >= item.max_uses) return '已用尽'
  return item.status === PromoCodeStatus.ACTIVE ? '可用' : '已停用'
}

function requestFilters() { return { status: filters.status || undefined, search: filters.search.trim() || undefined, sort_by: sort.by, sort_order: sort.order } }
async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  const current = controller
  loading.value = true
  error.value = ''
  try { const response = await promoAPI.list(page.value, pageSize.value, requestFilters(), { signal: current.signal }); rows.value = response.items || []; total.value = response.total || 0 }
  catch (caught) { if ((caught as { code?: string }).code !== 'ERR_CANCELED') error.value = (caught as { message?: string }).message || '促销码加载失败' }
  finally { if (controller === current) loading.value = false }
}

function applyFilters(): void { page.value = 1; void load() }
function searchLater(): void { if (timer) window.clearTimeout(timer); timer = window.setTimeout(applyFilters, 280) }
function changeSort(by: string): void { Object.assign(sort, nextSort(sort.by, sort.order, by)); applyFilters() }
async function copy(value: string, message: string): Promise<void> { try { await navigator.clipboard.writeText(value); app.showSuccess(message) } catch { app.showError('复制失败，请检查剪贴板权限') } }
function copyRegisterLink(item: PromoCode): void { void copy(`${window.location.origin}/register?promo=${encodeURIComponent(item.code)}`, '注册链接已复制') }

function toDatetimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function openCreate(): void { editing.value = null; Object.assign(form, { code: '', bonusAmount: 1, maxUses: 0, status: PromoCodeStatus.ACTIVE, expiresAt: '', notes: '' }); editorOpen.value = true }
async function openEdit(item: PromoCode): Promise<void> {
  try { editing.value = await promoAPI.getById(item.id) } catch { editing.value = item }
  const value = editing.value
  Object.assign(form, { code: value.code, bonusAmount: value.bonus_amount, maxUses: value.max_uses, status: value.status as PromoCodeStatus, expiresAt: toDatetimeLocal(value.expires_at), notes: value.notes || '' })
  editorOpen.value = true
}

function expiryValue(): number | null { return form.expiresAt ? Math.floor(new Date(form.expiresAt).getTime() / 1000) : null }
async function save(): Promise<void> {
  if (Number(form.bonusAmount) <= 0 || Number(form.maxUses) < 0) { app.showError('赠送金额必须大于 0，最大使用次数不能为负数'); return }
  saving.value = true
  try {
    if (editing.value) {
      const payload: UpdatePromoCodeRequest = { code: form.code.trim(), bonus_amount: Number(form.bonusAmount), max_uses: Number(form.maxUses), status: form.status, expires_at: expiryValue(), notes: form.notes.trim() }
      await promoAPI.update(editing.value.id, payload)
      app.showSuccess('促销码已更新')
    } else {
      const payload: CreatePromoCodeRequest = { code: form.code.trim() || undefined, bonus_amount: Number(form.bonusAmount), max_uses: Number(form.maxUses), expires_at: expiryValue(), notes: form.notes.trim() || undefined }
      await promoAPI.create(payload)
      app.showSuccess('促销码已创建')
    }
    editorOpen.value = false
    await load()
  } catch (caught) { app.showError((caught as { message?: string }).message || '促销码保存失败') }
  finally { saving.value = false }
}

async function remove(item: PromoCode): Promise<void> {
  if (!await confirm.ask({ title: '删除促销码', message: `删除 ${item.code}？已产生的赠送记录不会回滚。`, confirmText: '删除', tone: ConfirmTone.DANGER })) return
  try { await promoAPI.delete(item.id); app.showSuccess('促销码已删除'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '删除失败') }
}

async function openUsages(item: PromoCode): Promise<void> { viewing.value = item; usagesPage.value = 1; usagesOpen.value = true; await loadUsages() }
async function loadUsages(): Promise<void> {
  if (!viewing.value) return
  usagesLoading.value = true
  try { const response = await promoAPI.getUsages(viewing.value.id, usagesPage.value, usagesPageSize.value); usages.value = response.items || []; usagesTotal.value = response.total || 0 }
  catch (caught) { app.showError((caught as { message?: string }).message || '使用记录加载失败') }
  finally { usagesLoading.value = false }
}

onMounted(load)
onBeforeUnmount(() => { controller?.abort(); if (timer) window.clearTimeout(timer) })
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Acquisition Incentives</span><h1>促销码管理</h1><p>控制注册赠送金额、使用上限、有效期与状态，并追踪每一次用户领取。</p></div><button class="resource-button" @click="openCreate">创建促销码</button></header>
      <section class="resource-summary"><div><span>当前页 / 总数</span><strong>{{ rows.length }} / {{ total }}</strong></div><div><span>当前页可用</span><strong>{{ active }}</strong></div><div><span>当前页已用尽</span><strong>{{ exhausted }}</strong></div><div><span>当前页已发放</span><strong>${{ granted.toFixed(2) }}</strong></div></section>
      <section class="resource-toolbar"><div class="resource-toolbar__filters"><input v-model="filters.search" type="search" placeholder="搜索促销码或备注" @input="searchLater" /><select v-model="filters.status" @change="applyFilters"><option value="">全部状态</option><option :value="PromoCodeStatus.ACTIVE">启用</option><option :value="PromoCodeStatus.DISABLED">停用</option></select></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" @click="load">刷新</button></div></section>
      <PageState :loading="loading" :error="error" :empty="!loading && !error && rows.length === 0" empty-text="没有匹配的促销码。" @retry="load"><div class="resource-table"><table><thead><tr><th>促销码</th><th @click="changeSort('bonus_amount')">赠送金额 ↕</th><th>使用进度</th><th @click="changeSort('status')">状态 ↕</th><th @click="changeSort('expires_at')">有效期 ↕</th><th @click="changeSort('created_at')">创建 ↕</th><th>操作</th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td><button class="resource-link commerce-promo-code" @click="copy(item.code, '促销码已复制')">{{ item.code }}</button><small>#{{ item.id }} · {{ item.notes || '无备注' }}</small></td><td><strong>${{ item.bonus_amount.toFixed(2) }}</strong></td><td>{{ item.used_count }} / {{ item.max_uses || '∞' }}<i class="commerce-usage-track"><b :style="{ width: item.max_uses ? `${Math.min(100, item.used_count / item.max_uses * 100)}%` : '0%' }"></b></i></td><td><span :class="['resource-status', effectiveStatus(item) === '可用' ? 'resource-status--active' : effectiveStatus(item) === '已过期' ? 'resource-status--expired' : '']">{{ effectiveStatus(item) }}</span></td><td>{{ formatCommerceDate(item.expires_at) }}</td><td>{{ formatCommerceDate(item.created_at) }}</td><td><div class="resource-inline-actions"><button class="resource-link" @click="copyRegisterLink(item)">复制注册链接</button><button class="resource-link" @click="openUsages(item)">使用记录</button><button class="resource-link" @click="openEdit(item)">编辑</button><button class="resource-link resource-link--danger" @click="remove(item)">删除</button></div></td></tr></tbody></table></div></PageState>
      <footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; load()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option><option :value="100">100 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; load()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; load()">下一页</button></div></footer>
    </main>

    <SurfaceDialog :show="editorOpen" :title="editing ? '编辑促销码' : '创建促销码'" description="留空代码时由后端自动生成；0 次上限表示不限次数。" :width="DialogWidth.STANDARD" @close="editorOpen = false"><form id="promo-editor-form" class="resource-form-stack" @submit.prevent="save"><label>促销码 {{ editing ? '*' : '（留空自动生成）' }}<input v-model="form.code" :required="Boolean(editing)" class="commerce-uppercase" /></label><div class="resource-form-grid"><label>赠送金额 *<input v-model.number="form.bonusAmount" type="number" min="0.01" step="0.01" /></label><label>最大使用次数（0 不限）<input v-model.number="form.maxUses" type="number" min="0" step="1" /></label><label v-if="editing">状态<select v-model="form.status"><option :value="PromoCodeStatus.ACTIVE">启用</option><option :value="PromoCodeStatus.DISABLED">停用</option></select></label><label>过期时间<input v-model="form.expiresAt" type="datetime-local" /></label></div><label>备注<textarea v-model="form.notes" rows="4" /></label></form><template #footer><button class="button button--secondary" @click="editorOpen = false">取消</button><button type="submit" form="promo-editor-form" class="button button--primary" :disabled="saving">{{ saving ? '保存中…' : '保存促销码' }}</button></template></SurfaceDialog>

    <SurfaceDialog :show="usagesOpen" :title="`使用记录 · ${viewing?.code || ''}`" description="每条记录对应一次实际赠送。" :width="DialogWidth.WIDE" @close="usagesOpen = false"><div v-if="usagesLoading" class="page-state">正在加载…</div><div v-else-if="!usages.length" class="resource-empty-inline">尚无使用记录。</div><div v-else class="resource-table"><table><thead><tr><th>用户</th><th>赠送金额</th><th>使用时间</th></tr></thead><tbody><tr v-for="usage in usages" :key="usage.id"><td>{{ usage.user?.email || `用户 #${usage.user_id}` }}<small>#{{ usage.user_id }}</small></td><td><strong>+${{ usage.bonus_amount.toFixed(2) }}</strong></td><td>{{ formatCommerceDate(usage.used_at) }}</td></tr></tbody></table></div><footer v-if="usagesTotal > usagesPageSize" class="resource-pagination"><span>第 {{ usagesPage }} / {{ usagePages }} 页</span><div class="resource-pagination__actions"><button class="resource-button resource-button--secondary" :disabled="usagesPage <= 1" @click="usagesPage--; loadUsages()">上一页</button><button class="resource-button resource-button--secondary" :disabled="usagesPage >= usagePages" @click="usagesPage++; loadUsages()">下一页</button></div></footer></SurfaceDialog>
  </ConsoleShell>
</template>

<style scoped>
.commerce-promo-code { padding-left: 0; color: var(--text-primary); font: 700 12px ui-monospace, monospace; }
.commerce-uppercase { text-transform: uppercase; }
.commerce-usage-track { width: 90px; height: 5px; margin-top: 6px; display: block; overflow: hidden; background: var(--surface-canvas); border-radius: 999px; }
.commerce-usage-track b { height: 100%; display: block; background: var(--accent); }
</style>
