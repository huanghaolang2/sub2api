<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { PaymentChannel } from '@/types/payment'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { parseLines } from '@/features/admin/commerce/model'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean; channel: PaymentChannel | null; saving: boolean }>()
const emit = defineEmits<{ close: []; submit: [payload: Partial<PaymentChannel>] }>()
const app = useAppStore()
const form = reactive({ name: '', groupId: '' as number | '', platform: '', rateMultiplier: 1, description: '', models: '', features: '', enabled: true })

watch(() => props.show, (show) => {
  if (!show) return
  const value = props.channel
  Object.assign(form, value ? { name: value.name, groupId: value.group_id || '', platform: value.platform, rateMultiplier: value.rate_multiplier, description: value.description, models: (value.models || []).join('\n'), features: (value.features || []).join('\n'), enabled: value.enabled } : { name: '', groupId: '', platform: '', rateMultiplier: 1, description: '', models: '', features: '', enabled: true })
})

function submit(): void {
  if (!form.name.trim() || !form.platform.trim()) { app.showError('渠道名称和平台不能为空'); return }
  if (Number(form.rateMultiplier) <= 0) { app.showError('费率倍率必须大于 0'); return }
  emit('submit', { name: form.name.trim(), group_id: form.groupId === '' ? undefined : Number(form.groupId), platform: form.platform.trim(), rate_multiplier: Number(form.rateMultiplier), description: form.description.trim(), models: parseLines(form.models), features: parseLines(form.features), enabled: form.enabled })
}
</script>

<template><SurfaceDialog :show="show" :title="channel ? '编辑支付渠道' : '创建支付渠道'" description="渠道描述用户可选的产品入口；模型与能力按行维护。" :width="DialogWidth.WIDE" @close="emit('close')"><form id="payment-channel-form" class="resource-form-stack" @submit.prevent="submit"><div class="resource-form-grid resource-form-grid--3"><label>渠道名称 *<input v-model="form.name" /></label><label>平台键 *<input v-model="form.platform" placeholder="openai / mixed" /></label><label>关联分组 ID<input v-model.number="form.groupId" type="number" min="1" placeholder="可选" /></label><label>费率倍率 *<input v-model.number="form.rateMultiplier" type="number" min="0.01" step="0.01" /></label><label class="resource-check"><input v-model="form.enabled" type="checkbox" /><span>启用渠道</span></label><label class="resource-field--wide">描述<textarea v-model="form.description" rows="3" /></label><label>模型（每行一个）<textarea v-model="form.models" rows="7" placeholder="gpt-5.5" /></label><label>功能卖点（每行一个）<textarea v-model="form.features" rows="7" placeholder="低延迟" /></label></div></form><template #footer><button class="button button--secondary" @click="emit('close')">取消</button><button type="submit" form="payment-channel-form" class="button button--primary" :disabled="saving">{{ saving ? '保存中…' : '保存渠道' }}</button></template></SurfaceDialog></template>
