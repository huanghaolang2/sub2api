<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import * as userAttributesAPI from '@shared-api/admin/userAttributes'
import type { UserAttributeDefinition, UserAttributeOption } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { UserAttributeTypeCode } from '@/features/admin/users/model'
import { useAppStore } from '@/stores/app'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const app = useAppStore()
const confirmDialog = useConfirmStore()
const loading = ref(false)
const saving = ref(false)
const reordering = ref(false)
const attributes = ref<UserAttributeDefinition[]>([])
const editorOpen = ref(false)
const editing = ref<UserAttributeDefinition | null>(null)
const attributeTypes = Object.values(UserAttributeTypeCode)
const form = reactive({
  key: '',
  name: '',
  type: UserAttributeTypeCode.TEXT,
  description: '',
  placeholder: '',
  required: false,
  enabled: true,
  options: [] as UserAttributeOption[]
})

async function load(): Promise<void> {
  loading.value = true
  try {
    attributes.value = await userAttributesAPI.listDefinitions()
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '自定义属性加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editing.value = null
  Object.assign(form, { key: '', name: '', type: UserAttributeTypeCode.TEXT, description: '', placeholder: '', required: false, enabled: true, options: [] })
  editorOpen.value = true
}

function openEdit(attribute: UserAttributeDefinition): void {
  editing.value = attribute
  Object.assign(form, {
    key: attribute.key,
    name: attribute.name,
    type: attribute.type as UserAttributeTypeCode,
    description: attribute.description || '',
    placeholder: attribute.placeholder || '',
    required: attribute.required,
    enabled: attribute.enabled,
    options: attribute.options?.map((option) => ({ ...option })) ?? []
  })
  editorOpen.value = true
}

function addOption(): void {
  form.options.push({ value: '', label: '' })
}

function removeOption(index: number): void {
  form.options.splice(index, 1)
}

function usesOptions(): boolean {
  return form.type === UserAttributeTypeCode.SELECT || form.type === UserAttributeTypeCode.MULTI_SELECT
}

async function save(): Promise<void> {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(form.key.trim())) {
    app.showError('属性键必须以字母开头，且只能包含字母、数字和下划线。')
    return
  }
  if (!form.name.trim()) {
    app.showError('属性名称不能为空')
    return
  }
  if (usesOptions() && (form.options.length === 0 || form.options.some((option) => !option.value.trim() || !option.label.trim()))) {
    app.showError('选择类属性至少需要一个完整的值与标签')
    return
  }
  const payload = {
    key: form.key.trim(),
    name: form.name.trim(),
    type: form.type,
    description: form.description.trim() || undefined,
    placeholder: form.placeholder.trim() || undefined,
    required: form.required,
    enabled: form.enabled,
    options: usesOptions() ? form.options.map((option) => ({ ...option })) : undefined
  }
  saving.value = true
  try {
    if (editing.value) await userAttributesAPI.updateDefinition(editing.value.id, payload)
    else await userAttributesAPI.createDefinition(payload)
    app.showSuccess(editing.value ? '属性已更新' : '属性已创建')
    editorOpen.value = false
    editing.value = null
    await load()
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '属性保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(attribute: UserAttributeDefinition): Promise<void> {
  const confirmed = await confirmDialog.ask({
    title: `删除属性“${attribute.name}”`,
    message: '删除定义会同时影响用户列表筛选、列展示与该属性的历史值。',
    confirmText: '删除属性',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  try {
    await userAttributesAPI.deleteDefinition(attribute.id)
    app.showSuccess('属性已删除')
    await load()
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '属性删除失败')
  }
}

async function move(attribute: UserAttributeDefinition, offset: -1 | 1): Promise<void> {
  if (reordering.value) return
  const currentIndex = attributes.value.findIndex((item) => item.id === attribute.id)
  const targetIndex = currentIndex + offset
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= attributes.value.length) return

  const reordered = [...attributes.value]
  const [moving] = reordered.splice(currentIndex, 1)
  if (!moving) return
  reordered.splice(targetIndex, 0, moving)

  reordering.value = true
  try {
    await userAttributesAPI.reorderDefinitions(reordered.map((item) => item.id))
    attributes.value = reordered.map((item, index) => ({ ...item, display_order: index + 1 }))
    app.showSuccess('属性顺序已更新')
    emit('changed')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '属性排序失败')
  } finally {
    reordering.value = false
  }
}

watch(() => props.show, (show) => { if (show) void load() }, { immediate: true })
</script>

<template>
  <SurfaceDialog
    :show="show"
    title="自定义用户属性"
    description="属性可用于列表列、服务端筛选和单用户资料维护。"
    :width="DialogWidth.WIDE"
    @close="emit('close')"
  >
    <div class="attribute-toolbar"><span>{{ attributes.length }} 个属性</span><button type="button" class="button button--primary" @click="openCreate">新增属性</button></div>
    <div v-if="loading" class="attribute-state">正在加载…</div>
    <div v-else-if="attributes.length === 0" class="attribute-state">尚未定义属性。创建后可立即用于筛选和用户资料。</div>
    <div v-else class="attribute-list">
      <article v-for="(attribute, index) in attributes" :key="attribute.id">
        <div><strong>{{ attribute.name }}</strong><code>{{ attribute.key }}</code></div>
        <div><span>{{ attribute.type }}</span><small>{{ attribute.description || '无说明' }}</small></div>
        <div class="attribute-flags"><span v-if="attribute.required">必填</span><span :class="{ 'is-off': !attribute.enabled }">{{ attribute.enabled ? '启用' : '停用' }}</span></div>
        <div class="attribute-actions">
          <button type="button" :disabled="index === 0 || reordering" :aria-label="`上移属性 ${attribute.name}`" @click="move(attribute, -1)">↑</button>
          <button type="button" :disabled="index === attributes.length - 1 || reordering" :aria-label="`下移属性 ${attribute.name}`" @click="move(attribute, 1)">↓</button>
          <button type="button" @click="openEdit(attribute)">编辑</button>
          <button type="button" class="danger" @click="remove(attribute)">删除</button>
        </div>
      </article>
    </div>
    <template #footer><button type="button" class="button button--secondary" @click="emit('close')">关闭</button></template>
  </SurfaceDialog>

  <SurfaceDialog
    :show="editorOpen"
    :title="editing ? '编辑属性' : '新增属性'"
    :description="editing ? '属性键创建后不可修改。' : '属性键将作为稳定业务标识。'"
    :width="DialogWidth.STANDARD"
    @close="editorOpen = false"
  >
    <form id="attribute-definition-form" class="attribute-form" @submit.prevent="save">
      <label><span>属性键 *</span><input v-model="form.key" required pattern="^[a-zA-Z][a-zA-Z0-9_]*$" :disabled="!!editing" placeholder="customer_tier"></label>
      <label><span>展示名称 *</span><input v-model="form.name" required placeholder="客户等级"></label>
      <label><span>字段类型</span><select v-model="form.type"><option v-for="type in attributeTypes" :key="type" :value="type">{{ type }}</option></select></label>
      <label><span>占位提示</span><input v-model="form.placeholder"></label>
      <label class="wide"><span>说明</span><input v-model="form.description"></label>
      <div v-if="usesOptions()" class="wide option-editor">
        <div v-for="(option, index) in form.options" :key="index"><input v-model="option.value" placeholder="稳定值"><input v-model="option.label" placeholder="展示标签"><button type="button" @click="removeOption(index)">×</button></div>
        <button type="button" class="mini-button" @click="addOption">添加选项</button>
      </div>
      <label class="toggle"><input v-model="form.required" type="checkbox"><span>用户资料中必填</span></label>
      <label class="toggle"><input v-model="form.enabled" type="checkbox"><span>启用属性</span></label>
    </form>
    <template #footer><button type="button" class="button button--secondary" @click="editorOpen = false">取消</button><button type="submit" form="attribute-definition-form" class="button button--primary" :disabled="saving">{{ saving ? '保存中…' : '保存属性' }}</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.attribute-toolbar { margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--text-secondary); font-size: var(--font-body-sm); }
.attribute-toolbar .button { min-height: 40px; padding-inline: 14px; }
.attribute-state { min-height: 220px; display: grid; place-content: center; color: var(--text-secondary); text-align: center; }
.attribute-list { display: grid; gap: 1px; background: var(--border-subtle); border: 1px solid var(--border-subtle); }
.attribute-list article { padding: 14px; display: grid; grid-template-columns: minmax(170px, 1fr) minmax(170px, 1fr) auto auto; align-items: center; gap: 16px; background: var(--surface-raised); }
.attribute-list article > div { display: grid; gap: 4px; }
.attribute-list code { width: max-content; color: var(--accent); font-size: var(--font-meta); }
.attribute-list span, .attribute-list small { color: var(--text-secondary); font-size: var(--font-meta); }
.attribute-flags { display: flex !important; grid-auto-flow: column; }
.attribute-flags span { padding: 4px 7px; color: var(--success); background: color-mix(in srgb, var(--success) 9%, transparent); border-radius: 6px; }
.attribute-flags .is-off { color: var(--text-secondary); background: var(--surface-canvas); }
.attribute-actions { display: flex !important; grid-auto-flow: column; gap: 4px !important; }
.attribute-actions button, .mini-button { min-height: 34px; padding: 0 9px; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; }
.attribute-actions button:disabled { opacity: 0.38; cursor: not-allowed; }
.attribute-actions .danger { color: var(--danger); }
.attribute-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }
.attribute-form label { display: grid; align-content: start; gap: 7px; color: var(--text-secondary); font-size: var(--font-body-sm); }
.attribute-form label.wide, .option-editor { grid-column: 1 / -1; }
.attribute-form input, .attribute-form select { width: 100%; min-height: 43px; padding: 0 11px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }
.option-editor { display: grid; gap: 8px; }
.option-editor > div { display: grid; grid-template-columns: 1fr 1fr 34px; gap: 7px; }
.option-editor > div button { color: var(--danger); background: transparent; border: 1px solid var(--border-subtle); border-radius: 8px; }
.option-editor > .mini-button { width: max-content; }
.attribute-form .toggle { display: flex; align-items: center; gap: 8px; }
.attribute-form .toggle input { width: auto; min-height: auto; }
@media (max-width: 720px) { .attribute-list article { grid-template-columns: 1fr auto; } .attribute-list article > div:nth-child(2) { grid-column: 1 / -1; } .attribute-form { grid-template-columns: 1fr; } .attribute-form label.wide, .option-editor { grid-column: auto; } }
</style>
