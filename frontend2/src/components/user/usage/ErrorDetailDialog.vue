<script setup lang="ts">
import { ref, watch } from 'vue'
import * as usageAPI from '@shared-api/usage'
import type { UserErrorRequestDetail } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { errorStatusTone } from '@/features/user/usage/model'

const props = defineProps<{ show: boolean; errorId: number | null }>()
const emit = defineEmits<{ close: [] }>()
const detail = ref<UserErrorRequestDetail | null>(null)
const loading = ref(false)
const error = ref('')
let requestSequence = 0

async function load(id: number): Promise<void> {
  const sequence = ++requestSequence
  loading.value = true
  error.value = ''
  try {
    const response = await usageAPI.getMyErrorDetail(id)
    if (sequence === requestSequence) detail.value = response
  } catch (caught) {
    if (sequence === requestSequence) error.value = (caught as { message?: string }).message || '错误详情加载失败'
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))
}

watch(() => [props.show, props.errorId] as const, ([show, id]) => {
  if (show && id != null) void load(id)
  else {
    requestSequence += 1
    detail.value = null
    error.value = ''
  }
}, { immediate: true })
</script>

<template>
  <SurfaceDialog :show="show" title="错误请求详情" description="仅展示当前账号可访问的脱敏失败记录。" :width="DialogWidth.WIDE" @close="emit('close')">
    <div v-if="loading" class="detail-state">正在加载错误上下文…</div>
    <div v-else-if="error" class="detail-state detail-state--error"><p>{{ error }}</p><button type="button" @click="errorId != null && load(errorId)">重试</button></div>
    <div v-else-if="detail" class="error-detail">
      <section class="detail-summary">
        <div><span>时间</span><strong>{{ formatDate(detail.created_at) }}</strong></div>
        <div><span>状态码</span><strong :class="`tone--${errorStatusTone(detail.status_code)}`">{{ detail.status_code }}</strong></div>
        <div><span>上游状态</span><strong>{{ detail.upstream_status_code ?? '—' }}</strong></div>
        <div><span>分类</span><strong>{{ detail.category }}</strong></div>
        <div><span>平台</span><strong>{{ detail.platform || '—' }}</strong></div>
        <div><span>模型</span><strong>{{ detail.model || '—' }}</strong></div>
        <div><span>API Key</span><strong>{{ detail.key_name || '—' }} <small v-if="detail.key_deleted">已删除</small></strong></div>
        <div><span>分组</span><strong>{{ detail.group_name || '—' }}</strong></div>
        <div><span>入口端点</span><strong>{{ detail.inbound_endpoint || '—' }}</strong></div>
        <div><span>客户端 IP</span><strong>{{ detail.client_ip || '—' }}</strong></div>
      </section>
      <section v-if="detail.message" class="detail-block"><span>错误消息</span><p>{{ detail.message }}</p></section>
      <section v-if="detail.user_agent" class="detail-block"><span>User-Agent</span><code>{{ detail.user_agent }}</code></section>
      <section v-if="detail.error_body" class="detail-block"><span>上游响应体</span><pre><code>{{ detail.error_body }}</code></pre></section>
    </div>
    <template #footer><button type="button" class="button button--secondary" @click="emit('close')">关闭</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.detail-state { min-height: 230px; display: grid; place-content: center; gap: 10px; color: var(--text-secondary); text-align: center; }.detail-state--error { color: var(--danger); }.detail-state button { min-height: 34px; padding: 0 10px; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 7px; cursor: pointer; }
.error-detail { display: grid; gap: 14px; }.detail-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--border-subtle); border-radius: 12px; overflow: hidden; }.detail-summary > div { min-width: 0; padding: 12px 14px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); }.detail-summary > div:nth-child(even) { border-right: 0; }.detail-summary > div:nth-last-child(-n+2) { border-bottom: 0; }.detail-summary span, .detail-block > span { color: var(--text-secondary); font-size: var(--font-meta); text-transform: uppercase; letter-spacing: .06em; }.detail-summary strong { overflow-wrap: anywhere; font-size: var(--font-body-sm); }.detail-summary small { color: var(--danger); }.tone--danger { color: var(--danger); }.tone--warning { color: #b06c00; }.detail-block { padding: 14px; display: grid; gap: 8px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }.detail-block p { margin: 0; line-height: 1.6; overflow-wrap: anywhere; }.detail-block > code { overflow-wrap: anywhere; }.detail-block pre { max-height: 330px; margin: 0; padding: 13px; overflow: auto; color: #e7e9ef; background: #11131a; border-radius: 8px; font: var(--font-meta)/1.65 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 620px) { .detail-summary { grid-template-columns: 1fr; }.detail-summary > div { border-right: 0; }.detail-summary > div:nth-last-child(2) { border-bottom: 1px solid var(--border-subtle); } }
</style>
