<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as usersAPI from '@shared-api/admin/users'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { parseNonNegativeInteger } from '@/features/admin/users/model'
import { useAppStore } from '@/stores/app'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'

const props = defineProps<{ show: boolean; selectedIds: number[] }>()
const emit = defineEmits<{ close: []; applied: [affected: number] }>()
const app = useAppStore()
const confirmDialog = useConfirmStore()
const editConcurrency = ref(false)
const editRpm = ref(false)
const concurrency = ref<string | number>('')
const rpm = ref<string | number>('')
const submitting = ref(false)
const MAX_SELECTED = 500

const parsedConcurrency = computed(() => editConcurrency.value ? parseNonNegativeInteger(concurrency.value) : undefined)
const parsedRpm = computed(() => editRpm.value ? parseNonNegativeInteger(rpm.value) : undefined)
const invalid = computed(() => parsedConcurrency.value === null || parsedRpm.value === null)
const canSubmit = computed(() =>
  props.selectedIds.length > 0 && props.selectedIds.length <= MAX_SELECTED && !invalid.value &&
  (parsedConcurrency.value !== undefined || parsedRpm.value !== undefined) && !submitting.value
)

watch(() => props.show, (show) => {
  if (!show) return
  editConcurrency.value = false
  editRpm.value = false
  concurrency.value = ''
  rpm.value = ''
})

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const nextConcurrency = parsedConcurrency.value
  const nextRpm = parsedRpm.value
  if (nextConcurrency === null || nextRpm === null) return
  const changes = [
    nextConcurrency !== undefined ? `并发上限设为 ${nextConcurrency}` : '',
    nextRpm !== undefined ? `RPM 上限设为 ${nextRpm === 0 ? '不限' : nextRpm}` : ''
  ].filter(Boolean).join('；')
  const confirmed = await confirmDialog.ask({
    title: `批量修改 ${props.selectedIds.length} 个用户`,
    message: `${changes}。此操作会覆盖所选用户当前配置。`,
    confirmText: '确认批量修改',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  submitting.value = true
  try {
    const response = await usersAPI.batchUpdateLimits({
      user_ids: [...props.selectedIds],
      all: false,
      ...(nextConcurrency !== undefined ? { concurrency: nextConcurrency } : {}),
      ...(nextRpm !== undefined ? { rpm_limit: nextRpm } : {})
    })
    app.showSuccess(`已更新 ${response.affected} 个用户`)
    emit('applied', response.affected)
    emit('close')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '批量修改失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <SurfaceDialog
    :show="show"
    title="批量修改限额"
    :description="`已选择 ${selectedIds.length} 个用户，最多一次处理 ${MAX_SELECTED} 个。`"
    :width="DialogWidth.COMPACT"
    @close="emit('close')"
  >
    <form id="bulk-user-limits" class="bulk-form" @submit.prevent="submit">
      <label class="switch-row"><input v-model="editConcurrency" type="checkbox"><span><strong>覆盖并发上限</strong><small>仅勾选后才会提交此字段</small></span></label>
      <label v-if="editConcurrency" class="field"><span>并发上限</span><input v-model="concurrency" type="number" min="0" step="1"></label>
      <label class="switch-row"><input v-model="editRpm" type="checkbox"><span><strong>覆盖 RPM 上限</strong><small>0 表示不限</small></span></label>
      <label v-if="editRpm" class="field"><span>RPM 上限</span><input v-model="rpm" type="number" min="0" step="1"></label>
      <p v-if="invalid" class="form-error">请输入非负整数。</p>
      <p v-if="selectedIds.length > MAX_SELECTED" class="form-error">单次最多选择 {{ MAX_SELECTED }} 个用户。</p>
    </form>
    <template #footer>
      <button type="button" class="button button--secondary" @click="emit('close')">取消</button>
      <button type="submit" form="bulk-user-limits" class="button button--primary" :disabled="!canSubmit">{{ submitting ? '应用中…' : '应用修改' }}</button>
    </template>
  </SurfaceDialog>
</template>

<style scoped>
.bulk-form { display: grid; gap: 14px; }
.switch-row { padding: 14px; display: flex; align-items: flex-start; gap: 10px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 11px; cursor: pointer; }
.switch-row span { display: grid; gap: 4px; }
.switch-row strong { font-size: 12px; }
.switch-row small { color: var(--text-secondary); font-size: var(--font-meta); }
.field { display: grid; gap: 7px; color: var(--text-secondary); font-size: var(--font-body-sm); }
.field input { min-height: 44px; padding: 0 12px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }
.form-error { margin: 0; color: var(--danger); font-size: var(--font-body-sm); }
</style>
