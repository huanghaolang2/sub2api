<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { AdminPaymentConfig } from '@shared-api/admin/payment'
import type { AdminGroup } from '@/types'
import type { SubscriptionPlan } from '@/types/payment'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { PlanValidityUnit, formatCurrency, normalizePlanValidityUnit, parseLines } from '@/features/admin/commerce/model'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean; plan: SubscriptionPlan | null; groups: AdminGroup[]; config: AdminPaymentConfig | null; saving: boolean }>()
const emit = defineEmits<{ close: []; submit: [payload: Record<string, unknown>] }>()
const app = useAppStore()
const form = reactive({ name: '', groupId: '' as number | '', description: '', price: 0, originalPrice: 0, currency: '', validityDays: 30, validityUnit: PlanValidityUnit.DAYS as string, features: '', forSale: true, sortOrder: 0 })
const subscriptionGroups = computed(() => props.groups.filter((item) => item.subscription_type === 'subscription'))
const selectedGroup = computed(() => props.groups.find((item) => item.id === Number(form.groupId)))
const cnyPreview = computed(() => { const rate = Number(props.config?.subscription_usd_to_cny_rate || 0); const fee = Number(props.config?.recharge_fee_rate || 0); if (!rate || !form.price) return ''; const base = Number(form.price) * rate; return `${formatCurrency(base + base * fee / 100, 'CNY')}（含 ${fee}% 手续费）` })

watch(() => props.show, (show) => {
  if (!show) return
  const value = props.plan
  Object.assign(form, value ? { name: value.name, groupId: value.group_id, description: value.description, price: value.price, originalPrice: value.original_price || 0, currency: value.currency || '', validityDays: value.validity_days, validityUnit: normalizePlanValidityUnit(value.validity_unit), features: (value.features || []).join('\n'), forSale: value.for_sale, sortOrder: value.sort_order || 0 } : { name: '', groupId: '', description: '', price: 0, originalPrice: 0, currency: '', validityDays: 30, validityUnit: PlanValidityUnit.DAYS, features: '', forSale: true, sortOrder: 0 })
})

function submit(): void {
  if (!form.name.trim() || !form.description.trim() || !form.groupId) { app.showError('名称、描述和订阅分组不能为空'); return }
  if (Number(form.price) <= 0 || !Number.isInteger(Number(form.validityDays)) || Number(form.validityDays) < 1) { app.showError('价格必须大于 0，有效期至少为 1'); return }
  emit('submit', { name: form.name.trim(), group_id: Number(form.groupId), description: form.description.trim(), price: Number(form.price), original_price: Number(form.originalPrice) || 0, currency: form.currency.trim().toUpperCase(), validity_days: Number(form.validityDays), validity_unit: form.validityUnit, features: parseLines(form.features).join('\n'), for_sale: form.forSale, sort_order: Number(form.sortOrder) || 0 })
}
</script>

<template><SurfaceDialog :show="show" :title="plan ? '编辑订阅计划' : '创建订阅计划'" description="计划只负责销售展示与有效期；实际额度、平台和倍率来自绑定的订阅分组。" :width="DialogWidth.WIDE" @close="emit('close')"><form id="payment-plan-form" class="resource-form-stack" @submit.prevent="submit"><div class="resource-form-grid"><label>计划名称 *<input v-model="form.name" /></label><label>订阅分组 *<select v-model="form.groupId"><option value="">请选择</option><option v-for="group in subscriptionGroups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.platform }}</option></select></label></div><section v-if="selectedGroup" class="commerce-plan-group"><strong>{{ selectedGroup.name }}</strong><span>{{ selectedGroup.platform }} · {{ selectedGroup.rate_multiplier }}x</span><small>日 {{ selectedGroup.daily_limit_usd == null ? '不限' : `$${selectedGroup.daily_limit_usd}` }} · 周 {{ selectedGroup.weekly_limit_usd == null ? '不限' : `$${selectedGroup.weekly_limit_usd}` }} · 月 {{ selectedGroup.monthly_limit_usd == null ? '不限' : `$${selectedGroup.monthly_limit_usd}` }}</small></section><label>计划描述 *<textarea v-model="form.description" rows="3" /></label><div class="resource-form-grid resource-form-grid--4"><label>价格 *<input v-model.number="form.price" type="number" min="0.01" step="0.01" /><small v-if="cnyPreview">预计支付 {{ cnyPreview }}</small></label><label>原价<input v-model.number="form.originalPrice" type="number" min="0" step="0.01" /></label><label>币种标签<input v-model="form.currency" maxlength="3" placeholder="USD" /></label><label>排序<input v-model.number="form.sortOrder" type="number" step="1" /></label><label>有效期 *<input v-model.number="form.validityDays" type="number" min="1" step="1" /></label><label>有效期单位<select v-model="form.validityUnit"><option v-for="unit in PlanValidityUnit" :key="unit" :value="unit">{{ unit }}</option></select></label><label class="resource-check"><input v-model="form.forSale" type="checkbox" /><span>在用户购买页销售</span></label></div><label>卖点（每行一个）<textarea v-model="form.features" rows="6" /></label></form><template #footer><button class="button button--secondary" @click="emit('close')">取消</button><button type="submit" form="payment-plan-form" class="button button--primary" :disabled="saving">{{ saving ? '保存中…' : '保存计划' }}</button></template></SurfaceDialog></template>

<style scoped>.commerce-plan-group { padding: 13px; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }.commerce-plan-group span, .commerce-plan-group small { color: var(--text-secondary); }.commerce-plan-group small { grid-column: 1 / -1; }</style>
