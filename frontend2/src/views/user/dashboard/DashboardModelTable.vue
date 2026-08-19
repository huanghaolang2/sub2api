<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DashboardModelStat } from '@/types/user'
import { formatCompactNumber, formatCurrency } from './dashboard'

enum ModelTableSort {
  TOKENS = 'tokens',
  REQUESTS = 'requests',
  ACTUAL_COST = 'actual_cost'
}

const props = defineProps<{ models: DashboardModelStat[]; loading: boolean; error: string }>()
const emit = defineEmits<{ retry: [] }>()
const sort = ref(ModelTableSort.TOKENS)

const sortedModels = computed(() => [...props.models].sort((left, right) => {
  if (sort.value === ModelTableSort.REQUESTS) return right.requests - left.requests
  if (sort.value === ModelTableSort.ACTUAL_COST) return right.actual_cost - left.actual_cost
  return right.total_tokens - left.total_tokens
}))
</script>

<template>
  <article class="dashboard-model-table-panel">
    <header>
      <div><span>模型明细</span><strong>{{ models.length }} 个模型</strong><small>按当前日期范围汇总</small></div>
      <label><span>排序</span><select v-model="sort"><option :value="ModelTableSort.TOKENS">Tokens</option><option :value="ModelTableSort.REQUESTS">请求数</option><option :value="ModelTableSort.ACTUAL_COST">实际消费</option></select></label>
    </header>

    <div v-if="loading && models.length === 0" class="dashboard-model-table-state"><span class="dashboard-model-table-spinner" /><span>正在加载模型明细</span></div>
    <div v-else-if="error && models.length === 0" class="dashboard-model-table-state is-error"><strong>模型明细加载失败</strong><span>{{ error }}</span><button type="button" @click="emit('retry')">重新加载</button></div>
    <div v-else-if="models.length === 0" class="dashboard-model-table-state"><strong>暂无模型明细</strong><span>当前日期范围内尚未产生模型调用。</span></div>
    <div v-else class="dashboard-model-table-wrap">
      <table>
        <thead><tr><th>模型</th><th>请求</th><th>输入 / 输出</th><th>缓存创建 / 读取</th><th>总 Tokens</th><th>实际 / 标准消费</th></tr></thead>
        <tbody>
          <tr v-for="model in sortedModels" :key="model.model">
            <td><strong :title="model.model">{{ model.model }}</strong></td>
            <td>{{ formatCompactNumber(model.requests) }}</td>
            <td>{{ formatCompactNumber(model.input_tokens) }} / {{ formatCompactNumber(model.output_tokens) }}</td>
            <td>{{ formatCompactNumber(model.cache_creation_tokens) }} / {{ formatCompactNumber(model.cache_read_tokens) }}</td>
            <td><strong>{{ formatCompactNumber(model.total_tokens) }}</strong></td>
            <td><strong class="is-cost">{{ formatCurrency(model.actual_cost, 4) }}</strong><small>{{ formatCurrency(model.cost, 4) }}</small></td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>
</template>

<style scoped>
.dashboard-model-table-panel { min-width: 0; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }
.dashboard-model-table-panel > header { min-height: 76px; padding: 18px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }
.dashboard-model-table-panel > header > div { display: grid; gap: 3px; }
.dashboard-model-table-panel > header > div span { color: var(--text-secondary); font-size: 12px; font-weight: 650; }
.dashboard-model-table-panel > header > div strong { font-size: 15px; letter-spacing: -.025em; }
.dashboard-model-table-panel > header > div small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-model-table-panel > header label { display: flex; align-items: center; gap: 7px; color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-model-table-panel > header select { min-height: 30px; padding: 0 24px 0 8px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: var(--font-meta); }
.dashboard-model-table-wrap { max-height: 356px; overflow: auto; }
.dashboard-model-table-wrap table { width: 100%; min-width: 760px; border-collapse: collapse; }
.dashboard-model-table-wrap th { position: sticky; z-index: 1; top: 0; padding: 11px 16px; color: var(--text-secondary); background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); letter-spacing: .05em; text-align: right; white-space: nowrap; }
.dashboard-model-table-wrap th:first-child { text-align: left; }
.dashboard-model-table-wrap td { padding: 13px 16px; color: var(--text-secondary); border-bottom: 1px solid var(--border-subtle); font-size: var(--font-body-sm); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dashboard-model-table-wrap tr:last-child td { border-bottom: 0; }
.dashboard-model-table-wrap td:first-child { max-width: 210px; color: var(--text-primary); text-align: left; }
.dashboard-model-table-wrap td:first-child strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dashboard-model-table-wrap td:nth-child(5) strong { color: var(--text-primary); }
.dashboard-model-table-wrap td:last-child { display: grid; gap: 2px; }
.dashboard-model-table-wrap td:last-child small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-model-table-wrap .is-cost { color: var(--success); }
.dashboard-model-table-state { min-height: 250px; padding: 24px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--text-secondary); text-align: center; }
.dashboard-model-table-state strong { color: var(--text-primary); font-size: 13px; }
.dashboard-model-table-state span { max-width: 240px; font-size: var(--font-body-sm); line-height: 1.6; }
.dashboard-model-table-state button { min-height: 32px; margin-top: 5px; padding: 0 11px; color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-body-sm); font-weight: 700; }
.dashboard-model-table-state.is-error { color: var(--danger); }
.dashboard-model-table-spinner { width: 20px; height: 20px; border: 2px solid var(--border-subtle); border-top-color: var(--accent); border-radius: 50%; animation: dashboard-model-table-spin .75s linear infinite; }
@keyframes dashboard-model-table-spin { to { transform: rotate(360deg); } }
</style>
