<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import adminPaymentAPI from '@shared-api/admin/payment'
import type { PaymentOrder } from '@/types/payment'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import OrderRefundDialog from '@/components/admin/commerce/OrderRefundDialog.vue'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import {
  PaymentMethod,
  PaymentOrderStatus,
  PaymentOrderType,
  canRefundOrder,
  formatCommerceDate,
  formatCurrency,
  paymentMethodLabels,
  paymentStatusClass,
  paymentStatusLabels
} from '@/features/admin/commerce/model'

interface OrderAuditLog { id: number; action: string; detail?: string | null; operator?: string | null; created_at: string }

const app = useAppStore()
const confirm = useConfirmStore()
const rows = ref<PaymentOrder[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const error = ref('')
const filters = reactive({ keyword: '', status: '', paymentType: '', orderType: '', userId: '', startDate: '', endDate: '' })
const detailOpen = ref(false)
const detailLoading = ref(false)
const selected = ref<PaymentOrder | null>(null)
const auditLogs = ref<OrderAuditLog[]>([])
const refundOpen = ref(false)
const refundSubmitting = ref(false)
const refundRequireForce = ref(false)
const refundWarning = ref('')
const querying = ref(new Set<number>())
let timer: number | null = null

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const completed = computed(() => rows.value.filter((item) => item.status === PaymentOrderStatus.COMPLETED).length)
const pending = computed(() => rows.value.filter((item) => item.status === PaymentOrderStatus.PENDING).length)
const refundAttention = computed(() => rows.value.filter((item) => [PaymentOrderStatus.REFUND_REQUESTED, PaymentOrderStatus.REFUND_PENDING, PaymentOrderStatus.REFUND_FAILED].includes(item.status as PaymentOrderStatus)).length)
const pageRevenue = computed(() => rows.value.filter((item) => item.status === PaymentOrderStatus.COMPLETED).reduce((sum, item) => sum + Number(item.pay_amount || 0), 0))

function requestParams() {
  return {
    page: page.value,
    page_size: pageSize.value,
    keyword: filters.keyword.trim() || undefined,
    status: filters.status || undefined,
    payment_type: filters.paymentType || undefined,
    order_type: filters.orderType || undefined,
    user_id: filters.userId ? Number(filters.userId) : undefined,
    start_date: filters.startDate || undefined,
    end_date: filters.endDate || undefined
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try { const response = await adminPaymentAPI.getOrders(requestParams()); rows.value = response.data.items || []; total.value = response.data.total || 0 }
  catch (caught) { error.value = (caught as { message?: string }).message || '订单加载失败' }
  finally { loading.value = false }
}

function applyFilters(): void { page.value = 1; void load() }
function searchLater(): void { if (timer) window.clearTimeout(timer); timer = window.setTimeout(applyFilters, 280) }
function statusLabel(status: string): string { return paymentStatusLabels[status as PaymentOrderStatus] || status }
function methodLabel(type: string): string { return paymentMethodLabels[type as PaymentMethod] || type }

async function openDetail(row: PaymentOrder): Promise<void> {
  selected.value = row
  auditLogs.value = []
  detailOpen.value = true
  detailLoading.value = true
  try {
    const response = await adminPaymentAPI.getOrder(row.id)
    const payload = response.data as PaymentOrder | { order?: PaymentOrder; auditLogs?: OrderAuditLog[]; audit_logs?: OrderAuditLog[] }
    if ('order' in payload && payload.order) selected.value = payload.order
    else selected.value = payload as PaymentOrder
    if ('auditLogs' in payload || 'audit_logs' in payload) auditLogs.value = payload.auditLogs || payload.audit_logs || []
  } catch { /* cached row remains available */ }
  finally { detailLoading.value = false }
}

async function cancel(row: PaymentOrder): Promise<void> {
  if (!await confirm.ask({ title: '取消待支付订单', message: `取消订单 #${row.id}（${row.out_trade_no}）？取消后不可继续支付。`, confirmText: '取消订单', tone: ConfirmTone.DANGER })) return
  try { await adminPaymentAPI.cancelOrder(row.id); app.showSuccess('订单已取消'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '取消订单失败') }
}

async function retry(row: PaymentOrder): Promise<void> {
  if (!await confirm.ask({ title: '重试充值', message: `重新执行订单 #${row.id} 的余额或订阅入账？支付不会重复扣款。`, confirmText: '重试入账' })) return
  try { await adminPaymentAPI.retryRecharge(row.id); app.showSuccess('充值重试已提交'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '重试失败') }
}

function openRefund(row: PaymentOrder): void { selected.value = row; refundRequireForce.value = false; refundWarning.value = ''; refundOpen.value = true }
function closeRefund(): void { refundOpen.value = false; refundRequireForce.value = false; refundWarning.value = '' }
function isPendingWarning(value?: string): boolean { return /pending|处理中|待/.test(String(value || '').toLowerCase()) }

async function submitRefund(payload: { amount: number; reason: string; deduct_balance: boolean; force: boolean }): Promise<void> {
  if (!selected.value) return
  refundSubmitting.value = true
  try {
    const result = (await adminPaymentAPI.refundOrder(selected.value.id, payload)).data
    if (result.success) { app.showSuccess('退款成功'); closeRefund(); await load(); return }
    if (isPendingWarning(result.warning)) { app.showSuccess('退款已提交，等待上游确认'); closeRefund(); await load(); return }
    if (result.require_force) { refundRequireForce.value = true; refundWarning.value = result.warning || '上游退款状态无法确认'; return }
    app.showError(result.warning || '退款失败')
  } catch (caught) { app.showError((caught as { message?: string }).message || '退款失败') }
  finally { refundSubmitting.value = false }
}

async function queryRefund(row: PaymentOrder): Promise<void> {
  querying.value = new Set(querying.value).add(row.id)
  try {
    const result = (await adminPaymentAPI.queryRefund(row.id)).data
    if (result.success) app.showSuccess('退款状态已确认')
    else if (isPendingWarning(result.warning)) app.showSuccess('退款仍在处理中')
    else app.showError(result.warning || '退款状态查询失败')
    await load()
  } catch (caught) { app.showError((caught as { message?: string }).message || '退款状态查询失败') }
  finally { const next = new Set(querying.value); next.delete(row.id); querying.value = next }
}

onMounted(load)
onBeforeUnmount(() => { if (timer) window.clearTimeout(timer) })
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Order Control</span><h1>订单管理</h1><p>筛选支付与订阅订单，直接处理取消、失败入账、退款审核、强制退款和待确认状态查询。</p></div></header>
      <section class="resource-summary"><div><span>当前页 / 总数</span><strong>{{ rows.length }} / {{ total }}</strong></div><div><span>已完成</span><strong>{{ completed }}</strong></div><div><span>待支付</span><strong>{{ pending }}</strong></div><div><span>退款待处理 / 页收入</span><strong>{{ refundAttention }} · ¥{{ pageRevenue.toFixed(2) }}</strong></div></section>
      <section class="resource-toolbar resource-toolbar--stacked"><div class="resource-toolbar__filters"><input v-model="filters.keyword" type="search" placeholder="订单号、用户或关键词" @input="searchLater" /><select v-model="filters.status" @change="applyFilters"><option value="">全部状态</option><option v-for="status in PaymentOrderStatus" :key="status" :value="status">{{ statusLabel(status) }}</option></select><select v-model="filters.paymentType" @change="applyFilters"><option value="">全部支付方式</option><option v-for="method in PaymentMethod" :key="method" :value="method">{{ methodLabel(method) }}</option></select><select v-model="filters.orderType" @change="applyFilters"><option value="">全部订单类型</option><option :value="PaymentOrderType.BALANCE">余额充值</option><option :value="PaymentOrderType.SUBSCRIPTION">订阅购买</option></select><input v-model="filters.userId" type="number" min="1" placeholder="用户 ID" @change="applyFilters" /><label class="commerce-date-filter">开始<input v-model="filters.startDate" type="date" @change="applyFilters" /></label><label class="commerce-date-filter">结束<input v-model="filters.endDate" type="date" @change="applyFilters" /></label></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" @click="load">刷新</button></div></section>
      <PageState :loading="loading" :error="error" :empty="!loading && !error && rows.length === 0" empty-text="没有匹配的订单。" @retry="load"><div class="resource-table"><table><thead><tr><th>订单</th><th>用户</th><th>金额</th><th>支付方式</th><th>类型</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td><button class="resource-link commerce-order-link" @click="openDetail(row)">#{{ row.id }}</button><small>{{ row.out_trade_no }}</small></td><td>#{{ row.user_id }}<small v-if="row.provider_instance_id">Provider: {{ row.provider_instance_id }}</small></td><td><strong>{{ formatCurrency(row.pay_amount, row.currency || 'CNY') }}</strong><small>入账 {{ formatCurrency(row.amount, 'USD') }} · 费率 {{ row.fee_rate }}%</small></td><td>{{ methodLabel(row.payment_type) }}</td><td>{{ row.order_type === PaymentOrderType.SUBSCRIPTION ? '订阅' : '余额' }}<small v-if="row.plan_id">计划 #{{ row.plan_id }}</small></td><td><span :class="['resource-status', paymentStatusClass(row.status)]">{{ statusLabel(row.status) }}</span><small v-if="row.refund_amount">退款 {{ formatCurrency(row.refund_amount, 'USD') }}</small></td><td>{{ formatCommerceDate(row.created_at) }}<small>到期 {{ formatCommerceDate(row.expires_at) }}</small></td><td><div class="resource-inline-actions"><button class="resource-link" @click="openDetail(row)">详情</button><button v-if="row.status === PaymentOrderStatus.PENDING" class="resource-link resource-link--danger" @click="cancel(row)">取消</button><button v-if="row.status === PaymentOrderStatus.FAILED" class="resource-link" @click="retry(row)">重试入账</button><button v-if="canRefundOrder(row.status)" class="resource-link resource-link--danger" @click="openRefund(row)">{{ row.status === PaymentOrderStatus.REFUND_REQUESTED ? '审核退款' : row.status === PaymentOrderStatus.REFUND_FAILED ? '重试退款' : '退款' }}</button><button v-if="row.status === PaymentOrderStatus.REFUND_PENDING" class="resource-link" :disabled="querying.has(row.id)" @click="queryRefund(row)">{{ querying.has(row.id) ? '查询中…' : '查询退款' }}</button></div></td></tr></tbody></table></div></PageState>
      <footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; load()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option><option :value="100">100 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; load()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; load()">下一页</button></div></footer>
    </main>

    <SurfaceDialog :show="detailOpen" :title="`订单详情 · #${selected?.id || ''}`" description="展示支付、入账、退款申请和后端返回的审计记录。" :width="DialogWidth.WIDE" @close="detailOpen = false"><div v-if="detailLoading" class="page-state">正在加载订单…</div><div v-else-if="selected" class="resource-form-stack"><section class="commerce-order-detail"><div><span>商户订单号</span><strong>{{ selected.out_trade_no }}</strong></div><div><span>状态</span><strong>{{ statusLabel(selected.status) }}</strong></div><div><span>用户</span><strong>#{{ selected.user_id }}</strong></div><div><span>订单类型</span><strong>{{ selected.order_type }}</strong></div><div><span>入账金额</span><strong>{{ formatCurrency(selected.amount, 'USD') }}</strong></div><div><span>支付金额</span><strong>{{ formatCurrency(selected.pay_amount, selected.currency || 'CNY') }}</strong></div><div><span>费率</span><strong>{{ selected.fee_rate }}%</strong></div><div><span>支付方式</span><strong>{{ methodLabel(selected.payment_type) }}</strong></div><div><span>创建</span><strong>{{ formatCommerceDate(selected.created_at) }}</strong></div><div><span>支付 / 完成</span><strong>{{ formatCommerceDate(selected.paid_at) }}</strong><small>{{ formatCommerceDate(selected.completed_at) }}</small></div><div><span>到期</span><strong>{{ formatCommerceDate(selected.expires_at) }}</strong></div><div><span>Provider</span><strong>{{ selected.provider_instance_id || '—' }}</strong></div></section><section v-if="selected.refund_requested_at || selected.refund_amount" class="commerce-refund-detail"><strong>退款信息</strong><span>申请：{{ formatCommerceDate(selected.refund_requested_at) }} · 用户 #{{ selected.refund_requested_by || '—' }}</span><span>申请理由：{{ selected.refund_request_reason || '—' }}</span><span>已退金额：{{ formatCurrency(selected.refund_amount, 'USD') }} · {{ selected.refund_reason || '—' }}</span></section><section v-if="auditLogs.length" class="commerce-audit-list"><h3>审计记录</h3><article v-for="log in auditLogs" :key="log.id"><div><strong>{{ log.action }}</strong><span>{{ formatCommerceDate(log.created_at) }}</span></div><p>{{ log.detail || '—' }}</p><small>{{ log.operator || '系统' }}</small></article></section></div></SurfaceDialog>
    <OrderRefundDialog :show="refundOpen" :order="selected" :submitting="refundSubmitting" :require-force="refundRequireForce" :warning="refundWarning" @close="closeRefund" @submit="submitRefund" />
  </ConsoleShell>
</template>

<style scoped>
.resource-toolbar--stacked { align-items: flex-start; }
.resource-toolbar--stacked .resource-toolbar__filters { flex: 1; }
.resource-toolbar--stacked input[type="number"] { width: 110px; }
.commerce-date-filter { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: var(--font-meta); }
.commerce-date-filter input { width: 150px !important; }
.commerce-order-link { padding-left: 0; color: var(--text-primary); font-size: 13px; }
.commerce-order-detail { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; overflow: hidden; background: var(--border-subtle); border: 1px solid var(--border-subtle); border-radius: 14px; }
.commerce-order-detail > div { min-width: 0; padding: 14px; display: grid; gap: 6px; background: var(--surface-raised); }
.commerce-order-detail span, .commerce-order-detail small { color: var(--text-secondary); font-size: var(--font-meta); }
.commerce-order-detail strong { overflow-wrap: anywhere; }
.commerce-refund-detail { padding: 15px; display: grid; gap: 7px; color: var(--text-secondary); background: color-mix(in srgb, var(--warning) 8%, var(--surface-raised)); border: 1px solid color-mix(in srgb, var(--warning) 30%, var(--border-subtle)); border-radius: 12px; font-size: 12px; }
.commerce-refund-detail strong { color: var(--text-primary); }
.commerce-audit-list { display: grid; gap: 9px; }
.commerce-audit-list h3 { margin: 0; font-size: 13px; }
.commerce-audit-list article { padding: 12px; border: 1px solid var(--border-subtle); border-radius: 10px; }
.commerce-audit-list article > div { display: flex; justify-content: space-between; gap: 10px; }
.commerce-audit-list span, .commerce-audit-list small, .commerce-audit-list p { color: var(--text-secondary); font-size: var(--font-meta); }
.commerce-audit-list p { margin: 8px 0; }
@media (max-width: 900px) { .commerce-order-detail { grid-template-columns: repeat(2, 1fr); } }
</style>
