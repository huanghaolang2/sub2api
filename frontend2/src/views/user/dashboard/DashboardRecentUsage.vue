<script setup lang="ts">
import { computed } from 'vue'
import type { UsageLog } from '@/types/user'
import { formatCompactNumber, formatCurrency, formatUsageTime } from './dashboard'

const props = defineProps<{ items: UsageLog[]; loading: boolean; error: string }>()
const emit = defineEmits<{ retry: [] }>()

function totalTokens(item: UsageLog): number {
  return item.input_tokens + item.output_tokens + (item.cache_creation_tokens ?? 0) + item.cache_read_tokens
}

const latestUsageTime = computed(() => props.items[0]?.created_at ? formatUsageTime(props.items[0].created_at) : '—')
</script>

<template>
  <article class="dashboard-recent-panel">
    <header>
      <div><span>近期调用</span><strong>{{ items.length }}</strong><small>最新 {{ latestUsageTime }}</small></div>
      <RouterLink to="/app/usage">查看全部 →</RouterLink>
    </header>

    <div v-if="loading && items.length === 0" class="dashboard-recent-state"><span class="dashboard-recent-spinner" /><span>正在加载调用记录</span></div>
    <div v-else-if="error && items.length === 0" class="dashboard-recent-state is-error"><strong>调用记录加载失败</strong><span>{{ error }}</span><button type="button" @click="emit('retry')">重新加载</button></div>
    <div v-else-if="items.length === 0" class="dashboard-recent-state"><strong>当前范围暂无调用</strong><span>完成第一次 API 请求后，调用记录会出现在这里。</span><RouterLink to="/app/keys">前往密钥管理</RouterLink></div>
    <div v-else class="dashboard-recent-list">
      <RouterLink v-for="item in items" :key="item.id" to="/app/usage" class="dashboard-recent-row">
        <span class="dashboard-recent-row__mark" aria-hidden="true">{{ item.stream ? 'S' : 'R' }}</span>
        <span class="dashboard-recent-row__identity">
          <strong :title="item.model">{{ item.model }}</strong>
          <small :title="item.request_id">{{ formatUsageTime(item.created_at) }} · {{ item.request_id }}</small>
        </span>
        <span class="dashboard-recent-row__usage"><strong>{{ formatCompactNumber(totalTokens(item)) }}</strong><small>Tokens</small></span>
        <span class="dashboard-recent-row__cost"><strong>{{ formatCurrency(item.actual_cost, 4) }}</strong><small v-if="item.total_cost != null">标准 {{ formatCurrency(item.total_cost, 4) }}</small><small v-else>实际消费</small></span>
      </RouterLink>
    </div>
  </article>
</template>

<style scoped>
.dashboard-recent-panel { min-width: 0; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }
.dashboard-recent-panel > header { min-height: 76px; padding: 18px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }
.dashboard-recent-panel > header > div { display: grid; gap: 3px; }
.dashboard-recent-panel > header span { color: var(--text-secondary); font-size: 12px; font-weight: 650; }
.dashboard-recent-panel > header strong { font-size: 22px; letter-spacing: -.035em; }
.dashboard-recent-panel > header small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-recent-panel > header a { padding-top: 3px; color: var(--accent); font-size: var(--font-meta); font-weight: 700; }
.dashboard-recent-list { min-height: 284px; padding: 5px 18px; display: grid; align-content: center; }
.dashboard-recent-row { min-width: 0; min-height: 54px; padding: 9px 2px; display: grid; grid-template-columns: 32px minmax(120px, 1fr) minmax(70px, .38fr) minmax(92px, .48fr); align-items: center; gap: 11px; border-bottom: 1px solid var(--border-subtle); }
.dashboard-recent-row:last-child { border-bottom: 0; }
.dashboard-recent-row:hover .dashboard-recent-row__identity > strong { color: var(--accent); }
.dashboard-recent-row__mark { width: 30px; height: 30px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 9px; font-size: var(--font-meta); font-weight: 800; }
.dashboard-recent-row__identity, .dashboard-recent-row__usage, .dashboard-recent-row__cost { min-width: 0; display: grid; gap: 3px; }
.dashboard-recent-row__identity > strong { overflow: hidden; font-size: var(--font-body-sm); text-overflow: ellipsis; white-space: nowrap; transition: color .18s ease; }
.dashboard-recent-row__identity > small { overflow: hidden; color: var(--text-secondary); font-size: var(--font-meta); text-overflow: ellipsis; white-space: nowrap; }
.dashboard-recent-row__usage, .dashboard-recent-row__cost { text-align: right; }
.dashboard-recent-row__usage > strong, .dashboard-recent-row__cost > strong { font-size: var(--font-body-sm); font-variant-numeric: tabular-nums; }
.dashboard-recent-row__usage > small, .dashboard-recent-row__cost > small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-recent-row__cost > strong { color: var(--success); }
.dashboard-recent-state { min-height: 284px; padding: 24px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--text-secondary); text-align: center; }
.dashboard-recent-state strong { color: var(--text-primary); font-size: 13px; }
.dashboard-recent-state span { max-width: 260px; font-size: var(--font-body-sm); line-height: 1.6; }
.dashboard-recent-state button, .dashboard-recent-state a { min-height: 32px; margin-top: 5px; padding: 0 11px; display: inline-flex; align-items: center; color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-body-sm); font-weight: 700; }
.dashboard-recent-state.is-error { color: var(--danger); }
.dashboard-recent-spinner { width: 20px; height: 20px; border: 2px solid var(--border-subtle); border-top-color: var(--accent); border-radius: 50%; animation: dashboard-recent-spin .75s linear infinite; }
@keyframes dashboard-recent-spin { to { transform: rotate(360deg); } }

@media (max-width: 560px) {
  .dashboard-recent-row { grid-template-columns: 30px minmax(0, 1fr) auto; }
  .dashboard-recent-row__usage { display: none; }
}
</style>
