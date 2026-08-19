<script setup lang="ts">
import { ref, watch } from 'vue'
import * as monitorAPI from '@shared-api/channelMonitor'
import type { UserMonitorDetail } from '@shared-api/channelMonitor'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { formatAvailability, formatMonitorMs, monitorStatusLabels } from '@/features/user/monitor/model'

const props = defineProps<{ show: boolean; monitorId: number | null; title: string }>()
defineEmits<{ close: [] }>()

const detail = ref<UserMonitorDetail | null>(null)
const loading = ref(false)
const error = ref('')
let sequence = 0

async function load(): Promise<void> {
  if (!props.show || props.monitorId == null) return
  const id = ++sequence
  loading.value = true
  error.value = ''
  try {
    const result = await monitorAPI.status(props.monitorId)
    if (id === sequence) detail.value = result
  } catch (caught) {
    if (id === sequence) error.value = (caught as { message?: string }).message || '探测详情暂时无法加载'
  } finally {
    if (id === sequence) loading.value = false
  }
}

watch(() => [props.show, props.monitorId], load, { immediate: true })
</script>

<template>
  <SurfaceDialog
    :show="show"
    :title="title"
    description="多模型 · 多窗口可用性与延迟"
    :width="DialogWidth.WIDE"
    @close="$emit('close')"
  >
    <div
      v-if="loading"
      class="detail-state"
    >
      正在加载探测详情…
    </div>
    <div
      v-else-if="error"
      class="detail-state detail-state--error"
    >
      <p>{{ error }}</p><button
        type="button"
        class="button button--secondary"
        @click="load"
      >
        重试
      </button>
    </div>
    <div
      v-else-if="detail"
      class="legacy-detail"
    >
      <section class="detail-context">
        <div><span>渠道</span><strong>{{ detail.name }}</strong></div><div><span>服务商</span><strong>{{ detail.provider }}</strong></div><div><span>分组</span><strong>{{ detail.group_name }}</strong></div><div><span>模型</span><strong>{{ detail.models.length }}</strong></div>
      </section>
      <div class="detail-table-wrap">
        <table>
          <thead><tr><th>模型</th><th>最新状态</th><th>最新延迟</th><th>7 天可用率</th><th>15 天可用率</th><th>30 天可用率</th><th>7 天平均延迟</th></tr></thead><tbody>
            <tr
              v-for="model in detail.models"
              :key="model.model"
            >
              <td><strong>{{ model.model }}</strong></td><td><span :class="['monitor-status', `monitor-status--${model.latest_status}`]">{{ monitorStatusLabels[model.latest_status] || model.latest_status }}</span></td><td>{{ formatMonitorMs(model.latest_latency_ms) }}</td><td>{{ formatAvailability(model.availability_7d) }}</td><td>{{ formatAvailability(model.availability_15d) }}</td><td>{{ formatAvailability(model.availability_30d) }}</td><td>{{ formatMonitorMs(model.avg_latency_7d_ms) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <template #footer>
      <button
        type="button"
        class="button button--secondary"
        @click="$emit('close')"
      >
        关闭
      </button>
    </template>
  </SurfaceDialog>
</template>

<style scoped>
.detail-state { min-height: 250px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--text-secondary); }.detail-state--error { color: var(--danger); }.legacy-detail { display: grid; gap: 15px; }.detail-context { display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--border-subtle); }.detail-context div { padding: 12px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); }.detail-context div:last-child { border-right: 0; }.detail-context span { color: var(--text-secondary); font-size: var(--font-meta); }.detail-context strong { font-size: var(--font-body-sm); }.detail-table-wrap { overflow: auto; border: 1px solid var(--border-subtle); border-radius: 10px; }.detail-table-wrap table { width: 100%; min-width: 780px; border-collapse: collapse; }.detail-table-wrap th, .detail-table-wrap td { padding: 10px 11px; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }.detail-table-wrap th { color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-meta); }.detail-table-wrap tr:last-child td { border-bottom: 0; }.monitor-status { font-size: var(--font-meta); }.monitor-status--operational { color: var(--success); }.monitor-status--degraded { color: var(--warning); }.monitor-status--failed, .monitor-status--error { color: var(--danger); }
@media (max-width: 640px) { .detail-context { grid-template-columns: 1fr 1fr; }.detail-context div:nth-child(2) { border-right: 0; }.detail-context div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); } }
</style>
