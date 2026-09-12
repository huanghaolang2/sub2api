<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder, type UsageBoardRow } from '@/api/usageBoard'
import { useUsageBoard } from '@/composables/useUsageBoard'
import { UsageBoardChartType, UsageBoardChoiceKind, UsageBoardLoadState, UsageBoardValidation } from '@/utils/usageBoard'
import DataTable from '@/components/common/DataTable.vue'
import Pagination from '@/components/common/Pagination.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import type { Column } from '@/components/common/types'
import UsageBoardChart from './UsageBoardChart.vue'
import UsageBoardMultiSelect from './UsageBoardMultiSelect.vue'

const props = withDefaults(defineProps<{ scope?: UsageBoardScope }>(), { scope: UsageBoardScope.SELF })
const { t } = useI18n()
const { filters, selectedKeys, selectedGroups, chartType, sortOrder, pageSize, timezone, data, state, error, validation, lookups, reload, setGranularity, toggleSort, setPage, setPageSize, loadChoices, searchChoices } = useUsageBoard(props.scope)
const granularities = [UsageBoardGranularity.DAY, UsageBoardGranularity.WEEK, UsageBoardGranularity.MONTH]
const chartTypes = [UsageBoardChartType.LINE, UsageBoardChartType.BAR]
const validationMessage = computed(() => validation.value === UsageBoardValidation.VALID ? '' : t(`usageBoard.validation.${validation.value}`))
const columns = computed<Column[]>(() => [
  { key: 'period_label', label: t('usageBoard.period') },
  { key: 'api_key_name', label: t('usageBoard.apiKey') },
  { key: 'total_tokens', label: t('usageBoard.tokens'), sortable: true, class: 'text-right' }
])
function rowKey(row: UsageBoardRow): string { return `${row.api_key_id ?? 'empty'}-${row.period_start}` }
function onSort(_key: string, order: 'asc' | 'desc'): void {
  sortOrder.value = order === 'asc' ? UsageBoardSortOrder.ASC : UsageBoardSortOrder.DESC
}
</script>

<template>
  <section class="usage-board min-w-0 space-y-6" data-testid="usage-board" :aria-label="t('usageBoard.title')">
    <div class="card p-4" :aria-label="t('usageBoard.filters')">
      <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('usageBoard.title') }}</h2>
          <p class="mt-1 text-xs text-gray-500 dark:text-dark-400">{{ t('usageBoard.source') }}</p>
        </div>
        <span class="text-xs text-gray-500 dark:text-dark-400">{{ t('usageBoard.timezone') }} {{ timezone }}</span>
      </header>
      <div class="flex flex-wrap items-start gap-4">
        <div class="w-full sm:w-auto">
          <span class="input-label">{{ t('usageBoard.granularity') }}</span>
          <div class="tabs w-fit" :aria-label="t('usageBoard.granularity')">
            <button v-for="value in granularities" :key="value" type="button" class="tab" :class="{ 'tab-active': filters.granularity === value }" :aria-pressed="filters.granularity === value" :data-testid="`board-granularity-${value}`" @click="setGranularity(value)">{{ t(`usageBoard.${value}`) }}</button>
          </div>
        </div>
        <template v-if="filters.granularity === UsageBoardGranularity.MONTH">
          <label class="min-w-0 flex-1 sm:max-w-48"><span class="input-label">{{ t('usageBoard.startMonth') }}</span><input v-model="filters.startMonth" type="month" class="input" :class="{ 'input-error': validationMessage }" :aria-invalid="Boolean(validationMessage)" data-testid="board-start-month"></label>
          <label class="min-w-0 flex-1 sm:max-w-48"><span class="input-label">{{ t('usageBoard.endMonth') }}</span><input v-model="filters.endMonth" type="month" class="input" :class="{ 'input-error': validationMessage }" :aria-invalid="Boolean(validationMessage)" data-testid="board-end-month"></label>
        </template>
        <template v-else>
          <label class="min-w-0 flex-1 sm:max-w-48"><span class="input-label">{{ t('usageBoard.startDate') }}</span><input v-model="filters.startDate" type="date" class="input" :class="{ 'input-error': validationMessage }" :aria-invalid="Boolean(validationMessage)" data-testid="board-start-date"></label>
          <label class="min-w-0 flex-1 sm:max-w-48"><span class="input-label">{{ t('usageBoard.endDate') }}</span><input v-model="filters.endDate" type="date" class="input" :class="{ 'input-error': validationMessage }" :aria-invalid="Boolean(validationMessage)" data-testid="board-end-date"></label>
        </template>
      </div>
      <div class="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:max-w-3xl">
        <UsageBoardMultiSelect v-model="selectedKeys" :kind="UsageBoardChoiceKind.KEY" :scope="scope" :options="lookups.key.options" :state="lookups.key.state" :total="lookups.key.total" :label="t('usageBoard.apiKey')" @search="searchChoices(UsageBoardChoiceKind.KEY, $event)" @more="loadChoices(UsageBoardChoiceKind.KEY, true)" @retry="loadChoices(UsageBoardChoiceKind.KEY)" />
        <UsageBoardMultiSelect v-model="selectedGroups" :kind="UsageBoardChoiceKind.GROUP" :scope="scope" :options="lookups.group.options" :state="lookups.group.state" :total="lookups.group.total" :label="t('usageBoard.group')" @search="searchChoices(UsageBoardChoiceKind.GROUP, $event)" @more="loadChoices(UsageBoardChoiceKind.GROUP, true)" @retry="loadChoices(UsageBoardChoiceKind.GROUP)" />
      </div>
      <p v-if="validationMessage" class="input-error-text mt-3" role="alert">{{ validationMessage }}</p>
      <p v-else-if="filters.granularity === UsageBoardGranularity.WEEK" class="input-hint mt-3">{{ t('usageBoard.weekHint') }}</p>
    </div>

    <div class="card p-4" :aria-busy="state === UsageBoardLoadState.LOADING">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('usageBoard.trend') }}</h3>
        <div class="tabs" :aria-label="t('usageBoard.chartType')">
          <button v-for="value in chartTypes" :key="value" type="button" class="tab" :class="{ 'tab-active': chartType === value }" :aria-pressed="chartType === value" :data-testid="`board-chart-${value}`" @click="chartType = value">{{ t(`usageBoard.${value}`) }}</button>
        </div>
      </div>
      <div v-if="state === UsageBoardLoadState.LOADING" class="flex h-64 items-center justify-center"><LoadingSpinner /></div>
      <div v-else-if="state === UsageBoardLoadState.ERROR" class="flex h-64 flex-col items-center justify-center gap-4 text-sm text-red-500" role="alert"><p>{{ error || t('usageBoard.failed') }}</p><button class="btn btn-secondary" type="button" @click="reload">{{ t('usageBoard.retry') }}</button></div>
      <UsageBoardChart v-else-if="data" :data="data" :type="chartType" />
    </div>

    <div v-if="data" class="card overflow-hidden" data-testid="board-table">
      <div class="card-header flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('usageBoard.results') }}</h3>
        <button type="button" class="btn btn-secondary btn-sm md:hidden" data-testid="board-token-sort-mobile" @click="toggleSort">{{ t('usageBoard.tokens') }} {{ sortOrder === UsageBoardSortOrder.DESC ? '↓' : '↑' }}</button>
        <span class="hidden text-xs text-gray-500 dark:text-dark-400 md:inline">{{ t('usageBoard.rowCount', { count: data.pagination.total }) }}</span>
      </div>
      <DataTable :columns="columns" :data="data.rows" :row-key="rowKey" :server-side-sort="true" default-sort-key="total_tokens" :default-sort-order="sortOrder" @sort="onSort">
        <template #header-total_tokens><button type="button" data-testid="board-token-sort">{{ t('usageBoard.tokens') }}</button></template>
        <template #cell-period_label="{ row }"><span>{{ row.period_label }}</span><span v-if="row.coverage === UsageBoardCoverage.PARTIAL" class="ml-2 text-xs text-gray-400 dark:text-dark-400">{{ t('usageBoard.partial') }}</span></template>
        <template #cell-total_tokens="{ row }"><span class="inline-flex items-center justify-end gap-2 tabular-nums" :data-state="row.data_state"><span>{{ row.total_tokens.toLocaleString() }}</span><span v-if="row.data_state === UsageBoardDataState.MISSING" class="rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-xs text-gray-400 dark:border-dark-600 dark:text-dark-400">{{ t('usageBoard.noData') }}</span></span></template>
      </DataTable>
      <Pagination :page="data.pagination.page" :total="data.pagination.total" :page-size="pageSize" @update:page="setPage" @update:pageSize="setPageSize" />
    </div>
  </section>
</template>

<style scoped>
.usage-board { --board-bg: #fff; --board-subtle: #f9fafb; --board-border: #e5e7eb; --board-text: #374151; --board-muted: #6b7280; --board-accent: #3b82f6; }
:global(.dark .usage-board) { --board-bg: #1e293b; --board-subtle: #0f172a; --board-border: #374151; --board-text: #e5e7eb; --board-muted: #9ca3af; }
</style>
