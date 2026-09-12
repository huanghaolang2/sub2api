<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/base/AppButton.vue'
import MonitorFilterMenu from '@/components/user/monitor/MonitorFilterMenu.vue'
import { UsageBoardScope } from '@/api/usageBoard'
import { UsageBoardChoiceKind, UsageBoardLoadState, type UsageBoardChoice } from '@shared-utils/usageBoard'

const props = defineProps<{ modelValue: UsageBoardChoice[]; options: UsageBoardChoice[]; label: string; kind: UsageBoardChoiceKind; scope: UsageBoardScope; state: UsageBoardLoadState; total: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: UsageBoardChoice[]]; search: [value: string]; more: []; retry: [] }>()
const { t } = useI18n()
const knownChoices = computed(() => new Map([...props.modelValue, ...props.options].map((choice) => [String(choice.id), choice])))
const labelCounts = computed(() => {
  const counts = new Map<string, number>()
  knownChoices.value.forEach((choice) => counts.set(choice.label, (counts.get(choice.label) || 0) + 1))
  return counts
})
function displayLabel(choice: UsageBoardChoice): string {
  return (labelCounts.value.get(choice.label) || 0) > 1 ? `${choice.label} (#${choice.id})` : choice.label
}
const menuOptions = computed(() => props.options.map((choice) => ({ value: String(choice.id), label: displayLabel(choice) })))
const selectedIds = computed(() => props.modelValue.map((choice) => String(choice.id)))
function select(ids: string[]): void {
  emit('update:modelValue', ids.flatMap((id) => { const choice = knownChoices.value.get(id); return choice ? [choice] : [] }))
}
</script>

<template>
  <div class="board-multi">
    <span class="board-field-label">{{ label }}</span>
    <MonitorFilterMenu :data-testid="`board-${kind}-select`" :model-value="selectedIds" :options="menuOptions" :label="label" @update:model-value="select">
      <template #search><input class="board-choice-search" type="search" :aria-label="`${t('usageBoard.search')} ${label}`" :placeholder="t('usageBoard.search')" @input="emit('search', ($event.target as HTMLInputElement).value)"></template>
      <template #empty><p v-if="state !== UsageBoardLoadState.ERROR" class="board-choice-state">{{ state === UsageBoardLoadState.LOADING ? t('usageBoard.loading') : t('usageBoard.noMatches') }}</p></template>
      <template #footer>
        <div v-if="state === UsageBoardLoadState.ERROR" class="board-choice-state" role="alert">{{ t('usageBoard.choicesFailed') }}<AppButton type="button" variant="ghost" @click="emit('retry')">{{ t('usageBoard.retry') }}</AppButton></div>
        <AppButton v-else-if="options.length < total" class="board-load-more" type="button" variant="ghost" :disabled="state === UsageBoardLoadState.LOADING" @click="emit('more')">{{ t('usageBoard.loadMore') }}</AppButton>
        <p v-if="scope === UsageBoardScope.ADMIN && kind === UsageBoardChoiceKind.KEY && options.length >= 30" class="board-choice-state">{{ t('usageBoard.searchLimit') }}</p>
      </template>
    </MonitorFilterMenu>
    <div v-if="modelValue.length" class="board-selected">
      <AppButton v-for="choice in modelValue" :key="choice.id" class="board-choice-tag" type="button" variant="ghost" :aria-label="`${t('usageBoard.remove')} ${displayLabel(choice)}`" @click="select(selectedIds.filter((id) => id !== String(choice.id)))">{{ displayLabel(choice) }} <span aria-hidden="true">×</span></AppButton>
    </div>
  </div>
</template>

<style scoped>
.board-multi { min-width: 0; }
.board-field-label { display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: var(--font-body-sm); }
.board-multi :deep(summary) { min-height: 40px; border-radius: 9px; background: var(--surface-raised); }
.board-multi :deep(.monitor-filter-menu > div) { width: min(320px, 100%); min-width: 220px; max-width: calc(100vw - 64px); }
.board-multi :deep(input[type=checkbox]) { width: 14px; height: 14px; min-height: 0; padding: 0; margin: 0; accent-color: var(--accent); }
.board-choice-search { width: 100%; min-height: 34px; margin: 8px 0 4px; padding: 7px 9px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; }
.board-choice-state { padding: 8px 6px; margin: 0; font-size: var(--font-caption); color: var(--text-secondary); }
.board-load-more { width: 100%; }
.board-selected { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.board-choice-tag { min-height: 26px; max-width: 100%; padding: 3px 7px; font-size: var(--font-caption); color: var(--accent); background: var(--accent-soft); overflow-wrap: anywhere; }
</style>
