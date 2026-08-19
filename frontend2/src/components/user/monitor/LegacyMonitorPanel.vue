<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as monitorAPI from '@shared-api/channelMonitor'
import type { UserMonitorDetail, UserMonitorView } from '@shared-api/channelMonitor'
import LegacyMonitorDetailDialog from './LegacyMonitorDetailDialog.vue'
import {
  availabilityForWindow,
  formatAvailability,
  formatMonitorMs,
  LegacyMonitorWindow,
  monitorStatusLabels,
  overallLegacyState
} from '@/features/user/monitor/model'

const items = ref<UserMonitorView[]>([])
const details = reactive<Record<number, UserMonitorDetail>>({})
const legacyWindow = ref(LegacyMonitorWindow.DAYS_7)
const loading = ref(true)
const error = ref('')
const autoRefresh = ref(true)
const refreshInterval = ref(60)
const countdown = ref(60)
const selected = ref<UserMonitorView | null>(null)
const detailOpen = ref(false)
let controller: AbortController | null = null
let timer: number | null = null

const overall = computed(() => overallLegacyState(items.value))
const healthyCount = computed(() => items.value.filter((item) => item.primary_status === 'operational').length)

function isAbortError(caught: unknown): boolean {
  const candidate = caught as { name?: string; code?: string }
  return candidate?.name === 'AbortError' || candidate?.code === 'ERR_CANCELED'
}

function selectedAvailability(row: UserMonitorView): number | null {
  return availabilityForWindow(row, details[row.id], legacyWindow.value)
}

async function loadDetails(force = false): Promise<void> {
  if (legacyWindow.value === LegacyMonitorWindow.DAYS_7 && !force) return
  await Promise.all(items.value.map(async (item) => {
    if (details[item.id] && !force) return
    try { details[item.id] = await monitorAPI.status(item.id) } catch { /* 卡片保留 7 天数据，详情可单独重试。 */ }
  }))
}

async function load(silent = false): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  if (!silent) loading.value = true
  error.value = ''
  try {
    const result = await monitorAPI.list({ signal: controller.signal })
    items.value = result.items || []
    await loadDetails(silent && legacyWindow.value !== LegacyMonitorWindow.DAYS_7)
  } catch (caught) {
    if (!isAbortError(caught)) error.value = (caught as { message?: string }).message || '主动探测状态暂时无法加载'
  } finally {
    loading.value = false
    countdown.value = refreshInterval.value
  }
}

function openDetail(item: UserMonitorView): void {
  selected.value = item
  detailOpen.value = true
}

function restartTimer(): void {
  if (timer != null) window.clearInterval(timer)
  timer = null
  countdown.value = refreshInterval.value
  if (!autoRefresh.value) return
  timer = window.setInterval(() => {
    if (document.hidden || loading.value) return
    countdown.value -= 1
    if (countdown.value <= 0) void load(true)
  }, 1000)
}

watch(legacyWindow, () => void loadDetails())
watch([autoRefresh, refreshInterval], restartTimer)
onMounted(() => { void load(); restartTimer() })
onBeforeUnmount(() => { controller?.abort(); if (timer != null) window.clearInterval(timer) })
</script>

<template>
  <section class="legacy-monitor">
    <header class="monitor-heading">
      <div><p>主动探测 · 多模型线路检查</p><h1>服务状态</h1><span>独立探针按固定间隔验证渠道，支持 7 / 15 / 30 天可用率与模型级详情。</span></div><div
        class="overall-mark"
        :class="`overall-mark--${overall}`"
      >
        <i /><span>{{ overall === 'operational' ? '所有探针运行正常' : '部分探针性能下降' }}</span><strong>{{ healthyCount }}/{{ items.length }}</strong>
      </div>
    </header>

    <section class="legacy-toolbar">
      <div
        class="segmented"
        role="group"
        aria-label="可用率时间范围"
      >
        <button
          v-for="option in Object.values(LegacyMonitorWindow)"
          :key="option"
          type="button"
          :class="{ active: legacyWindow === option }"
          @click="legacyWindow = option"
        >
          {{ option.replace('d', ' 天') }}
        </button>
      </div>
      <label class="auto-switch"><input
        v-model="autoRefresh"
        type="checkbox"
      ><span>自动刷新</span></label>
      <label><span>间隔</span><select
        v-model.number="refreshInterval"
        aria-label="自动刷新间隔"
      ><option :value="30">30 秒</option><option :value="60">60 秒</option><option :value="120">120 秒</option></select></label>
      <span class="countdown">{{ autoRefresh ? `${countdown}s 后刷新` : '自动刷新已暂停' }}</span>
      <button
        type="button"
        class="button button--secondary"
        :disabled="loading"
        @click="load(false)"
      >
        {{ loading ? '刷新中…' : '立即刷新' }}
      </button>
    </section>

    <div
      v-if="loading && items.length === 0"
      class="monitor-state"
    >
      正在同步主动探测结果…
    </div>
    <div
      v-else-if="error && items.length === 0"
      class="monitor-state monitor-state--error"
    >
      <p>{{ error }}</p><button
        type="button"
        class="button button--secondary"
        @click="load(false)"
      >
        重新加载
      </button>
    </div>
    <div
      v-else-if="items.length === 0"
      class="monitor-state"
    >
      管理员尚未配置可见探针。
    </div>
    <div
      v-else
      class="legacy-grid"
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="legacy-card"
        @click="openDetail(item)"
      >
        <header><div><span :class="['status-light', `status-light--${item.primary_status}`]" /><div><strong>{{ item.name }}</strong><small>{{ item.provider }} · {{ item.group_name }}</small></div></div><span :class="['status-copy', `status-copy--${item.primary_status}`]">{{ monitorStatusLabels[item.primary_status] || item.primary_status }}</span></header>
        <section class="legacy-kpis">
          <div><span>{{ legacyWindow.replace('d', ' 天') }}可用率</span><strong>{{ formatAvailability(selectedAvailability(item)) }}</strong></div><div><span>业务延迟</span><strong>{{ formatMonitorMs(item.primary_latency_ms) }}</strong></div><div><span>Ping</span><strong>{{ formatMonitorMs(item.primary_ping_latency_ms) }}</strong></div>
        </section>
        <div class="primary-model">
          <span>主模型</span><strong>{{ item.primary_model }}</strong><small>{{ item.extra_models.length }} 个附加模型</small>
        </div>
        <div
          class="timeline"
          aria-label="最近探测时间线"
        >
          <span
            v-for="(point, index) in item.timeline"
            :key="`${point.checked_at}-${index}`"
            :class="`timeline--${point.status}`"
            :title="`${new Date(point.checked_at).toLocaleString()} · ${monitorStatusLabels[point.status] || point.status} · ${formatMonitorMs(point.latency_ms)}`"
          />
        </div>
        <footer>
          <div class="extra-models">
            <span
              v-for="model in item.extra_models.slice(0, 3)"
              :key="model.model"
            ><i :class="`status-light--${model.status}`" />{{ model.model }} · {{ formatMonitorMs(model.latency_ms) }}</span>
          </div><em>查看 7 / 15 / 30 天详情 →</em>
        </footer>
      </button>
    </div>

    <LegacyMonitorDetailDialog
      :show="detailOpen"
      :monitor-id="selected?.id ?? null"
      :title="selected?.name || '探测详情'"
      @close="detailOpen = false"
    />
  </section>
</template>

<style scoped>
.legacy-monitor { padding-bottom: 50px; }.monitor-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; }.overall-mark { min-width: 250px; padding: 13px 15px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 10px; }.overall-mark i, .status-light, .extra-models i { width: 7px; height: 7px; display: inline-block; background: var(--success); border-radius: 50%; }.overall-mark span { color: var(--text-secondary); font-size: var(--font-meta); }.overall-mark strong { font-size: var(--font-meta); }.overall-mark--degraded i { background: var(--warning); }
.legacy-toolbar { margin: 24px 0 16px; padding: 10px; display: flex; align-items: center; gap: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.segmented { display: flex; padding: 3px; background: var(--surface-canvas); border-radius: 8px; }.segmented button { min-height: 32px; padding: 0 10px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: var(--font-meta); }.segmented button.active { color: var(--text-primary); background: var(--accent-soft); }.legacy-toolbar label { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: var(--font-meta); }.legacy-toolbar select { min-height: 34px; padding: 0 8px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 7px; }.countdown { margin-left: auto; color: var(--text-secondary); font-size: var(--font-meta); }.monitor-state { min-height: 300px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: 14px; }.monitor-state--error { color: var(--danger); }
.legacy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.legacy-card { min-width: 0; padding: 0; overflow: hidden; color: var(--text-primary); text-align: left; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; cursor: pointer; transition: border-color .18s ease, transform .18s ease; }.legacy-card:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border-subtle)); transform: translateY(-1px); }.legacy-card > header { padding: 14px 15px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border-subtle); }.legacy-card > header > div { min-width: 0; display: flex; gap: 8px; }.legacy-card header strong, .legacy-card header small { display: block; }.legacy-card header strong { font-size: var(--font-body-sm); }.legacy-card header small { margin-top: 4px; color: var(--text-secondary); font-size: var(--font-meta); }.status-light--degraded { background: var(--warning) !important; }.status-light--failed, .status-light--error { background: var(--danger) !important; }.status-copy { color: var(--success); font-size: var(--font-meta); }.status-copy--degraded { color: var(--warning); }.status-copy--failed, .status-copy--error { color: var(--danger); }.legacy-kpis { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--border-subtle); }.legacy-kpis div { padding: 12px 14px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); }.legacy-kpis div:last-child { border-right: 0; }.legacy-kpis span { color: var(--text-secondary); font-size: var(--font-caption); }.legacy-kpis strong { font-size: 15px; }.primary-model { padding: 11px 14px; display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: baseline; }.primary-model span, .primary-model small { color: var(--text-secondary); font-size: var(--font-caption); }.primary-model strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-meta); }.timeline { height: 28px; padding: 7px 14px; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; background: var(--surface-canvas); }.timeline span { min-width: 2px; background: var(--success); border-radius: 2px; }.timeline .timeline--degraded { background: var(--warning); }.timeline .timeline--failed, .timeline .timeline--error { background: var(--danger); }.legacy-card > footer { padding: 11px 14px; display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }.extra-models { min-width: 0; display: grid; gap: 4px; }.extra-models span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: var(--font-caption); }.extra-models i { width: 5px; height: 5px; margin-right: 5px; }.legacy-card footer em { flex: 0 0 auto; color: var(--accent); font-size: var(--font-caption); font-style: normal; }
@media (max-width: 820px) { .monitor-heading { align-items: flex-start; flex-direction: column; }.overall-mark { width: 100%; }.legacy-toolbar { flex-wrap: wrap; }.countdown { margin-left: 0; }.legacy-toolbar .button { margin-left: auto; }.legacy-grid { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .legacy-toolbar > * { flex: 1 1 auto; }.legacy-toolbar .button { width: 100%; }.legacy-kpis strong { font-size: 12px; }.legacy-card > footer { align-items: flex-start; flex-direction: column; } }
</style>
