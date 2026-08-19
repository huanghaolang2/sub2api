<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import * as batchAPI from '@shared-api/batchImage'
import type { BatchImageJob, BatchImageReferenceImage } from '@shared-api/batchImage'
import type { ApiKey } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import {
  batchErrorMessage,
  BATCH_IMAGE_MAX_FILE_BYTES,
  BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM,
  BATCH_IMAGE_MAX_OUTPUTS_PER_JOB,
  BatchOutputMimeType,
  defaultTaskName,
  estimateOutputs,
  normalizeOutputCount,
  referenceImageLimit,
  type BatchPromptRow,
  uniqueCustomId
} from '@/features/user/batch-image/model'
import { useAppStore } from '@/stores/app'

interface ReferenceDraft extends BatchImageReferenceImage {
  name: string
  size: number
}

const props = defineProps<{ show: boolean; apiKeys: ApiKey[]; endpointBase: string }>()
const emit = defineEmits<{ close: []; saved: [job: BatchImageJob, key: ApiKey] }>()
const app = useAppStore()

const form = reactive({ apiKeyId: 0, taskName: '', model: '', responseMimeType: BatchOutputMimeType.PNG })
const models = ref<string[]>([])
const rows = ref<BatchPromptRow[]>([])
const promptDraft = ref('')
const customIdDraft = ref('')
const outputCountDraft = ref(1)
const referenceDrafts = ref<ReferenceDraft[]>([])
const loadingModels = ref(false)
const modelError = ref('')
const submitting = ref(false)
const validationError = ref('')
let modelRequest = 0

const selectedKey = computed(() => props.apiKeys.find((key) => key.id === form.apiKeyId) || null)
const referenceLimit = computed(() => referenceImageLimit(form.model))
const estimatedOutputs = computed(() => estimateOutputs(rows.value))
const outputOptions = Array.from({ length: BATCH_IMAGE_MAX_OUTPUTS_PER_ITEM }, (_, index) => index + 1)

function reset(): void {
  form.apiKeyId = props.apiKeys[0]?.id || 0
  form.taskName = ''
  form.model = ''
  form.responseMimeType = BatchOutputMimeType.PNG
  rows.value = []
  promptDraft.value = ''
  customIdDraft.value = ''
  outputCountDraft.value = 1
  referenceDrafts.value = []
  validationError.value = ''
  modelError.value = ''
}

async function loadModels(): Promise<void> {
  const key = selectedKey.value
  const id = ++modelRequest
  models.value = []
  form.model = ''
  referenceDrafts.value = []
  modelError.value = ''
  if (!key) return
  loadingModels.value = true
  try {
    const response = await batchAPI.listBatchImageModels(key.key)
    if (id !== modelRequest) return
    models.value = [...new Set((response.data || []).map((model) => String(model.id || '').trim()).filter(Boolean))]
    form.model = models.value[0] || ''
  } catch (caught) {
    if (id === modelRequest) modelError.value = batchErrorMessage(caught, '模型列表加载失败')
  } finally {
    if (id === modelRequest) loadingModels.value = false
  }
}

function addPrompt(): void {
  const prompt = promptDraft.value.trim()
  if (!prompt) return
  const used = new Set(rows.value.map((row) => row.custom_id))
  const customId = uniqueCustomId(customIdDraft.value, used, rows.value.length)
  rows.value = [...rows.value, {
    local_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    custom_id: customId,
    prompt,
    output_count: normalizeOutputCount(outputCountDraft.value),
    reference_images: referenceDrafts.value.map(({ name: _name, size: _size, ...reference }) => reference)
  }]
  promptDraft.value = ''
  customIdDraft.value = ''
  outputCountDraft.value = 1
  referenceDrafts.value = []
  validationError.value = ''
}

function removePrompt(index: number): void {
  rows.value = rows.value.filter((_, rowIndex) => rowIndex !== index)
}

function removeReference(index: number): void {
  referenceDrafts.value = referenceDrafts.value.filter((_, imageIndex) => imageIndex !== index)
}

async function handleFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  if (referenceLimit.value <= 0) {
    app.showError('所选模型不支持参考图。')
    return
  }
  const remaining = Math.max(0, referenceLimit.value - referenceDrafts.value.length)
  const accepted = files.slice(0, remaining)
  if (accepted.length < files.length) app.showError(`每条 Prompt 最多添加 ${referenceLimit.value} 张参考图，多余文件已忽略。`)
  const next: ReferenceDraft[] = []
  for (const file of accepted) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      app.showError(`${file.name} 不是 PNG、JPEG 或 WebP。`)
      continue
    }
    if (file.size > BATCH_IMAGE_MAX_FILE_BYTES) {
      app.showError(`${file.name} 超过单文件 10MB 限制。`)
      continue
    }
    next.push({ id: file.name, type: 'reference', mime_type: file.type, data: await readBase64(file), name: file.name, size: file.size })
  }
  referenceDrafts.value = [...referenceDrafts.value, ...next]
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('读取参考图失败'))
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value)
    }
    reader.readAsDataURL(file)
  })
}

function validate(): boolean {
  validationError.value = ''
  if (!selectedKey.value) validationError.value = '请选择允许批量生图的 API Key。'
  else if (!form.model) validationError.value = models.value.length ? '请选择模型。' : '该 API Key 暂无可用批量生图模型。'
  else if (!rows.value.length) validationError.value = '请至少添加一条 Prompt。'
  else if (estimatedOutputs.value > BATCH_IMAGE_MAX_OUTPUTS_PER_JOB) validationError.value = `预计输出 ${estimatedOutputs.value} 张，单任务最多 ${BATCH_IMAGE_MAX_OUTPUTS_PER_JOB} 张，请拆分任务。`
  else if (rows.value.some((row) => (row.reference_images?.length || 0) > referenceLimit.value)) validationError.value = `所选模型每条 Prompt 最多 ${referenceLimit.value} 张参考图。`
  if (validationError.value) app.showError(validationError.value)
  return !validationError.value
}

async function submit(): Promise<void> {
  if (submitting.value) return
  if (promptDraft.value.trim()) addPrompt()
  if (!validate() || !selectedKey.value) return
  submitting.value = true
  try {
    const job = await batchAPI.submitBatchImageJob(selectedKey.value.key, {
      model: form.model,
      task_name: form.taskName.trim() || defaultTaskName(),
      image_size: '1K',
      response_mime_type: form.responseMimeType,
      items: rows.value.map(({ local_id: _localId, ...row }) => row)
    }, `sub2api-ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
    app.showSuccess('批量图片任务已提交，结果会在任务详情中持续更新。')
    emit('saved', job, selectedKey.value)
    reset()
  } catch (caught) {
    app.showError(batchErrorMessage(caught, '批量图片任务提交失败'))
  } finally {
    submitting.value = false
  }
}

function close(): void {
  if (submitting.value) return
  reset()
  emit('close')
}

watch(() => props.show, (show) => { if (show) { reset(); void loadModels() } }, { immediate: true })
watch(() => form.apiKeyId, () => { if (props.show) void loadModels() })
watch(() => form.model, () => { referenceDrafts.value = [] })
</script>

<template>
  <SurfaceDialog :show="show" title="创建批量图片任务" description="一个任务最多 200 张输出图；提交前先完成 Prompt 清单。" :width="DialogWidth.WIDE" @close="close">
    <form id="batch-image-create-form" class="create-form" @submit.prevent="submit">
      <section class="create-basics">
        <label class="field field--wide"><span>任务名称</span><input v-model="form.taskName" type="text" maxlength="255" :placeholder="defaultTaskName()"></label>
        <label class="field field--wide"><span>API Key</span><select v-model.number="form.apiKeyId" :disabled="apiKeys.length === 0"><option :value="0">选择允许批量生图的 Key</option><option v-for="key in apiKeys" :key="key.id" :value="key.id">{{ key.name }} · {{ key.group?.name || 'Gemini' }}</option></select><small v-if="apiKeys.length === 0">没有 active + Gemini + 已开启批量生图权限的 Key。</small></label>
        <label class="field"><span>模型</span><select v-model="form.model" :disabled="loadingModels || models.length === 0"><option value="">{{ loadingModels ? '加载模型中…' : '选择模型' }}</option><option v-for="model in models" :key="model" :value="model">{{ model }}</option></select><small v-if="modelError">{{ modelError }}</small></label>
        <div class="field"><span>网关与尺寸</span><strong>{{ endpointBase }}/v1/images/batches · 1K</strong><small>具体上游由管理员在分组与账号池中配置。</small></div>
        <label class="field"><span>输出格式</span><select v-model="form.responseMimeType"><option :value="BatchOutputMimeType.PNG">PNG</option><option :value="BatchOutputMimeType.JPEG">JPEG</option><option :value="BatchOutputMimeType.WEBP">WebP</option></select></label>
        <div class="field"><span>预计输出</span><strong>{{ estimatedOutputs }} 张 / {{ rows.length }} 条 Prompt</strong><small>每条最多 4 张，单任务最多 200 张。</small></div>
      </section>

      <section class="prompt-builder">
        <header><div><strong>添加 Prompt</strong><span>参考图只绑定到当前待添加 Prompt</span></div><em>{{ rows.length }} 条已加入</em></header>
        <textarea v-model="promptDraft" rows="4" placeholder="完整描述构图、主体、风格、光线、尺寸约束与不希望出现的内容。"></textarea>
        <div class="prompt-controls">
          <input v-model="customIdDraft" type="text" maxlength="255" placeholder="custom_id（可选）">
          <label><span>输出数</span><select v-model.number="outputCountDraft" aria-label="每条 Prompt 输出数量"><option v-for="count in outputOptions" :key="count" :value="count">{{ count }} 张</option></select></label>
          <label class="file-button" :class="{ disabled: referenceLimit === 0 || referenceDrafts.length >= referenceLimit }"><span>参考图 {{ referenceDrafts.length }}/{{ referenceLimit }}</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple :disabled="referenceLimit === 0 || referenceDrafts.length >= referenceLimit" @change="handleFiles"></label>
          <button type="button" class="button button--secondary" :disabled="!promptDraft.trim()" @click="addPrompt">加入清单</button>
        </div>
        <div v-if="referenceDrafts.length" class="reference-list"><span v-for="(reference, index) in referenceDrafts" :key="`${reference.name}-${index}`">{{ reference.name }} · {{ (reference.size / 1024 / 1024).toFixed(1) }}MB <button type="button" @click="removeReference(index)">移除</button></span></div>
        <p class="limit-note">Flash Image 每条最多 3 张参考图；Pro Image 最多 14 张。参考图会按 output_count 重复产生上游输入 Token，但当前用户结算按成功输出图数量计算。</p>
      </section>

      <section class="prompt-list"><header><span>custom_id</span><span>Prompt</span><span>输出 / 参考</span><span>操作</span></header><div v-if="rows.length"><article v-for="(row, index) in rows" :key="row.local_id"><code>{{ row.custom_id }}</code><p :title="row.prompt">{{ row.prompt }}</p><span>×{{ normalizeOutputCount(row.output_count) }} · {{ row.reference_images?.length || 0 }} 参考</span><button type="button" @click="removePrompt(index)">删除</button></article></div><p v-else class="prompt-empty">Prompt 清单为空。输入后点击“加入清单”。</p></section>
      <aside class="settlement-note">取消任务时，已经被系统索引为成功的图片仍会按成功项结算，其余冻结金额会释放。</aside>
      <p v-if="validationError" class="validation-error" role="alert">{{ validationError }}</p>
    </form>
    <template #footer><button type="button" class="button button--secondary" :disabled="submitting" @click="close">取消</button><button type="submit" form="batch-image-create-form" class="button button--primary" :disabled="submitting || loadingModels">{{ submitting ? '正在提交并冻结金额…' : '提交任务' }}</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.create-form { display: grid; gap: 14px; }.create-basics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }.field { min-width: 0; display: grid; align-content: start; gap: 5px; }.field--wide { grid-column: 1 / -1; }.field > span { color: var(--text-secondary); font-size: var(--font-meta); }.field input, .field select, .field > strong { min-height: 39px; padding: 0 10px; display: flex; align-items: center; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: var(--font-meta); }.field small { color: var(--warning); font-size: var(--font-caption); line-height: 1.5; }.prompt-builder { padding: 13px; display: grid; gap: 9px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 11px; }.prompt-builder > header { display: flex; justify-content: space-between; gap: 10px; }.prompt-builder header > div { display: flex; align-items: baseline; gap: 8px; }.prompt-builder header strong { font-size: var(--font-meta); }.prompt-builder header span, .prompt-builder header em { color: var(--text-secondary); font-size: var(--font-caption); font-style: normal; }.prompt-builder textarea { min-height: 88px; padding: 10px; resize: vertical; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: var(--font-meta); line-height: 1.6; }.prompt-controls { display: grid; grid-template-columns: minmax(170px, 1fr) 100px 145px auto; gap: 7px; }.prompt-controls input, .prompt-controls select, .file-button { min-height: 36px; padding: 0 9px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; font-size: var(--font-meta); }.prompt-controls label:not(.file-button) { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px; color: var(--text-secondary); font-size: var(--font-caption); }.file-button { display: flex; align-items: center; justify-content: center; cursor: pointer; }.file-button.disabled { opacity: .45; cursor: not-allowed; }.file-button input { display: none; }.reference-list { display: flex; flex-wrap: wrap; gap: 5px; }.reference-list > span { padding: 5px 7px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 6px; font-size: var(--font-caption); }.reference-list button, .prompt-list button { color: var(--danger); background: transparent; border: 0; cursor: pointer; font-size: var(--font-caption); }.limit-note { margin: 0; color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.6; }.prompt-list { overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 10px; }.prompt-list > header, .prompt-list article { padding: 9px 10px; display: grid; grid-template-columns: 120px minmax(180px, 1fr) 90px 45px; align-items: center; gap: 8px; }.prompt-list > header { color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-caption); }.prompt-list article { border-top: 1px solid var(--border-subtle); }.prompt-list code, .prompt-list p, .prompt-list article > span { min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-meta); }.prompt-list article > span { color: var(--text-secondary); }.prompt-empty { margin: 0; padding: 24px; color: var(--text-secondary); text-align: center; font-size: var(--font-meta); }.settlement-note { padding: 10px 12px; color: var(--warning); background: color-mix(in srgb, var(--warning) 7%, var(--surface-raised)); border-left: 3px solid var(--warning); font-size: var(--font-meta); line-height: 1.6; }.validation-error { margin: 0; color: var(--danger); font-size: var(--font-meta); }
@media (max-width: 680px) { .create-basics { grid-template-columns: 1fr; }.field--wide { grid-column: auto; }.prompt-controls { grid-template-columns: 1fr 1fr; }.prompt-list { overflow: auto; }.prompt-list > header, .prompt-list article { min-width: 560px; } }
</style>
