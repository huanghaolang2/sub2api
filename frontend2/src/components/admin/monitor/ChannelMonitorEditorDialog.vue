<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { ChannelMonitor, CreateParams, UpdateParams } from '@shared-api/admin/channelMonitor'
import type { ChannelMonitorTemplate } from '@shared-api/admin/channelMonitorTemplate'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { parseJsonValue, splitValues } from '@/features/admin/resources/model'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean; monitor: ChannelMonitor | null; templates: ChannelMonitorTemplate[]; submitting?: boolean }>()
const emit = defineEmits<{ close: []; submit: [payload: CreateParams | UpdateParams] }>()
const app = useAppStore()
const form = reactive({ name: '', provider: 'openai', api_mode: 'chat_completions', endpoint: '', api_key: '', primary_model: '', extra_models: '', group_name: '', enabled: true, interval_seconds: 60, jitter_seconds: 0, template_id: '' as number | string, extra_headers_json: '{}', body_override_mode: 'off', body_override_json: '{}' })
const showKey = ref(false)

function reset(): void {
  const value = props.monitor
  Object.assign(form, value ? {
    name: value.name, provider: value.provider, api_mode: value.api_mode, endpoint: value.endpoint, api_key: '', primary_model: value.primary_model,
    extra_models: value.extra_models.join('\n'), group_name: value.group_name, enabled: value.enabled, interval_seconds: value.interval_seconds,
    jitter_seconds: value.jitter_seconds, template_id: value.template_id ?? '', extra_headers_json: JSON.stringify(value.extra_headers || {}, null, 2),
    body_override_mode: value.body_override_mode, body_override_json: JSON.stringify(value.body_override || {}, null, 2)
  } : { name: '', provider: 'openai', api_mode: 'chat_completions', endpoint: '', api_key: '', primary_model: '', extra_models: '', group_name: '', enabled: true, interval_seconds: 60, jitter_seconds: 0, template_id: '', extra_headers_json: '{}', body_override_mode: 'off', body_override_json: '{}' })
  showKey.value = false
}
function submit(): void {
  if (!form.name.trim() || !form.endpoint.trim() || !form.primary_model.trim()) { app.showError('名称、端点和主模型不能为空'); return }
  if (!props.monitor && !form.api_key) { app.showError('创建监控时必须填写 API Key'); return }
  if (!Number.isInteger(form.interval_seconds) || form.interval_seconds < 10 || !Number.isInteger(form.jitter_seconds) || form.jitter_seconds < 0) { app.showError('间隔至少 10 秒，抖动必须是非负整数'); return }
  try {
    const payload: CreateParams | UpdateParams = {
      name: form.name.trim(), provider: form.provider as CreateParams['provider'], api_mode: form.api_mode as CreateParams['api_mode'],
      endpoint: form.endpoint.trim(), api_key: form.api_key, primary_model: form.primary_model.trim(), extra_models: splitValues(form.extra_models),
      group_name: form.group_name.trim(), enabled: form.enabled, interval_seconds: form.interval_seconds, jitter_seconds: form.jitter_seconds,
      template_id: form.template_id === '' ? null : Number(form.template_id), extra_headers: parseJsonValue(form.extra_headers_json, '额外请求头', {}),
      body_override_mode: form.body_override_mode as CreateParams['body_override_mode'],
      body_override: form.body_override_mode === 'off' ? null : parseJsonValue(form.body_override_json, '请求体覆盖', {})
    }
    if (props.monitor && form.template_id === '' && props.monitor.template_id != null) (payload as UpdateParams).clear_template = true
    emit('submit', payload)
  } catch (caught) { app.showError((caught as Error).message) }
}
watch(() => props.show, (show) => { if (show) reset() })
</script>

<template><SurfaceDialog :show="show" :title="monitor ? '编辑渠道监控' : '创建渠道监控'" description="API Key 仅创建或主动替换时提交，列表永不回显明文。" :width="DialogWidth.WIDE" @close="emit('close')"><form id="monitor-editor-form" class="resource-form-stack" @submit.prevent="submit">
  <div class="resource-form-grid resource-form-grid--3"><label class="resource-field--wide">名称 *<input v-model="form.name" /></label><label>提供商<select v-model="form.provider"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="grok">Grok</option></select></label><label>API 模式<select v-model="form.api_mode"><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option></select></label><label class="resource-check"><input v-model="form.enabled" type="checkbox" /><span>启用定时检查</span></label><label class="resource-field--wide">端点 URL *<input v-model="form.endpoint" type="url" placeholder="https://api.example.com/v1" /></label><label class="resource-field--wide">API Key {{ monitor ? '（留空保持不变）' : '*' }}<div class="secret-field"><input v-model="form.api_key" :type="showKey ? 'text' : 'password'" autocomplete="new-password" /><button type="button" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button></div><small v-if="monitor?.api_key_decrypt_failed" class="resource-field-error">原密钥无法解密，必须重新填写。</small><small v-else-if="monitor">当前：{{ monitor.api_key_masked }}</small></label><label>主模型 *<input v-model="form.primary_model" /></label><label>监控组名<input v-model="form.group_name" /></label><label>请求模板<select v-model="form.template_id"><option value="">不使用模板</option><option v-for="template in templates.filter(item => item.provider === form.provider && item.api_mode === form.api_mode)" :key="template.id" :value="template.id">{{ template.name }}</option></select></label><label class="resource-field--wide">额外模型（逗号或换行）<textarea v-model="form.extra_models" rows="3" /></label><label>检查间隔（秒）<input v-model.number="form.interval_seconds" type="number" min="10" step="1" /></label><label>随机抖动（秒）<input v-model.number="form.jitter_seconds" type="number" min="0" step="1" /></label></div>
  <fieldset class="resource-form-section"><legend>高级请求快照</legend><label>额外请求头（JSON）<textarea v-model="form.extra_headers_json" rows="5" class="resource-code" spellcheck="false" /></label><label>请求体覆盖方式<select v-model="form.body_override_mode"><option value="off">关闭</option><option value="merge">合并</option><option value="replace">完全替换</option></select></label><label v-if="form.body_override_mode !== 'off'">请求体覆盖（JSON）<textarea v-model="form.body_override_json" rows="6" class="resource-code" spellcheck="false" /></label></fieldset>
  </form><template #footer><button class="button button--secondary" @click="emit('close')">取消</button><button type="submit" form="monitor-editor-form" class="button button--primary" :disabled="submitting">{{ submitting ? '保存中…' : '保存监控' }}</button></template></SurfaceDialog></template>

<style scoped>.secret-field { display: grid; grid-template-columns: 1fr auto; gap: 7px; }.secret-field button { color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 8px; cursor: pointer; }</style>
