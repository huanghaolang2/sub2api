<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { AdminPaymentConfig, UpdatePaymentConfigRequest } from '@shared-api/admin/payment'
import { PaymentLoadBalanceStrategy, PaymentMethod, configurablePaymentMethods, paymentMethodLabels } from '@/features/admin/commerce/model'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ config: AdminPaymentConfig | null; saving: boolean }>()
const emit = defineEmits<{ save: [payload: UpdatePaymentConfigRequest] }>()
const app = useAppStore()

const form = reactive<AdminPaymentConfig>({
  enabled: false,
  min_amount: 0,
  max_amount: 0,
  daily_limit: 0,
  order_timeout_minutes: 15,
  max_pending_orders: 3,
  enabled_payment_types: [],
  balance_disabled: false,
  balance_recharge_multiplier: 1,
  subscription_usd_to_cny_rate: 0,
  recharge_fee_rate: 0,
  load_balance_strategy: PaymentLoadBalanceStrategy.ROUND_ROBIN,
  product_name_prefix: '',
  product_name_suffix: '',
  help_image_url: '',
  help_text: ''
})

function copyConfig(value: AdminPaymentConfig): AdminPaymentConfig {
  return {
    ...value,
    enabled_payment_types: [...(value.enabled_payment_types || [])]
  }
}

watch(() => props.config, (value) => { if (value) Object.assign(form, copyConfig(value)) }, { immediate: true })

function toggleMethod(method: PaymentMethod): void {
  form.enabled_payment_types = form.enabled_payment_types.includes(method)
    ? form.enabled_payment_types.filter((item) => item !== method)
    : [...form.enabled_payment_types, method]
}

function submit(): void {
  if (form.min_amount < 0 || form.max_amount < 0 || (form.max_amount > 0 && form.max_amount < form.min_amount)) { app.showError('最大金额不能小于最小金额'); return }
  if ([form.daily_limit, form.order_timeout_minutes, form.max_pending_orders, form.balance_recharge_multiplier, form.subscription_usd_to_cny_rate, form.recharge_fee_rate].some((value) => Number(value) < 0)) { app.showError('金额、时限和费率不能为负数'); return }
  if (form.enabled && form.enabled_payment_types.length === 0) { app.showError('启用支付时至少选择一种支付方式'); return }
  emit('save', copyConfig(form))
}
</script>

<template>
  <form class="resource-form-stack commerce-config" @submit.prevent="submit">
    <section class="commerce-config__hero"><div><span>支付总开关</span><h2>{{ form.enabled ? '用户可进入收银台' : '支付入口已关闭' }}</h2><p>关闭不会影响历史订单查询与管理员退款。</p></div><label class="commerce-switch"><input v-model="form.enabled" type="checkbox" /><span>{{ form.enabled ? '已启用' : '已停用' }}</span></label></section>
    <fieldset class="resource-form-section"><legend>交易边界</legend><div class="resource-form-grid resource-form-grid--3"><label>单笔最小金额<input v-model.number="form.min_amount" type="number" min="0" step="0.01" /></label><label>单笔最大金额（0 不限制）<input v-model.number="form.max_amount" type="number" min="0" step="0.01" /></label><label>每日限额（0 不限制）<input v-model.number="form.daily_limit" type="number" min="0" step="0.01" /></label><label>订单超时（分钟）<input v-model.number="form.order_timeout_minutes" type="number" min="1" step="1" /></label><label>用户最大待支付订单<input v-model.number="form.max_pending_orders" type="number" min="1" step="1" /></label><label>Provider 调度策略<select v-model="form.load_balance_strategy"><option :value="PaymentLoadBalanceStrategy.ROUND_ROBIN">轮询</option><option :value="PaymentLoadBalanceStrategy.LEAST_AMOUNT">最小累计金额</option></select></label></div></fieldset>
    <fieldset class="resource-form-section"><legend>支付方式</legend><div class="commerce-method-options"><label v-for="method in configurablePaymentMethods" :key="method"><input type="checkbox" :checked="form.enabled_payment_types.includes(method)" @change="toggleMethod(method)" /><span><strong>{{ paymentMethodLabels[method] }}</strong><small>{{ method }}</small></span></label></div></fieldset>
    <fieldset class="resource-form-section"><legend>余额与订阅换算</legend><div class="resource-form-grid resource-form-grid--4"><label>余额充值倍率<input v-model.number="form.balance_recharge_multiplier" type="number" min="0" step="0.01" /></label><label>订阅 USD → CNY 汇率<input v-model.number="form.subscription_usd_to_cny_rate" type="number" min="0" step="0.01" /></label><label>充值手续费率（%）<input v-model.number="form.recharge_fee_rate" type="number" min="0" step="0.01" /></label><label class="resource-check"><input v-model="form.balance_disabled" type="checkbox" /><span>关闭余额充值，仅售订阅</span></label></div></fieldset>
    <fieldset class="resource-form-section"><legend>账单展示与帮助</legend><div class="resource-form-grid"><label>商品名前缀<input v-model="form.product_name_prefix" maxlength="80" /></label><label>商品名后缀<input v-model="form.product_name_suffix" maxlength="80" /></label><label class="resource-field--wide">帮助图片 URL<input v-model="form.help_image_url" type="url" placeholder="https://…" /></label><label class="resource-field--wide">支付帮助文案<textarea v-model="form.help_text" rows="5" /></label></div></fieldset>
    <div class="commerce-config__actions"><span>保存后立即影响新建订单；历史订单保持原金额与 Provider。</span><button class="resource-button" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存支付配置' }}</button></div>
  </form>
</template>

<style scoped>
.commerce-config__hero { padding: 20px; display: flex; align-items: center; justify-content: space-between; gap: 18px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }
.commerce-config__hero span, .commerce-config__hero p { color: var(--text-secondary); font-size: var(--font-body-sm); }
.commerce-config__hero h2 { margin: 5px 0; font-size: 22px; }
.commerce-config__hero p { margin: 0; }
.commerce-switch { display: grid; grid-auto-flow: column; align-items: center; gap: 9px; color: var(--text-primary) !important; }
.commerce-switch input { width: 38px !important; min-height: 22px !important; accent-color: var(--accent); }
.commerce-method-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
.commerce-method-options label { padding: 11px; display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 9px; border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; }
.commerce-method-options input { width: 17px; height: 17px; accent-color: var(--accent); }
.commerce-method-options span { display: grid; }
.commerce-method-options small { color: var(--text-secondary); }
.commerce-config__actions { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.commerce-config__actions span { color: var(--text-secondary); font-size: var(--font-body-sm); }
@media (max-width: 700px) { .commerce-config__hero, .commerce-config__actions { align-items: stretch; flex-direction: column; } }
</style>
