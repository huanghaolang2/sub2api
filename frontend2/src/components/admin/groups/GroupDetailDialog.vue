<script setup lang="ts">
import { ref, watch } from 'vue'
import * as groupsAPI from '@shared-api/admin/groups'
import type { AdminGroup, ApiKey } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { formatResourceDate } from '@/features/admin/resources/model'
import { maskApiKey } from '@shared-utils/maskApiKey'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean; group: AdminGroup | null }>()
const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const loading = ref(false)
const stats = ref<Awaited<ReturnType<typeof groupsAPI.getStats>> | null>(null)
const keys = ref<ApiKey[]>([])
const total = ref(0)
const page = ref(1)
let loadRequest = 0

function clearDetails(): void {
  stats.value = null
  keys.value = []
  total.value = 0
}

async function load(): Promise<void> {
  const groupId = props.group?.id
  if (!groupId) return
  const request = ++loadRequest
  loading.value = true
  clearDetails()
  try {
    const [statsResponse, keyResponse] = await Promise.all([groupsAPI.getStats(groupId), groupsAPI.getGroupApiKeys(groupId, page.value, 20)])
    if (request !== loadRequest || props.group?.id !== groupId || !props.show) return
    stats.value = statsResponse
    keys.value = keyResponse.items as ApiKey[]
    total.value = keyResponse.total
  } catch (caught) {
    if (request !== loadRequest) return
    clearDetails()
    app.showError((caught as { message?: string }).message || '分组详情加载失败')
  } finally {
    if (request === loadRequest) loading.value = false
  }
}

function setPage(next: number): void {
  if (next < 1 || (next - 1) * 20 >= total.value) return
  page.value = next
  void load()
}

watch([() => props.show, () => props.group?.id], ([show]) => {
  loadRequest += 1
  loading.value = false
  clearDetails()
  if (show) {
    page.value = 1
    void load()
  }
}, { immediate: true })
</script>

<template>
  <SurfaceDialog :show="show" :title="`分组详情 · ${group?.name || ''}`" description="统计与绑定 API Key 均来自现有分组接口。" :width="DialogWidth.WIDE" @close="emit('close')">
    <div class="resource-form-stack">
      <div class="resource-summary">
        <div><span>API Key</span><strong>{{ stats?.total_api_keys ?? '—' }}</strong></div><div><span>活跃 Key</span><strong>{{ stats?.active_api_keys ?? '—' }}</strong></div>
        <div><span>累计请求</span><strong>{{ stats?.total_requests?.toLocaleString() ?? '—' }}</strong></div><div><span>累计费用</span><strong>{{ stats ? `$${stats.total_cost.toFixed(4)}` : '—' }}</strong></div>
      </div>
      <div class="resource-table"><table><thead><tr><th>Key</th><th>用户</th><th>状态</th><th>额度</th><th>最近使用</th></tr></thead><tbody>
        <tr v-if="loading"><td colspan="5">加载中…</td></tr>
        <tr v-else-if="keys.length === 0"><td colspan="5">该分组暂无 API Key</td></tr>
        <template v-else>
          <tr v-for="key in keys" :key="key.id"><td><strong>{{ key.name }}</strong><small>#{{ key.id }} · {{ maskApiKey(key.key) }}</small></td><td>#{{ key.user_id }}</td><td>{{ key.status }}</td><td>${{ key.quota_used.toFixed(2) }} / {{ key.quota ? `$${key.quota.toFixed(2)}` : '不限' }}</td><td>{{ formatResourceDate(key.last_used_at) }}</td></tr>
        </template>
      </tbody></table></div>
      <div class="resource-pagination"><span>共 {{ total }} 个 Key</span><div class="resource-pagination__actions"><button class="resource-button resource-button--secondary" :disabled="page <= 1 || loading" @click="setPage(page - 1)">上一页</button><span>第 {{ page }} 页</span><button class="resource-button resource-button--secondary" :disabled="page * 20 >= total || loading" @click="setPage(page + 1)">下一页</button></div></div>
    </div>
  </SurfaceDialog>
</template>
