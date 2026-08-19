<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import * as groupsAPI from '@shared-api/admin/groups'
import type { AdminGroup, CompositeModelRoute, CompositeRouteDecision, CompositeRouteEndpoint, CompositeRouteMatchType, GroupPlatform } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean; group: AdminGroup | null }>()
const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const confirm = useConfirmStore()
const routes = ref<CompositeModelRoute[]>([])
const loading = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const previewModel = ref('')
const previewEndpoint = ref<CompositeRouteEndpoint>('any')
const decision = ref<CompositeRouteDecision | null>(null)

const form = reactive({
  public_model: '', match_type: 'exact' as CompositeRouteMatchType,
  target_platform: 'openai' as Exclude<GroupPlatform, 'composite'>,
  upstream_model: '', endpoint: 'any' as CompositeRouteEndpoint,
  priority: 0, enabled: true, notes: ''
})

const endpoints: CompositeRouteEndpoint[] = ['any', 'messages', 'count_tokens', 'responses', 'chat_completions', 'embeddings', 'images', 'gemini']
const platforms: Array<Exclude<GroupPlatform, 'composite'>> = ['openai', 'anthropic', 'gemini', 'antigravity', 'grok']

function resetForm(): void {
  Object.assign(form, { public_model: '', match_type: 'exact', target_platform: 'openai', upstream_model: '', endpoint: 'any', priority: 0, enabled: true, notes: '' })
  editingId.value = null
}

async function load(): Promise<void> {
  if (!props.group) return
  loading.value = true
  try { routes.value = await groupsAPI.listCompositeRoutes(props.group.id) }
  catch (caught) { app.showError((caught as { message?: string }).message || '复合路由加载失败') }
  finally { loading.value = false }
}

function edit(route: CompositeModelRoute): void {
  editingId.value = route.id
  Object.assign(form, {
    public_model: route.public_model, match_type: route.match_type, target_platform: route.target_platform,
    upstream_model: route.upstream_model, endpoint: route.endpoint, priority: route.priority,
    enabled: route.enabled, notes: route.notes
  })
}

async function save(): Promise<void> {
  if (!props.group || !form.public_model.trim() || saving.value) return
  saving.value = true
  try {
    const payload = { ...form, public_model: form.public_model.trim(), upstream_model: form.upstream_model.trim(), notes: form.notes.trim() }
    if (editingId.value) await groupsAPI.updateCompositeRoute(props.group.id, editingId.value, payload)
    else await groupsAPI.createCompositeRoute(props.group.id, payload)
    app.showSuccess(editingId.value ? '复合路由已更新' : '复合路由已创建')
    resetForm()
    await load()
  } catch (caught) { app.showError((caught as { message?: string }).message || '保存复合路由失败') }
  finally { saving.value = false }
}

async function remove(route: CompositeModelRoute): Promise<void> {
  if (!props.group || !await confirm.ask({ title: '删除复合路由', message: `确认删除 ${route.public_model} → ${route.target_platform}/${route.upstream_model || route.public_model}？`, confirmText: '删除', tone: ConfirmTone.DANGER })) return
  try { await groupsAPI.deleteCompositeRoute(props.group.id, route.id); app.showSuccess('复合路由已删除'); await load() }
  catch (caught) { app.showError((caught as { message?: string }).message || '删除失败') }
}

async function preview(): Promise<void> {
  if (!props.group || !previewModel.value.trim()) return
  try { decision.value = await groupsAPI.previewCompositeRoute(props.group.id, { model: previewModel.value.trim(), endpoint: previewEndpoint.value }) }
  catch (caught) { app.showError((caught as { message?: string }).message || '预览失败') }
}

watch(() => props.show, (show) => { if (show) { resetForm(); decision.value = null; void load() } })
</script>

<template>
  <SurfaceDialog :show="show" :title="`复合路由 · ${group?.name || ''}`" description="按优先级匹配公开模型与端点，并路由至指定平台。" :width="DialogWidth.WIDE" @close="emit('close')">
    <div class="resource-form-stack">
      <div class="resource-form-section">
        <strong>{{ editingId ? '编辑路由' : '新增路由' }}</strong>
        <div class="resource-form-grid resource-form-grid--3">
          <label>公开模型 *<input v-model="form.public_model" placeholder="claude-*" /></label>
          <label>匹配方式<select v-model="form.match_type"><option value="exact">精确</option><option value="prefix">前缀</option></select></label>
          <label>端点<select v-model="form.endpoint"><option v-for="item in endpoints" :key="item" :value="item">{{ item }}</option></select></label>
          <label>目标平台<select v-model="form.target_platform"><option v-for="item in platforms" :key="item" :value="item">{{ item }}</option></select></label>
          <label>上游模型<input v-model="form.upstream_model" placeholder="留空沿用公开模型" /></label>
          <label>优先级<input v-model.number="form.priority" type="number" step="1" /></label>
          <label class="resource-check"><input v-model="form.enabled" type="checkbox" /><span>启用</span></label>
          <label class="resource-field--wide">备注<textarea v-model="form.notes" rows="2" /></label>
        </div>
        <div class="resource-inline-actions"><button class="resource-button" type="button" :disabled="saving || !form.public_model.trim()" @click="save">{{ saving ? '保存中…' : '保存路由' }}</button><button v-if="editingId" class="resource-button resource-button--secondary" type="button" @click="resetForm">取消编辑</button></div>
      </div>

      <div class="resource-form-section">
        <strong>路由预览</strong>
        <div class="resource-form-grid resource-form-grid--3">
          <label>请求模型<input v-model="previewModel" /></label>
          <label>请求端点<select v-model="previewEndpoint"><option v-for="item in endpoints" :key="item" :value="item">{{ item }}</option></select></label>
          <button class="resource-button resource-button--secondary" type="button" @click="preview">预览命中</button>
        </div>
        <pre v-if="decision" class="resource-code">{{ JSON.stringify(decision, null, 2) }}</pre>
      </div>

      <div class="resource-table">
        <table><thead><tr><th>公开模型</th><th>匹配</th><th>目标</th><th>端点</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead>
          <tbody><tr v-if="loading"><td colspan="7">加载中…</td></tr><tr v-else-if="routes.length === 0"><td colspan="7">暂无复合路由</td></tr>
            <tr v-for="route in routes" :key="route.id"><td><strong>{{ route.public_model }}</strong><small>{{ route.notes || '无备注' }}</small></td><td>{{ route.match_type }}</td><td>{{ route.target_platform }} / {{ route.upstream_model || route.public_model }}</td><td>{{ route.endpoint }}</td><td>{{ route.priority }}</td><td><span :class="['resource-status', route.enabled ? 'resource-status--active' : '']">{{ route.enabled ? '启用' : '停用' }}</span></td><td><div class="resource-inline-actions"><button class="resource-link" @click="edit(route)">编辑</button><button class="resource-link resource-link--danger" @click="remove(route)">删除</button></div></td></tr>
          </tbody></table>
      </div>
    </div>
  </SurfaceDialog>
</template>
