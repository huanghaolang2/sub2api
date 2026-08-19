<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { PaymentOrder } from '@/types/payment'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { PaymentOrderStatus, formatCurrency, refundableAmount } from '@/features/admin/commerce/model'

const props = withDefaults(defineProps<{
  show: boolean
  order: PaymentOrder | null
  submitting?: boolean
  requireForce?: boolean
  warning?: string
}>(), { submitting: false, requireForce: false, warning: '' })

const emit = defineEmits<{
  close: []
  submit: [payload: { amount: number; reason: string; deduct_balance: boolean; force: boolean }]
}>()

const form = reactive({ amount: 0, reason: '', deduct_balance: true, force: false })
const maximum = computed(() => props.order ? refundableAmount(props.order) : 0)
const requested = computed(() => props.order?.status === PaymentOrderStatus.REFUND_REQUESTED ? Number(props.order.refund_amount || 0) : 0)

watch(() => props.show, (show) => {
  if (!show || !props.order) return
  Object.assign(form, {
    amount: requested.value > 0 ? requested.value : maximum.value,
    reason: props.order.refund_request_reason || '',
    deduct_balance: true,
    force: false
  })
})

function submit(): void {
  if (!props.order || form.amount <= 0 || form.amount > maximum.value || !form.reason.trim()) return
  if (props.requireForce && !form.force) return
  emit('submit', { ...form, reason: form.reason.trim() })
}
</script>

<template>
  <SurfaceDialog :show="show" title="处理订单退款" description="退款金额按账户记账币种计算；上游无法确认时后端会要求显式强制退款。" :width="DialogWidth.STANDARD" @close="emit('close')">
    <form id="order-refund-form" class="resource-form-stack" @submit.prevent="submit">
      <section v-if="order" class="commerce-refund-order"><div><span>订单</span><strong>#{{ order.id }}</strong><small>{{ order.out_trade_no }}</small></div><div><span>入账 / 已退款</span><strong>{{ formatCurrency(order.amount, 'USD') }}</strong><small>{{ formatCurrency(order.refund_amount, 'USD') }}</small></div><div><span>本次最多</span><strong>{{ formatCurrency(maximum, 'USD') }}</strong><small>{{ order.status }}</small></div></section>
      <p v-if="order?.refund_request_reason" class="commerce-refund-request"><strong>用户退款理由</strong>{{ order.refund_request_reason }}</p>
      <label class="resource-check"><input v-model="form.deduct_balance" type="checkbox" /><span>同时扣回用户余额 / 订阅权益</span></label>
      <div class="resource-form-grid"><label>退款金额（USD）*<input v-model.number="form.amount" type="number" min="0.01" :max="maximum" step="0.01" /></label><label>最大可退<input :value="maximum.toFixed(2)" disabled /></label></div>
      <label>退款理由 *<textarea v-model="form.reason" rows="4" placeholder="记录审核理由，便于后续审计" /></label>
      <p v-if="warning" class="commerce-refund-warning">{{ warning }}</p>
      <label v-if="requireForce" class="resource-check commerce-refund-force"><input v-model="form.force" type="checkbox" /><span>我已核对警告，仍要执行强制退款</span></label>
    </form>
    <template #footer><button class="button button--secondary" @click="emit('close')">取消</button><button type="submit" form="order-refund-form" class="button button--danger" :disabled="submitting || form.amount <= 0 || form.amount > maximum || !form.reason.trim() || (requireForce && !form.force)">{{ submitting ? '处理中…' : requireForce ? '确认强制退款' : '确认退款' }}</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.commerce-refund-order { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; overflow: hidden; background: var(--border-subtle); border: 1px solid var(--border-subtle); border-radius: 13px; }
.commerce-refund-order > div { padding: 13px; display: grid; gap: 4px; background: var(--surface-raised); }
.commerce-refund-order span, .commerce-refund-order small { color: var(--text-secondary); font-size: var(--font-meta); overflow-wrap: anywhere; }
.commerce-refund-request, .commerce-refund-warning { margin: 0; padding: 13px; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 10px; font-size: 12px; line-height: 1.6; }
.commerce-refund-request strong { margin-right: 8px; color: var(--text-primary); }
.commerce-refund-warning, .commerce-refund-force { color: var(--danger) !important; border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border-subtle)); }
.button--danger { color: white; background: var(--danger); border-color: var(--danger); }
@media (max-width: 620px) { .commerce-refund-order { grid-template-columns: 1fr; } }
</style>
