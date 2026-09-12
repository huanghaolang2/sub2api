<script setup lang="ts">
import { computed } from 'vue'

export interface MonitorFilterOption {
  value: string
  label: string
  count?: number
}

const props = defineProps<{ modelValue: string[]; label: string; options: MonitorFilterOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const selected = computed(() => new Set(props.modelValue))
const summary = computed(() => props.modelValue.length ? `${props.label} · ${props.modelValue.length}` : `全部${props.label}`)

function toggle(value: string): void {
  const next = new Set(props.modelValue)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  emit('update:modelValue', [...next])
}
</script>

<template>
  <details class="monitor-filter-menu">
    <summary>{{ summary }}</summary>
    <div>
      <header>
        <strong>{{ label }}</strong><button
          type="button"
          :disabled="modelValue.length === 0"
          @click="emit('update:modelValue', [])"
        >
          清空
        </button>
      </header>
      <slot name="search" />
      <label
        v-for="option in options"
        :key="option.value"
      >
        <input
          type="checkbox"
          :checked="selected.has(option.value)"
          @change="toggle(option.value)"
        >
        <span>{{ option.label }}</span><small v-if="option.count != null">{{ option.count }}</small>
      </label>
      <slot name="empty" v-if="options.length === 0">
        <p>当前范围暂无选项</p>
      </slot>
      <slot name="footer" />
    </div>
  </details>
</template>

<style scoped>
.monitor-filter-menu { position: relative; }.monitor-filter-menu summary { min-height: 34px; padding: 0 10px; display: flex; align-items: center; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; list-style: none; white-space: nowrap; font-size: var(--font-meta); }.monitor-filter-menu summary::-webkit-details-marker { display: none; }.monitor-filter-menu[open] summary { border-color: var(--accent); }.monitor-filter-menu > div { z-index: 20; position: absolute; top: calc(100% + 6px); left: 0; width: 240px; max-height: 310px; padding: 8px; overflow: auto; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 10px; box-shadow: 0 16px 35px rgb(0 0 0 / 18%); }.monitor-filter-menu header { padding: 5px 6px 8px; display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); }.monitor-filter-menu header strong, .monitor-filter-menu header button { font-size: var(--font-meta); }.monitor-filter-menu header button { color: var(--accent); background: transparent; border: 0; cursor: pointer; }.monitor-filter-menu label { min-height: 34px; padding: 5px 6px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 7px; border-radius: 6px; cursor: pointer; }.monitor-filter-menu label:hover { background: var(--surface-canvas); }.monitor-filter-menu label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-meta); }.monitor-filter-menu small, .monitor-filter-menu p { color: var(--text-secondary); font-size: var(--font-caption); }.monitor-filter-menu p { padding: 15px 6px; text-align: center; }
</style>
