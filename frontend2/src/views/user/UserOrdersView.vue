<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import * as authAPI from '@shared-api/auth'
import { paymentAPI } from '@shared-api/payment'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import {
  UserOrderStatus,
  canCancelOrder,
  canRequestOrderRefund,
  formatDateTime,
  formatMoney,
  orderStatusLabel,
  orderStatusTone
} from '@/features/user/billing/model'
import type { PaymentOrder } from '@/types/payment'

interface RequestError { response?: { data?: { detail?: string; message?: string } }; message?: string }

const orders = ref<PaymentOrder[]>([])
const loading = ref(true)
const error = ref('')
const feedback = ref('')
const actionLoading = ref(false)
const currentStatus = ref<UserOrderStatus>(UserOrderStatus.ALL)
const eligibleProviderIds = ref(new Set<string>())
const selectedOrder = ref<PaymentOrder | null>(null)
const cancelTarget = ref<PaymentOrder | null>(null)
const refundTarget = ref<PaymentOrder | null>(null)
const refundReason = ref('')
const pageSizes = ref([10, 20, 50, 100])
const pagination = reactive({ page: 1, pageSize: 20, total: 0, pages: 1 })
let requestGeneration = 0
let feedbackTimer: number | null = null

const statusOptions = [
  UserOrderStatus.ALL,
  UserOrderStatus.PENDING,
  UserOrderStatus.PAID,
  UserOrderStatus.RECHARGING,
  UserOrderStatus.COMPLETED,
  UserOrderStatus.EXPIRED,
  UserOrderStatus.CANCELLED,
  UserOrderStatus.FAILED,
  UserOrderStatus.REFUND_REQUESTED,
  UserOrderStatus.REFUNDING,
  UserOrderStatus.REFUND_PENDING,
  UserOrderStatus.PARTIALLY_REFUNDED,
  UserOrderStatus.REFUNDED,
  UserOrderStatus.REFUND_FAILED
]
const rangeStart = computed(() => pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0)
const rangeEnd = computed(() => Math.min(pagination.total, pagination.page * pagination.pageSize))

function requestError(caught: unknown, fallback: string): string {
  const value = caught as RequestError
  return value.response?.data?.detail || value.response?.data?.message || value.message || fallback
}

function showFeedback(message: string): void {
  feedback.value = message
  if (feedbackTimer != null) window.clearTimeout(feedbackTimer)
  feedbackTimer = window.setTimeout(() => { feedback.value = '' }, 3200)
}

function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    alipay: '支付宝', alipay_direct: '支付宝直连', wxpay: '微信支付', wxpay_direct: '微信直连',
    stripe: 'Stripe', easypay: '易支付', airwallex: 'Airwallex'
  }
  return labels[method] || method || '未知方式'
}

function orderTypeLabel(type: string): string {
  return type === 'subscription' ? '订阅套餐' : '余额充值'
}

function isRefundEligible(order: PaymentOrder): boolean {
  return canRequestOrderRefund(order, eligibleProviderIds.value)
}

function continuePaymentUrl(order: PaymentOrder): string {
  return `/payment/result?order_id=${order.id}&status=pending`
}

async function loadOrders(silent: boolean = false): Promise<void> {
  const generation = ++requestGeneration
  if (!silent) loading.value = true
  error.value = ''
  try {
    const response = await paymentAPI.getMyOrders({
      page: pagination.page,
      page_size: pagination.pageSize,
      status: currentStatus.value || undefined
    })
    if (generation !== requestGeneration) return
    orders.value = response.data.items || []
    pagination.total = response.data.total || 0
    pagination.page = response.data.page || pagination.page
    pagination.pageSize = response.data.page_size || pagination.pageSize
    pagination.pages = Math.max(1, response.data.pages || Math.ceil(pagination.total / pagination.pageSize))
  } catch (caught) {
    if (generation === requestGeneration) error.value = requestError(caught, '订单加载失败')
  } finally {
    if (!silent && generation === requestGeneration) loading.value = false
  }
}

async function loadSettings(): Promise<void> {
  try {
    const settings = await authAPI.getPublicSettings()
    const options = settings.table_page_size_options?.filter((value) => Number.isInteger(value) && value > 0)
    if (options?.length) pageSizes.value = [...new Set(options)]
    if (settings.table_default_page_size && pageSizes.value.includes(settings.table_default_page_size)) {
      pagination.pageSize = settings.table_default_page_size
    }
  } catch {
    // The stable local defaults keep order access available when public settings are unavailable.
  }
}

async function loadRefundEligibility(): Promise<void> {
  try {
    const response = await paymentAPI.getRefundEligibleProviders()
    eligibleProviderIds.value = new Set((response.data.provider_instance_ids || []).map(String))
  } catch {
    eligibleProviderIds.value = new Set()
  }
}

async function initialize(): Promise<void> {
  loading.value = true
  await loadSettings()
  await Promise.all([loadOrders(true), loadRefundEligibility()])
  loading.value = false
}

function changeStatus(): void {
  pagination.page = 1
  void loadOrders()
}

function changePage(page: number): void {
  if (page < 1 || page > pagination.pages || page === pagination.page) return
  pagination.page = page
  void loadOrders()
}

function changePageSize(event: Event): void {
  pagination.pageSize = Number((event.target as HTMLSelectElement).value)
  pagination.page = 1
  void loadOrders()
}

function askCancel(order: PaymentOrder): void {
  cancelTarget.value = order
}

async function confirmCancel(): Promise<void> {
  if (!cancelTarget.value || actionLoading.value) return
  actionLoading.value = true
  error.value = ''
  try {
    await paymentAPI.cancelOrder(cancelTarget.value.id)
    showFeedback(`订单 #${cancelTarget.value.id} 已取消`)
    cancelTarget.value = null
    await loadOrders(true)
  } catch (caught) {
    error.value = requestError(caught, '取消订单失败')
  } finally {
    actionLoading.value = false
  }
}

function askRefund(order: PaymentOrder): void {
  refundTarget.value = order
  refundReason.value = ''
}

async function confirmRefund(): Promise<void> {
  const reason = refundReason.value.trim()
  if (!refundTarget.value || !reason || actionLoading.value) return
  actionLoading.value = true
  error.value = ''
  try {
    await paymentAPI.requestRefund(refundTarget.value.id, { reason })
    showFeedback(`订单 #${refundTarget.value.id} 的退款申请已提交`)
    refundTarget.value = null
    refundReason.value = ''
    await loadOrders(true)
  } catch (caught) {
    error.value = requestError(caught, '退款申请提交失败')
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => { void initialize() })
</script>

<template>
  <ConsoleShell>
    <div class="orders-page">
      <header class="orders-heading">
        <div><p>账务与权益 / 我的订单</p><h1>订单记录</h1><span>按服务端状态查询充值与订阅订单，处理待支付、取消和可退款订单。</span></div>
        <RouterLink class="button button--primary" to="/app/purchase">购买与充值</RouterLink>
      </header>

      <p v-if="feedback" class="orders-feedback" role="status">{{ feedback }}</p>
      <p v-if="error && orders.length" class="orders-feedback is-error" role="alert">{{ error }}</p>

      <section class="orders-toolbar" aria-label="订单筛选">
        <label><span>订单状态</span><select v-model="currentStatus" aria-label="订单状态" @change="changeStatus"><option v-for="status in statusOptions" :key="status || 'all'" :value="status">{{ status ? orderStatusLabel(status) : '全部状态' }}</option></select></label>
        <div><strong>{{ pagination.total }}</strong><span>条匹配记录</span></div>
        <button type="button" :disabled="loading" @click="loadOrders()">{{ loading ? '刷新中…' : '刷新' }}</button>
      </section>

      <PageState :loading="loading" :error="orders.length ? '' : error" @retry="loadOrders()">
        <section v-if="orders.length" class="orders-panel">
          <div class="orders-table"><table><thead><tr><th>订单</th><th>业务</th><th>支付金额</th><th>支付方式</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody><tr v-for="order in orders" :key="order.id"><td><button class="order-link" type="button" @click="selectedOrder = order">#{{ order.id }}</button><code>{{ order.out_trade_no }}</code></td><td><strong>{{ orderTypeLabel(order.order_type) }}</strong><small v-if="order.plan_id">计划 #{{ order.plan_id }}</small><small v-else>到账 {{ formatMoney(order.amount) }}</small></td><td><strong>{{ formatMoney(order.pay_amount, order.currency || 'CNY') }}</strong><small v-if="order.fee_rate > 0">含费率 {{ order.fee_rate }}%</small><small v-if="order.pay_amount !== order.amount">计入余额 {{ formatMoney(order.amount) }}</small></td><td>{{ paymentMethodLabel(order.payment_type) }}</td><td><span class="status-chip" :data-tone="orderStatusTone(order.status)">{{ orderStatusLabel(order.status) }}</span></td><td>{{ formatDateTime(order.created_at) }}</td><td><div class="row-actions"><button type="button" @click="selectedOrder = order">详情</button><RouterLink v-if="canCancelOrder(order)" class="primary-action" :to="continuePaymentUrl(order)">继续支付</RouterLink><button v-if="canCancelOrder(order)" class="danger-action" type="button" @click="askCancel(order)">取消</button><button v-if="isRefundEligible(order)" class="refund-action" type="button" @click="askRefund(order)">申请退款</button></div></td></tr></tbody></table></div>
          <footer class="pagination-bar"><p>显示 {{ rangeStart }}–{{ rangeEnd }} / {{ pagination.total }}</p><label>每页 <select :value="pagination.pageSize" aria-label="每页条数" @change="changePageSize"><option v-for="size in pageSizes" :key="size" :value="size">{{ size }}</option></select> 条</label><nav aria-label="订单分页"><button type="button" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">上一页</button><span>{{ pagination.page }} / {{ pagination.pages }}</span><button type="button" :disabled="pagination.page >= pagination.pages" @click="changePage(pagination.page + 1)">下一页</button></nav></footer>
        </section>
        <section v-else class="orders-empty"><strong>没有匹配的订单</strong><span>调整状态筛选，或前往购买与充值创建新订单。</span><RouterLink to="/app/purchase">创建订单</RouterLink></section>
      </PageState>
    </div>

    <SurfaceDialog :show="Boolean(selectedOrder)" title="订单详情" :description="selectedOrder ? `订单 #${selectedOrder.id}` : ''" :width="DialogWidth.STANDARD" @close="selectedOrder = null">
      <dl v-if="selectedOrder" class="order-detail">
        <div><dt>商户订单号</dt><dd><code>{{ selectedOrder.out_trade_no }}</code></dd></div><div><dt>订单类型</dt><dd>{{ orderTypeLabel(selectedOrder.order_type) }}</dd></div><div v-if="selectedOrder.plan_id"><dt>订阅计划</dt><dd>计划 #{{ selectedOrder.plan_id }}</dd></div><div><dt>订单状态</dt><dd><span class="status-chip" :data-tone="orderStatusTone(selectedOrder.status)">{{ orderStatusLabel(selectedOrder.status) }}</span></dd></div><div><dt>支付方式</dt><dd>{{ paymentMethodLabel(selectedOrder.payment_type) }}</dd></div><div><dt>支付金额</dt><dd>{{ formatMoney(selectedOrder.pay_amount, selectedOrder.currency || 'CNY') }}</dd></div><div><dt>到账 / 套餐金额</dt><dd>{{ formatMoney(selectedOrder.amount) }}</dd></div><div><dt>费率</dt><dd>{{ selectedOrder.fee_rate }}%</dd></div><div><dt>创建时间</dt><dd>{{ formatDateTime(selectedOrder.created_at) }}</dd></div><div><dt>过期时间</dt><dd>{{ formatDateTime(selectedOrder.expires_at) }}</dd></div><div><dt>支付时间</dt><dd>{{ formatDateTime(selectedOrder.paid_at) }}</dd></div><div><dt>完成时间</dt><dd>{{ formatDateTime(selectedOrder.completed_at) }}</dd></div><div><dt>退款金额</dt><dd>{{ formatMoney(selectedOrder.refund_amount) }}</dd></div><div v-if="selectedOrder.refund_request_reason || selectedOrder.refund_reason" class="span-two"><dt>退款信息</dt><dd>{{ selectedOrder.refund_request_reason || selectedOrder.refund_reason }}</dd></div>
      </dl>
      <template #footer><RouterLink v-if="selectedOrder && canCancelOrder(selectedOrder)" class="button button--primary" :to="continuePaymentUrl(selectedOrder)">继续支付 / 查询状态</RouterLink><button class="button button--secondary" type="button" @click="selectedOrder = null">关闭</button></template>
    </SurfaceDialog>

    <SurfaceDialog :show="Boolean(cancelTarget)" title="取消待支付订单" :description="cancelTarget ? `订单 #${cancelTarget.id}` : ''" :width="DialogWidth.COMPACT" @close="cancelTarget = null">
      <div class="cancel-confirm"><strong>确认取消这笔订单？</strong><p>取消后此订单不能恢复。如仍需购买，可以重新创建订单。</p></div>
      <template #footer><button class="button button--secondary" type="button" :disabled="actionLoading" @click="cancelTarget = null">返回</button><button class="button button--danger" type="button" :disabled="actionLoading" @click="confirmCancel">{{ actionLoading ? '取消中…' : '确认取消' }}</button></template>
    </SurfaceDialog>

    <SurfaceDialog :show="Boolean(refundTarget)" title="申请退款" :description="refundTarget ? `订单 #${refundTarget.id} · ${formatMoney(refundTarget.amount)}` : ''" :width="DialogWidth.COMPACT" @close="refundTarget = null">
      <label class="refund-form" for="refund-reason"><span>退款原因</span><textarea id="refund-reason" v-model="refundReason" rows="4" maxlength="500" placeholder="请说明退款原因，提交后由支付渠道处理。" /><small>{{ refundReason.trim().length }} / 500</small></label>
      <template #footer><button class="button button--secondary" type="button" :disabled="actionLoading" @click="refundTarget = null">返回</button><button class="button button--primary" type="button" :disabled="actionLoading || !refundReason.trim()" @click="confirmRefund">{{ actionLoading ? '提交中…' : '提交退款申请' }}</button></template>
    </SurfaceDialog>
  </ConsoleShell>
</template>

<style scoped>
.orders-page { width: min(1510px, 100%); margin: 0 auto; padding-bottom: 54px; }.orders-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }.orders-heading p { margin: 0 0 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }.orders-heading h1 { font-size: clamp(40px, 5vw, 64px); }.orders-heading span { margin-top: 12px; display: block; color: var(--text-secondary); font-size: var(--font-body-sm); }.orders-heading .button { min-height: 42px; display: inline-flex; align-items: center; font-size: var(--font-meta); }
.orders-feedback { margin: 17px 0 0; padding: 10px 12px; color: var(--success); background: color-mix(in srgb, var(--success) 8%, transparent); border-left: 3px solid currentColor; font-size: var(--font-meta); }.orders-feedback.is-error { color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }.orders-toolbar { margin-top: 26px; min-height: 66px; padding: 11px 13px; display: flex; align-items: end; gap: 10px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }.orders-toolbar label { min-width: 220px; display: grid; gap: 5px; }.orders-toolbar label span { color: var(--text-secondary); font-size: var(--font-meta); }.orders-toolbar select, .pagination-bar select { min-height: 36px; padding: 0 32px 0 10px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: var(--font-meta); }.orders-toolbar > div { margin-left: auto; display: grid; justify-items: end; }.orders-toolbar > div strong { font-size: 18px; }.orders-toolbar > div span { color: var(--text-secondary); font-size: var(--font-caption); }.orders-toolbar > button { min-height: 36px; padding: 0 12px; color: var(--accent); background: transparent; border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }
.orders-panel { margin-top: 12px; overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 14px; }.orders-table { overflow: auto; }.orders-table table { width: 100%; min-width: 1120px; border-collapse: collapse; }.orders-table th, .orders-table td { padding: 13px 12px; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); vertical-align: middle; }.orders-table th { color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-caption); letter-spacing: .06em; text-transform: uppercase; }.orders-table tbody tr:hover { background: color-mix(in srgb, var(--accent) 3%, transparent); }.orders-table td strong, .orders-table td small, .orders-table td code { display: block; }.orders-table td small, .orders-table td code { max-width: 190px; margin-top: 4px; overflow: hidden; color: var(--text-secondary); font-size: var(--font-caption); text-overflow: ellipsis; white-space: nowrap; }.order-link { padding: 0; color: var(--accent); background: transparent; border: 0; cursor: pointer; font-weight: 750; }.status-chip { width: fit-content; padding: 4px 7px; display: inline-flex !important; border-radius: 999px; font-size: var(--font-caption) !important; font-weight: 740; }.status-chip[data-tone="success"] { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }.status-chip[data-tone="warning"] { color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, transparent); }.status-chip[data-tone="danger"] { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }.status-chip[data-tone="muted"] { color: var(--text-secondary); background: var(--surface-canvas); }.row-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }.row-actions button, .row-actions a { padding: 0; color: var(--text-secondary); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); text-decoration: none; }.row-actions .primary-action { color: var(--accent); }.row-actions .danger-action { color: var(--danger); }.row-actions .refund-action { color: var(--warning); }
.pagination-bar { min-height: 56px; padding: 10px 13px; display: flex; align-items: center; gap: 14px; color: var(--text-secondary); border-top: 1px solid var(--border-subtle); font-size: var(--font-meta); }.pagination-bar p { margin: 0 auto 0 0; }.pagination-bar label { display: flex; align-items: center; gap: 5px; }.pagination-bar select { min-height: 30px; padding-left: 7px; }.pagination-bar nav { display: flex; align-items: center; gap: 7px; }.pagination-bar button { min-height: 30px; padding: 0 9px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; font-size: var(--font-meta); }.pagination-bar button:disabled { opacity: .42; cursor: not-allowed; }.orders-empty { margin-top: 12px; min-height: 260px; display: grid; place-content: center; justify-items: center; gap: 7px; color: var(--text-secondary); background: var(--surface-raised); border: 1px dashed var(--border-subtle); border-radius: 14px; }.orders-empty strong { color: var(--text-primary); font-size: 15px; }.orders-empty span { font-size: var(--font-meta); }.orders-empty a { color: var(--accent); font-size: var(--font-meta); }
.order-detail { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--border-subtle); }.order-detail div { min-width: 0; padding: 13px; display: grid; gap: 5px; background: var(--surface-raised); }.order-detail .span-two { grid-column: 1 / -1; }.order-detail dt { color: var(--text-secondary); font-size: var(--font-meta); }.order-detail dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-size: var(--font-meta); }.order-detail code { font-size: var(--font-meta); }.cancel-confirm { display: grid; gap: 8px; }.cancel-confirm strong { font-size: 14px; }.cancel-confirm p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.7; }.refund-form { display: grid; gap: 7px; }.refund-form span { font-size: var(--font-meta); font-weight: 720; }.refund-form textarea { width: 100%; resize: vertical; padding: 10px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; font-size: var(--font-meta); line-height: 1.6; }.refund-form small { justify-self: end; color: var(--text-secondary); font-size: var(--font-caption); }
@media (max-width: 720px) { .orders-heading { align-items: stretch; flex-direction: column; }.orders-heading .button { justify-content: center; }.orders-toolbar { align-items: stretch; flex-wrap: wrap; }.orders-toolbar label { width: 100%; }.orders-toolbar > div { margin-left: 0; align-content: center; justify-items: start; }.orders-toolbar > button { margin-left: auto; }.pagination-bar { flex-wrap: wrap; }.pagination-bar p { width: 100%; }.order-detail { grid-template-columns: 1fr; }.order-detail .span-two { grid-column: auto; } }
</style>
