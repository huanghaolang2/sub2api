<template>
  <section class="dashboard-ranking-section" :aria-labelledby="`${section.id}-title`">
    <header class="dashboard-section-heading">
      <div>
        <h2 :id="`${section.id}-title`">{{ section.title }}</h2>
        <p>{{ section.description }}</p>
      </div>
    </header>

    <div class="dashboard-ranking-grid">
      <article v-for="card in section.cards" :key="card.id" class="dashboard-ranking-card">
        <header>
          <div>
            <h3 :id="`${section.id}-${card.id}-title`">{{ card.title }}</h3>
            <p>{{ card.rangeLabel }}</p>
          </div>
          <span>Tokens</span>
        </header>

        <div
          class="dashboard-ranking-viewport"
          role="region"
          tabindex="0"
          :aria-labelledby="`${section.id}-title ${section.id}-${card.id}-title`"
          :aria-busy="card.state === DashboardState.IDLE || card.state === DashboardState.LOADING"
        >
          <div
            v-if="card.state === DashboardState.IDLE || card.state === DashboardState.LOADING"
            class="dashboard-ranking-loading"
            role="status"
            :aria-label="`${card.title}加载中`"
          >
            <i v-for="index in 20" :key="index" aria-hidden="true" />
            <span class="sr-only">排行加载中</span>
          </div>
          <div v-else-if="card.state === DashboardState.ERROR" class="dashboard-ranking-state is-error" role="alert">{{ card.error }}</div>
          <div v-else-if="card.items.length === 0" class="dashboard-ranking-state">{{ section.kind === DashboardKind.MODEL ? '暂无符合展示条件的模型' : '暂无 API Key' }}</div>
          <ol v-else>
            <li v-for="(item, index) in card.items" :key="item.id" :data-item-id="item.id">
              <span>{{ index + 1 }}</span>
              <strong :title="item.name">{{ item.name }}</strong>
              <b>{{ formatAmount(item.usage) }}</b>
            </li>
          </ol>
        </div>

        <footer class="dashboard-ranking-footer">
          <p v-if="card.notice" class="dashboard-ranking-notice" role="status">{{ card.notice }}</p>
          <button v-for="target in card.retryTargets" :key="target.key" type="button" class="dashboard-ranking-retry" @click="$emit('retry', target.key)">{{ target.label }}</button>
        </footer>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { formatUsageBoardTokens, usageBoardTokenUnit } from '@/utils/usageBoard'
import { DashboardKind, DashboardState, type DashboardRankingSectionModel } from './dashboardBoards'

defineProps<{ section: DashboardRankingSectionModel }>()
defineEmits<{ (event: 'retry', dependencyKey: string): void }>()
const formatAmount = (value: number): string => value === 0 ? '0 Tokens' : `${formatUsageBoardTokens(value)} ${usageBoardTokenUnit(value)} Tokens`
</script>

<style scoped>
.dashboard-ranking-section {
  --dashboard-surface: #ffffff;
  --dashboard-surface-soft: #f7f9fc;
  --dashboard-ink: #172033;
  --dashboard-muted: #64748b;
  --dashboard-border: #dbe4f0;
  display: grid;
  gap: 16px;
  min-width: 0;
  color: var(--dashboard-ink);
}
:global(.dark .dashboard-ranking-section) {
  --dashboard-surface: #151a24;
  --dashboard-surface-soft: #1d2430;
  --dashboard-ink: #f8fafc;
  --dashboard-muted: #94a3b8;
  --dashboard-border: #334155;
}
.dashboard-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
.dashboard-section-heading h2 { margin: 0; color: var(--dashboard-ink); font-size: clamp(22px, 2vw, 28px); font-weight: 760; letter-spacing: -.035em; }
.dashboard-section-heading p { max-width: 620px; margin: 6px 0 0; color: var(--dashboard-muted); font-size: 13px; line-height: 1.6; }
.dashboard-ranking-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 16px; }
.dashboard-ranking-card { min-width: 0; padding: 20px; background: var(--dashboard-surface); border: 1px solid var(--dashboard-border); border-radius: 18px; box-shadow: 0 14px 36px rgb(15 23 42 / 6%); }
:global(.dark .dashboard-ranking-card) { box-shadow: 0 20px 56px rgb(0 0 0 / 22%); }
.dashboard-ranking-card > header { min-height: 46px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dashboard-ranking-card h3 { margin: 0; color: var(--dashboard-ink); font-size: 14px; font-weight: 720; }
.dashboard-ranking-card header p { margin: 4px 0 0; color: var(--dashboard-muted); font-size: 10px; font-variant-numeric: tabular-nums; line-height: 1.45; }
.dashboard-ranking-card > header > span { flex: 0 0 auto; color: var(--dashboard-muted); font-size: 10px; font-weight: 650; }
.dashboard-ranking-viewport { box-sizing: border-box; height: 815px; min-width: 0; margin-top: 14px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; border-radius: 8px; }
.dashboard-ranking-viewport:focus-visible { outline: 2px solid #2563eb; outline-offset: 4px; }
.dashboard-ranking-viewport ol { height: auto; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: 5px; list-style: none; }
.dashboard-ranking-viewport li { box-sizing: border-box; min-width: 0; min-height: 36px; padding: 6px 8px; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; border-radius: 8px; }
.dashboard-ranking-viewport li:nth-child(odd) { background: var(--dashboard-surface-soft); }
.dashboard-ranking-viewport li > span { color: var(--dashboard-muted); font-size: 10px; line-height: 1.4; font-variant-numeric: tabular-nums; text-align: center; }
.dashboard-ranking-viewport li > strong { overflow: hidden; color: var(--dashboard-ink); font-size: 12px; line-height: 1.5; font-weight: 660; text-overflow: ellipsis; white-space: nowrap; }
.dashboard-ranking-viewport li > b { color: var(--dashboard-ink); font-size: 10px; line-height: 1.4; font-weight: 680; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dashboard-ranking-state { box-sizing: border-box; height: 100%; min-width: 0; padding: 20px; display: grid; place-items: center; color: var(--dashboard-muted); font-size: 12px; text-align: center; overflow-wrap: anywhere; }
.dashboard-ranking-state.is-error { color: #dc2626; }
:global(.dark .dashboard-ranking-state.is-error) { color: #f87171; }
.dashboard-ranking-loading { display: grid; align-content: start; gap: 5px; }
.dashboard-ranking-loading i { height: 36px; display: block; background: var(--dashboard-surface-soft); border-radius: 8px; animation: dashboard-ranking-pulse 1.2s ease-in-out infinite; }
.dashboard-ranking-footer { min-height: 28px; margin-top: 12px; display: flex; align-items: start; flex-wrap: wrap; gap: 8px; }
.dashboard-ranking-notice { flex-basis: 100%; margin: 0; color: var(--dashboard-muted); font-size: 11px; line-height: 1.5; }
.dashboard-ranking-retry { padding: 4px 8px; color: #2563eb; background: var(--dashboard-surface-soft); border: 1px solid var(--dashboard-border); border-radius: 6px; font-size: 11px; cursor: pointer; }
:global(.dark .dashboard-ranking-retry) { color: #93c5fd; }
.dashboard-ranking-retry:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@keyframes dashboard-ranking-pulse { 50% { opacity: .45; } }
@media (max-width: 900px) { .dashboard-ranking-grid { grid-template-columns: 1fr; } }
@media (max-width: 520px) {
  .dashboard-ranking-card { padding: 18px; }
  .dashboard-ranking-viewport li { grid-template-columns: 20px minmax(0, 1fr); }
  .dashboard-ranking-viewport li > strong { white-space: normal; overflow-wrap: anywhere; }
  .dashboard-ranking-viewport li > b { grid-column: 2; color: var(--dashboard-muted); }
}
@media (prefers-reduced-motion: reduce) { .dashboard-ranking-loading i { animation: none; } }
</style>
