<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import PageState from '@/components/base/PageState.vue'
import { useI18n } from 'vue-i18n'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder } from '@/api/usageBoard'
import { useUsageBoard } from '@shared-composables/useUsageBoard'
import { formatUsageBoardTokens, UsageBoardChartType, UsageBoardChoiceKind, UsageBoardLoadState, UsageBoardValidation } from '@shared-utils/usageBoard'
import UsageBoardChart from './UsageBoardChart.vue'
import UsageBoardMultiSelect from './UsageBoardMultiSelect.vue'

const props = withDefaults(defineProps<{ scope?: UsageBoardScope }>(), { scope: UsageBoardScope.SELF })
const { t } = useI18n()
const { filters, selectedKeys, selectedGroups, chartType, sortOrder, pageSize, timezone, data, state, error, validation, lookups, reload, setGranularity, toggleSort, setPage, setPageSize, loadChoices, searchChoices } = useUsageBoard(props.scope)
const granularities = [UsageBoardGranularity.DAY, UsageBoardGranularity.WEEK, UsageBoardGranularity.MONTH]
const chartTypes = [UsageBoardChartType.LINE, UsageBoardChartType.BAR]
const validationMessage = computed(() => validation.value === UsageBoardValidation.VALID ? '' : t(`usageBoard.validation.${validation.value}`))
</script>

<template>
  <section class="usage-board" data-testid="usage-board" :aria-label="t('usageBoard.title')">
    <div class="governance-card">
      <header class="governance-card__header"><div><h2>{{ t('usageBoard.title') }}</h2><p>{{ t('usageBoard.source') }}</p></div><span class="board-meta">{{ t('usageBoard.timezone') }} {{ timezone }}</span></header>
      <div class="resource-form-stack" :aria-label="t('usageBoard.filters')">
        <div class="resource-form-grid resource-form-grid--3 board-dates">
          <div><span class="board-field-label">{{ t('usageBoard.granularity') }}</span><div class="resource-tabs board-inline-tabs" :aria-label="t('usageBoard.granularity')"><button v-for="value in granularities" :key="value" type="button" :aria-selected="filters.granularity === value" :aria-pressed="filters.granularity === value" :data-testid="`board-granularity-${value}`" @click="setGranularity(value)">{{ t(`usageBoard.${value}`) }}</button></div></div>
          <template v-if="filters.granularity === UsageBoardGranularity.MONTH">
            <label>{{ t('usageBoard.startMonth') }}<input v-model="filters.startMonth" type="month" :aria-invalid="Boolean(validationMessage)" data-testid="board-start-month"></label>
            <label>{{ t('usageBoard.endMonth') }}<input v-model="filters.endMonth" type="month" :aria-invalid="Boolean(validationMessage)" data-testid="board-end-month"></label>
          </template>
          <template v-else>
            <label>{{ t('usageBoard.startDate') }}<input v-model="filters.startDate" type="date" :aria-invalid="Boolean(validationMessage)" data-testid="board-start-date"></label>
            <label>{{ t('usageBoard.endDate') }}<input v-model="filters.endDate" type="date" :aria-invalid="Boolean(validationMessage)" data-testid="board-end-date"></label>
          </template>
        </div>
        <div class="resource-form-grid board-choices">
          <UsageBoardMultiSelect v-model="selectedKeys" :kind="UsageBoardChoiceKind.KEY" :scope="scope" :options="lookups.key.options" :state="lookups.key.state" :total="lookups.key.total" :label="t('usageBoard.apiKey')" @search="searchChoices(UsageBoardChoiceKind.KEY, $event)" @more="loadChoices(UsageBoardChoiceKind.KEY, true)" @retry="loadChoices(UsageBoardChoiceKind.KEY)" />
          <UsageBoardMultiSelect v-model="selectedGroups" :kind="UsageBoardChoiceKind.GROUP" :scope="scope" :options="lookups.group.options" :state="lookups.group.state" :total="lookups.group.total" :label="t('usageBoard.group')" @search="searchChoices(UsageBoardChoiceKind.GROUP, $event)" @more="loadChoices(UsageBoardChoiceKind.GROUP, true)" @retry="loadChoices(UsageBoardChoiceKind.GROUP)" />
        </div>
        <p v-if="validationMessage" class="board-error" role="alert">{{ validationMessage }}</p>
        <p v-else-if="filters.granularity === UsageBoardGranularity.WEEK" class="board-meta">{{ t('usageBoard.weekHint') }}</p>
      </div>
    </div>
    <div class="governance-card" :aria-busy="state === UsageBoardLoadState.LOADING">
      <header class="governance-card__header board-chart-heading"><h3>{{ t('usageBoard.trend') }}</h3><div class="resource-tabs board-inline-tabs" :aria-label="t('usageBoard.chartType')"><button v-for="value in chartTypes" :key="value" type="button" :aria-selected="chartType === value" :aria-pressed="chartType === value" :data-testid="`board-chart-${value}`" @click="chartType = value">{{ t(`usageBoard.${value}`) }}</button></div></header>
      <PageState :loading="state === UsageBoardLoadState.LOADING" :error="state === UsageBoardLoadState.ERROR ? error || t('usageBoard.failed') : ''" @retry="reload"><UsageBoardChart v-if="data" :data="data" :type="chartType" /></PageState>
    </div>
    <section v-if="data" class="board-results">
      <header class="governance-card__header"><h3>{{ t('usageBoard.results') }}</h3><span class="board-meta">{{ t('usageBoard.rowCount', { count: data.pagination.total }) }}</span></header>
      <div class="resource-table board-table"><table data-testid="board-table"><thead><tr><th scope="col">{{ t('usageBoard.period') }}</th><th scope="col">{{ t('usageBoard.apiKey') }}</th><th scope="col" :aria-sort="sortOrder === UsageBoardSortOrder.DESC ? 'descending' : 'ascending'"><button type="button" data-testid="board-token-sort" @click="toggleSort">{{ t('usageBoard.tokens') }} <span aria-hidden="true">{{ sortOrder === UsageBoardSortOrder.DESC ? '↓' : '↑' }}</span></button></th></tr></thead><tbody><tr v-for="row in data.rows" :key="`${row.api_key_id ?? 'empty'}-${row.period_start}`" :data-state="row.data_state"><td>{{ row.period_label }} <span v-if="row.coverage === UsageBoardCoverage.PARTIAL" class="board-badge">{{ t('usageBoard.partial') }}</span></td><td>{{ row.api_key_name }}</td><td>{{ formatUsageBoardTokens(row.total_tokens) }} {{ t('usageBoard.tokenUnit') }}<span v-if="row.data_state === UsageBoardDataState.MISSING" class="board-badge">{{ t('usageBoard.noData') }}</span></td></tr></tbody></table></div>
      <footer class="resource-pagination"><label class="board-page-size">{{ t('usageBoard.pageSize') }} <select :value="pageSize" @change="setPageSize(Number(($event.target as HTMLSelectElement).value))"><option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }}</option></select></label><div class="resource-pagination__actions"><span>{{ data.pagination.page }} / {{ data.pagination.pages }}</span><AppButton variant="secondary" type="button" :disabled="data.pagination.page <= 1" @click="setPage(data.pagination.page - 1)">{{ t('usageBoard.previous') }}</AppButton><AppButton variant="secondary" type="button" :disabled="data.pagination.page >= data.pagination.pages" @click="setPage(data.pagination.page + 1)">{{ t('usageBoard.next') }}</AppButton></div></footer>
    </section>
  </section>
</template>

<style scoped>
.usage-board { display: grid; min-width: 0; gap: 20px; --board-bg: var(--surface-raised); --board-subtle: var(--surface-canvas); --board-border: var(--border-subtle); --board-text: var(--text-primary); --board-muted: var(--text-secondary); --board-accent: var(--accent); }
.governance-card { min-width: 0; }
.governance-card__header { flex-wrap: wrap; align-items: center; }
.board-meta { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); }
.board-field-label { display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: var(--font-body-sm); }
.board-dates, .board-choices { max-width: 860px; }
.board-inline-tabs { padding: 0; border: 0; width: fit-content; }
.board-inline-tabs button { min-height: 40px; }
.board-error { color: var(--danger); font-size: var(--font-body-sm); margin: 0; }
.board-results { display: grid; gap: 14px; min-width: 0; }
.board-results h3 { margin: 0; font-size: 16px; }
.board-table table { min-width: 0; }
.board-table th, .board-table td { white-space: nowrap; }
.board-table th:last-child, .board-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.board-table th button { font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer; }
.board-badge { display: inline-block; margin-left: 7px; padding: 2px 5px; color: var(--text-secondary); border: 1px dashed var(--border-subtle); border-radius: 5px; font-size: var(--font-caption); }
.board-page-size { display: flex; align-items: center; gap: 8px; }
.board-page-size select { padding: 7px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; }
</style>
