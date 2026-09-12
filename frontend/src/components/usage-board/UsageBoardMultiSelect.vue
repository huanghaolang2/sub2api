<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Select, { type SelectOption } from '@/components/common/Select.vue'
import Icon from '@/components/icons/Icon.vue'
import { UsageBoardScope } from '@/api/usageBoard'
import { UsageBoardChoiceKind, UsageBoardLoadState, type UsageBoardChoice } from '@/utils/usageBoard'

enum ChoiceAction { MORE = 'more', RETRY = 'retry' }
const props = defineProps<{ modelValue: UsageBoardChoice[]; options: UsageBoardChoice[]; label: string; kind: UsageBoardChoiceKind; scope: UsageBoardScope; state: UsageBoardLoadState; total: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: UsageBoardChoice[]]; search: [value: string]; more: []; retry: [] }>()
const { t } = useI18n()
const labelCounts = computed(() => {
  const choices = new Map([...props.options, ...props.modelValue].map((choice) => [choice.id, choice]))
  const counts = new Map<string, number>()
  choices.forEach((choice) => counts.set(choice.label, (counts.get(choice.label) || 0) + 1))
  return counts
})
function displayLabel(choice: UsageBoardChoice): string {
  return (labelCounts.value.get(choice.label) || 0) > 1 ? `${choice.label} (#${choice.id})` : choice.label
}
function toggle(choice: UsageBoardChoice): void {
  emit('update:modelValue', props.modelValue.some((item) => item.id === choice.id)
    ? props.modelValue.filter((item) => item.id !== choice.id)
    : [...props.modelValue, choice])
}
const selectOptions = computed<SelectOption[]>(() => {
  const options: SelectOption[] = props.options.map((choice) => ({ value: choice.id, label: displayLabel(choice) }))
  if (props.state === UsageBoardLoadState.ERROR) options.push({ value: ChoiceAction.RETRY, label: t('usageBoard.retry') })
  else if (props.options.length < props.total) options.push({ value: ChoiceAction.MORE, label: t('usageBoard.loadMore'), disabled: props.state === UsageBoardLoadState.LOADING })
  return options
})
function select(value: string | number | boolean | null): void {
  if (value === ChoiceAction.MORE) { emit('more'); return }
  if (value === ChoiceAction.RETRY) { emit('retry'); return }
  const choice = props.options.find((item) => item.id === value)
  if (choice) toggle(choice)
}
</script>

<template>
  <div class="min-w-0">
    <label class="input-label" :for="`board-${kind}-input`">{{ label }}</label>
    <Select :id="`board-${kind}-input`" :data-testid="`board-${kind}-select`" :model-value="null" :options="selectOptions" :aria-label="label" :search-placeholder="`${t('usageBoard.search')} ${label}`" :empty-text="t('usageBoard.noMatches')" :loading="state === UsageBoardLoadState.LOADING" remote searchable @change="select" @search="emit('search', $event)">
      <template #selected>{{ modelValue.length ? t('usageBoard.selectedCount', { count: modelValue.length }) : t('usageBoard.all') }}</template>
      <template #option="{ option }">
        <span v-if="typeof option.value === 'number'" class="flex w-full items-center gap-2" role="checkbox" :aria-checked="modelValue.some((item) => item.id === option.value)" :data-testid="`board-${kind}-option-${option.value}`">
          <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded border" :class="modelValue.some((item) => item.id === option.value) ? 'border-primary-500 bg-primary-500 text-white' : 'border-gray-300 dark:border-dark-500'"><Icon v-if="modelValue.some((item) => item.id === option.value)" name="check" size="sm" /></span>
          <span class="select-option-label">{{ option.label }}</span>
        </span>
        <span v-else class="text-primary-600 dark:text-primary-400">{{ option.label }}</span>
      </template>
    </Select>
    <div v-if="modelValue.length" class="mt-2 flex flex-wrap items-center gap-1.5">
      <button v-for="choice in modelValue" :key="choice.id" type="button" class="inline-flex max-w-full items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-700 dark:bg-primary-900/20 dark:text-primary-300" :aria-label="`${t('usageBoard.remove')} ${displayLabel(choice)}`" @click="toggle(choice)"><span class="truncate">{{ displayLabel(choice) }}</span><Icon name="x" size="sm" /></button>
      <button class="btn btn-ghost btn-sm !px-2 !py-1 !text-xs" type="button" @click="emit('update:modelValue', [])">{{ t('usageBoard.clear') }}</button>
    </div>
    <p v-if="state === UsageBoardLoadState.ERROR" role="alert" class="input-error-text">{{ t('usageBoard.choicesFailed') }}</p>
    <p v-if="scope === UsageBoardScope.ADMIN && kind === UsageBoardChoiceKind.KEY && options.length >= 30" class="input-hint">{{ t('usageBoard.searchLimit') }}</p>
  </div>
</template>
