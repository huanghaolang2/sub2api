<script setup lang="ts">
import { computed } from 'vue'
import { DashboardGranularity } from '@/types/user'
import { DashboardRangePreset, getPresetRange, rangePresetLabels } from './dashboard'

const props = defineProps<{
  preset: DashboardRangePreset
  startDate: string
  endDate: string
  granularity: DashboardGranularity
  loading: boolean
  canExport: boolean
}>()

const emit = defineEmits<{
  'select-preset': [value: Exclude<DashboardRangePreset, DashboardRangePreset.CUSTOM>]
  'update:startDate': [value: string]
  'update:endDate': [value: string]
  'apply-custom': []
  'update:granularity': [value: DashboardGranularity]
  refresh: []
  export: []
}>()

const presets: Array<Exclude<DashboardRangePreset, DashboardRangePreset.CUSTOM>> = [
  DashboardRangePreset.SEVEN_DAYS,
  DashboardRangePreset.FOURTEEN_DAYS,
  DashboardRangePreset.THIRTY_DAYS
]
const today = getPresetRange(DashboardRangePreset.SEVEN_DAYS).endDate
const validCustomRange = computed(() => Boolean(props.startDate && props.endDate && props.startDate <= props.endDate && props.endDate <= today))
</script>

<template>
  <section class="dashboard-toolbar" aria-label="看板筛选与操作">
    <div class="dashboard-range-tabs" aria-label="快捷日期范围">
      <button
        v-for="item in presets"
        :key="item"
        type="button"
        :class="{ 'is-active': preset === item }"
        @click="emit('select-preset', item)"
      >{{ rangePresetLabels[item] }}</button>
    </div>

    <div class="dashboard-toolbar__controls">
      <label class="dashboard-date-field"><span>开始</span><input :value="startDate" type="date" :max="endDate || today" @input="emit('update:startDate', ($event.target as HTMLInputElement).value)"></label>
      <span class="dashboard-date-separator">—</span>
      <label class="dashboard-date-field"><span>结束</span><input :value="endDate" type="date" :min="startDate" :max="today" @input="emit('update:endDate', ($event.target as HTMLInputElement).value)"></label>
      <button type="button" class="dashboard-apply-button" :disabled="!validCustomRange" @click="emit('apply-custom')">应用</button>
      <label class="dashboard-granularity">
        <span class="sr-only">统计粒度</span>
        <select :value="granularity" aria-label="统计粒度" @change="emit('update:granularity', ($event.target as HTMLSelectElement).value as DashboardGranularity)">
          <option :value="DashboardGranularity.DAY">按天</option>
          <option :value="DashboardGranularity.HOUR">按小时</option>
        </select>
      </label>
      <button type="button" class="dashboard-refresh-button" :disabled="loading" @click="emit('refresh')">{{ loading ? '更新中' : '刷新' }}</button>
      <button type="button" class="dashboard-export-button" :disabled="!canExport" @click="emit('export')">导出 CSV</button>
    </div>
  </section>
</template>

<style scoped>
.dashboard-toolbar { min-height: 58px; margin-top: 28px; padding: 9px 10px 9px 12px; display: flex; align-items: center; justify-content: space-between; gap: 18px; background: color-mix(in srgb, var(--border-subtle) 46%, transparent); border: 1px solid var(--border-subtle); border-radius: 14px; }
.dashboard-range-tabs { display: inline-flex; align-items: center; gap: 3px; }
.dashboard-range-tabs button { min-height: 34px; padding: 0 11px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 9px; cursor: pointer; font-size: 12px; font-weight: 640; }
.dashboard-range-tabs button:hover { color: var(--text-primary); background: color-mix(in srgb, var(--surface-raised) 68%, transparent); }
.dashboard-range-tabs button.is-active { color: var(--text-primary); background: var(--surface-raised); border-color: var(--border-subtle); }
.dashboard-toolbar__controls { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.dashboard-date-field { min-height: 36px; padding: 0 8px; display: flex; align-items: center; gap: 6px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; }
.dashboard-date-field span { font-size: var(--font-meta); }
.dashboard-date-field input { width: 112px; padding: 0; color: var(--text-primary); background: transparent; border: 0; outline: 0; font-size: var(--font-body-sm); }
.dashboard-date-separator { color: var(--text-secondary); font-size: var(--font-body-sm); }
.dashboard-apply-button, .dashboard-refresh-button, .dashboard-export-button, .dashboard-granularity select { min-height: 36px; padding: 0 10px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; cursor: pointer; font-size: var(--font-body-sm); font-weight: 650; }
.dashboard-apply-button:disabled, .dashboard-refresh-button:disabled, .dashboard-export-button:disabled { cursor: not-allowed; opacity: .48; }
.dashboard-export-button { color: white; background: var(--text-primary); border-color: var(--text-primary); }

@media (max-width: 1180px) {
  .dashboard-toolbar { align-items: flex-start; flex-direction: column; }
  .dashboard-toolbar__controls { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
}

@media (max-width: 640px) {
  .dashboard-toolbar__controls { display: grid; grid-template-columns: 1fr auto 1fr; }
  .dashboard-date-field { min-width: 0; }
  .dashboard-date-field input { width: 100%; }
  .dashboard-apply-button { grid-column: 1 / -1; }
  .dashboard-granularity, .dashboard-granularity select, .dashboard-refresh-button, .dashboard-export-button { width: 100%; }
}
</style>
