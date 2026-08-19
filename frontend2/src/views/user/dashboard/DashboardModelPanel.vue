<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardModelStat } from '@/types/user'
import { dashboardModelColors, formatCompactNumber } from './dashboard'

const props = defineProps<{ models: DashboardModelStat[]; loading: boolean; error: string }>()
const emit = defineEmits<{ retry: [] }>()

const totalTokens = computed(() => props.models.reduce((sum, item) => sum + item.total_tokens, 0))
const modelSegments = computed(() => {
  let offset = 0
  return [...props.models]
    .sort((left, right) => right.total_tokens - left.total_tokens)
    .slice(0, 5)
    .map((model, index) => {
      const share = totalTokens.value > 0 ? model.total_tokens / totalTokens.value * 100 : 0
      const segment = { model, share, offset, color: dashboardModelColors[index % dashboardModelColors.length] }
      offset += share
      return segment
    })
})
</script>

<template>
  <article class="dashboard-model-panel">
    <header>
      <div><span>模型分布</span><strong>{{ formatCompactNumber(totalTokens) }}</strong><small>范围内 Tokens</small></div>
      <RouterLink to="/app/models">模型与价格 →</RouterLink>
    </header>

    <div v-if="loading && models.length === 0" class="dashboard-model-state"><span class="dashboard-model-spinner" /><span>正在加载模型数据</span></div>
    <div v-else-if="error && models.length === 0" class="dashboard-model-state is-error"><strong>模型分布加载失败</strong><span>{{ error }}</span><button type="button" @click="emit('retry')">重新加载</button></div>
    <div v-else-if="models.length === 0" class="dashboard-model-state"><strong>暂无模型数据</strong><span>当前日期范围内尚未产生模型调用。</span></div>
    <div v-else class="dashboard-model-content">
      <div class="dashboard-donut" role="img" aria-label="模型 Token 使用占比">
        <svg viewBox="0 0 42 42">
          <circle class="dashboard-donut-base" cx="21" cy="21" r="15.9" pathLength="100" />
          <circle
            v-for="segment in modelSegments"
            :key="segment.model.model"
            class="dashboard-donut-segment"
            cx="21"
            cy="21"
            r="15.9"
            pathLength="100"
            :stroke="segment.color"
            :stroke-dasharray="`${segment.share} ${100 - segment.share}`"
            :stroke-dashoffset="-segment.offset"
          ><title>{{ segment.model.model }}：{{ segment.share.toFixed(1) }}%</title></circle>
        </svg>
        <div><strong>{{ models.length }}</strong><span>模型</span></div>
      </div>
      <div class="dashboard-model-list">
        <div v-for="segment in modelSegments" :key="segment.model.model">
          <i :style="{ background: segment.color }" />
          <span><strong>{{ segment.model.model }}</strong><small>{{ formatCompactNumber(segment.model.requests) }} 次请求</small></span>
          <strong>{{ segment.share.toFixed(1) }}%</strong>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.dashboard-model-panel { min-width: 0; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }
.dashboard-model-panel > header { min-height: 76px; padding: 18px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }
.dashboard-model-panel > header > div { display: grid; gap: 3px; }
.dashboard-model-panel > header span { color: var(--text-secondary); font-size: 12px; font-weight: 650; }
.dashboard-model-panel > header strong { font-size: 22px; letter-spacing: -.035em; }
.dashboard-model-panel > header small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-model-panel > header a { padding-top: 3px; color: var(--accent); font-size: var(--font-meta); font-weight: 700; }
.dashboard-model-content { min-height: 296px; padding: 24px 20px; display: grid; grid-template-columns: 132px minmax(0, 1fr); align-items: center; gap: 20px; }
.dashboard-donut { position: relative; width: 132px; height: 132px; }
.dashboard-donut svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.dashboard-donut-base, .dashboard-donut-segment { fill: none; stroke-width: 4.4; }
.dashboard-donut-base { stroke: color-mix(in srgb, var(--border-subtle) 58%, transparent); }
.dashboard-donut-segment { transition: stroke-width .18s ease; }
.dashboard-donut > div { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; }
.dashboard-donut > div strong { font-size: 25px; letter-spacing: -.04em; }
.dashboard-donut > div span { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-model-list { min-width: 0; display: grid; gap: 12px; }
.dashboard-model-list > div { min-width: 0; display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; align-items: center; gap: 8px; }
.dashboard-model-list > div > i { width: 7px; height: 25px; border-radius: 4px; }
.dashboard-model-list > div > span { min-width: 0; display: grid; gap: 2px; }
.dashboard-model-list > div > span strong { overflow: hidden; font-size: var(--font-body-sm); text-overflow: ellipsis; white-space: nowrap; }
.dashboard-model-list > div > span small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-model-list > div > strong { font-size: var(--font-body-sm); }
.dashboard-model-state { min-height: 296px; padding: 24px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--text-secondary); text-align: center; }
.dashboard-model-state strong { color: var(--text-primary); font-size: 13px; }
.dashboard-model-state span { max-width: 220px; font-size: var(--font-body-sm); line-height: 1.6; }
.dashboard-model-state button { min-height: 32px; margin-top: 5px; padding: 0 11px; color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-body-sm); font-weight: 700; }
.dashboard-model-state.is-error { color: var(--danger); }
.dashboard-model-spinner { width: 20px; height: 20px; border: 2px solid var(--border-subtle); border-top-color: var(--accent); border-radius: 50%; animation: dashboard-model-spin .75s linear infinite; }
@keyframes dashboard-model-spin { to { transform: rotate(360deg); } }

@media (max-width: 560px) {
  .dashboard-model-content { grid-template-columns: 1fr; justify-items: center; }
  .dashboard-model-list { width: 100%; }
}
</style>
