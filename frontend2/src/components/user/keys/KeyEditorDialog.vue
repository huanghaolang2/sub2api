<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import * as keysAPI from '@shared-api/keys'
import type { ApiKey, Group } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { useAppStore } from '@/stores/app'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import {
  buildKeyUpdate,
  createEmptyKeyDraft,
  draftFromKey,
  ExpirationPreset,
  expirationDateForDays,
  expiresInDays,
  formatMoney,
  KeyEditorMode,
  parseIpLines,
  positiveOrZero,
  quotaPercent,
  validateCustomKey,
  type KeyEditorDraft
} from '@/features/user/keys/model'

const props = defineProps<{
  show: boolean
  mode: KeyEditorMode
  apiKey: ApiKey | null
  groups: Group[]
  userGroupRates: Record<number, number>
}>()

const emit = defineEmits<{
  close: []
  saved: [key: ApiKey, mode: KeyEditorMode]
}>()

const app = useAppStore()
const confirmDialog = useConfirmStore()
const saving = ref(false)
const resetBusy = ref<'quota' | 'rate' | null>(null)
const workingKey = ref<ApiKey | null>(null)
const draft = reactive<KeyEditorDraft>(createEmptyKeyDraft())

const isEdit = computed(() => props.mode === KeyEditorMode.EDIT)
const title = computed(() => isEdit.value ? '编辑 API Key' : '创建 API Key')
const selectedGroup = computed(() => props.groups.find((group) => group.id === draft.groupId) ?? null)
const customKeyError = computed(() => draft.useCustomKey ? validateCustomKey(draft.customKey.trim()) : '')

function resetDraft(): void {
  const next = props.mode === KeyEditorMode.EDIT && props.apiKey
    ? draftFromKey(props.apiKey)
    : createEmptyKeyDraft()
  if (props.mode === KeyEditorMode.CREATE && props.groups.length === 1) next.groupId = props.groups[0]?.id ?? null
  Object.assign(draft, next)
  workingKey.value = props.apiKey ? { ...props.apiKey } : null
  resetBusy.value = null
}

function selectExpiration(days: number): void {
  draft.expirationPreset = String(days) as ExpirationPreset
  draft.expirationDate = expirationDateForDays(days)
}

function validate(): string {
  if (!draft.name.trim()) return '请输入 Key 名称'
  if (draft.groupId == null) return '请选择一个访问分组'
  if (draft.useCustomKey && customKeyError.value) return customKeyError.value
  if (Number(draft.quota ?? 0) < 0) return '总额度不能小于 0'
  if (draft.enableRateLimit && [draft.rateLimit5h, draft.rateLimit1d, draft.rateLimit7d].some((value) => Number(value ?? 0) < 0)) return '周期限额不能小于 0'
  if (draft.enableExpiration) {
    if (!draft.expirationDate) return '请选择到期时间'
    if (new Date(draft.expirationDate).getTime() <= Date.now()) return '到期时间必须晚于当前时间'
  }
  return ''
}

async function submit(): Promise<void> {
  if (saving.value) return
  const invalid = validate()
  if (invalid) {
    app.showError(invalid)
    return
  }
  saving.value = true
  try {
    let saved: ApiKey
    if (isEdit.value && workingKey.value) {
      saved = await keysAPI.update(workingKey.value.id, buildKeyUpdate(draft, workingKey.value))
    } else {
      saved = await keysAPI.create(
        draft.name.trim(),
        draft.groupId,
        draft.useCustomKey ? draft.customKey.trim() : undefined,
        draft.enableIpRestriction ? parseIpLines(draft.ipWhitelist) : [],
        draft.enableIpRestriction ? parseIpLines(draft.ipBlacklist) : [],
        positiveOrZero(draft.quota),
        draft.enableExpiration ? expiresInDays(draft.expirationDate) : undefined,
        {
          rate_limit_5h: draft.enableRateLimit ? positiveOrZero(draft.rateLimit5h) : 0,
          rate_limit_1d: draft.enableRateLimit ? positiveOrZero(draft.rateLimit1d) : 0,
          rate_limit_7d: draft.enableRateLimit ? positiveOrZero(draft.rateLimit7d) : 0
        }
      )
    }
    app.showSuccess(isEdit.value ? 'API Key 已更新' : 'API Key 已创建')
    emit('saved', saved, props.mode)
    emit('close')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || 'API Key 保存失败')
  } finally {
    saving.value = false
  }
}

async function resetUsage(kind: 'quota' | 'rate'): Promise<void> {
  if (!workingKey.value || resetBusy.value) return
  const confirmed = await confirmDialog.ask({
    title: kind === 'quota' ? '重置总额度用量' : '重置周期用量',
    message: kind === 'quota'
      ? `将“${workingKey.value.name}”的累计额度用量清零，额度上限保持不变。`
      : `将“${workingKey.value.name}”的 5 小时、1 天和 7 天窗口用量同时清零。`,
    confirmText: '确认重置',
    tone: ConfirmTone.DANGER
  })
  if (!confirmed) return
  resetBusy.value = kind
  try {
    const saved = await keysAPI.update(workingKey.value.id, kind === 'quota'
      ? { reset_quota: true }
      : { reset_rate_limit_usage: true })
    workingKey.value = saved
    app.showSuccess(kind === 'quota' ? '额度用量已重置' : '周期用量已重置')
    emit('saved', saved, KeyEditorMode.EDIT)
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '重置失败')
  } finally {
    resetBusy.value = null
  }
}

watch(() => [props.show, props.mode, props.apiKey?.id] as const, ([show]) => {
  if (show) resetDraft()
}, { immediate: true })
</script>

<template>
  <SurfaceDialog
    :show="show"
    :title="title"
    description="完整配置分组、网络访问、总额度、周期限额与有效期。0 表示不限制。"
    :width="DialogWidth.WIDE"
    @close="!saving && emit('close')"
  >
    <form id="key-editor-form" class="key-editor" @submit.prevent="submit">
      <section class="editor-section editor-section--primary">
        <header><span>01</span><div><h3>身份与访问分组</h3><p>Key 必须绑定一个当前账号可访问的分组。</p></div></header>
        <div class="editor-grid">
          <label class="field"><span>Key 名称 *</span><input v-model="draft.name" required maxlength="64" placeholder="例如：生产服务"></label>
          <label class="field"><span>访问分组 *</span><select v-model="draft.groupId" required><option :value="null" disabled>选择分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.platform }} · {{ userGroupRates[group.id] ?? group.rate_multiplier }}×</option></select></label>
          <div v-if="selectedGroup" class="group-context wide"><strong>{{ selectedGroup.name }}</strong><span>{{ selectedGroup.platform }} · {{ selectedGroup.subscription_type === 'subscription' ? '订阅分组' : '标准分组' }}</span><span v-if="selectedGroup.peak_rate_enabled">高峰 {{ selectedGroup.peak_start }}–{{ selectedGroup.peak_end }} 为 {{ selectedGroup.peak_rate_multiplier }}×</span><p>{{ selectedGroup.description || '该分组暂无说明。' }}</p></div>
          <template v-if="!isEdit">
            <label class="switch-row wide"><input v-model="draft.useCustomKey" type="checkbox"><span><strong>使用自定义 Key</strong><small>至少 16 位，仅允许字母、数字、下划线和连字符。</small></span></label>
            <label v-if="draft.useCustomKey" class="field wide"><span>自定义 Key *</span><input v-model="draft.customKey" autocomplete="off" :class="{ invalid: customKeyError }" placeholder="your_custom_api_key"><small v-if="customKeyError" class="field-error">{{ customKeyError }}</small></label>
          </template>
          <label v-else class="field"><span>状态</span><select v-model="draft.status"><option value="active">启用</option><option value="inactive">停用</option></select><small v-if="workingKey?.status === 'expired' || workingKey?.status === 'quota_exhausted'">当前为 {{ workingKey.status }}；选择启用可恢复使用。</small></label>
        </div>
      </section>

      <section class="editor-section">
        <header><span>02</span><div><h3>网络访问限制</h3><p>白名单优先定义允许范围，黑名单用于排除特定地址；每行或逗号分隔。</p></div></header>
        <label class="switch-row"><input v-model="draft.enableIpRestriction" type="checkbox"><span><strong>启用 IP 限制</strong><small>关闭后保存会清空已有白名单和黑名单。</small></span></label>
        <div v-if="draft.enableIpRestriction" class="editor-grid">
          <label class="field"><span>IP 白名单</span><textarea v-model="draft.ipWhitelist" rows="4" placeholder="203.0.113.10&#10;10.0.0.0/8"></textarea></label>
          <label class="field"><span>IP 黑名单</span><textarea v-model="draft.ipBlacklist" rows="4" placeholder="198.51.100.20"></textarea></label>
        </div>
      </section>

      <section class="editor-section">
        <header><span>03</span><div><h3>消费额度</h3><p>总额度与周期限额分别计数；任一限制耗尽都会阻止继续调用。</p></div></header>
        <div class="editor-grid">
          <label class="field"><span>总额度（USD）</span><input v-model.number="draft.quota" type="number" min="0" step="0.01" placeholder="0 = 不限"></label>
          <div v-if="isEdit && workingKey && workingKey.quota > 0" class="usage-preview">
            <div><span>已使用</span><strong>{{ formatMoney(workingKey.quota_used) }} / {{ formatMoney(workingKey.quota, 2) }}</strong></div>
            <div class="progress"><i :style="{ width: `${quotaPercent(workingKey.quota_used, workingKey.quota)}%` }"></i></div>
            <button type="button" :disabled="resetBusy !== null" @click="resetUsage('quota')">{{ resetBusy === 'quota' ? '重置中…' : '重置已用额度' }}</button>
          </div>
        </div>
        <label class="switch-row"><input v-model="draft.enableRateLimit" type="checkbox"><span><strong>启用滚动周期限额</strong><small>分别控制 5 小时、1 天和 7 天的消费。</small></span></label>
        <div v-if="draft.enableRateLimit" class="limit-grid">
          <label><span>5 小时</span><input v-model.number="draft.rateLimit5h" type="number" min="0" step="0.01" placeholder="0"></label>
          <label><span>1 天</span><input v-model.number="draft.rateLimit1d" type="number" min="0" step="0.01" placeholder="0"></label>
          <label><span>7 天</span><input v-model.number="draft.rateLimit7d" type="number" min="0" step="0.01" placeholder="0"></label>
          <button v-if="isEdit && workingKey && (workingKey.usage_5h > 0 || workingKey.usage_1d > 0 || workingKey.usage_7d > 0)" type="button" :disabled="resetBusy !== null" @click="resetUsage('rate')">{{ resetBusy === 'rate' ? '重置中…' : '重置三个周期用量' }}</button>
        </div>
      </section>

      <section class="editor-section">
        <header><span>04</span><div><h3>有效期</h3><p>可快速延长 7 / 30 / 90 天，或直接选择精确到期时间。</p></div></header>
        <label class="switch-row"><input v-model="draft.enableExpiration" type="checkbox"><span><strong>设置到期时间</strong><small>关闭后保存将取消有效期限制。</small></span></label>
        <div v-if="draft.enableExpiration" class="expiration-editor">
          <div class="preset-row"><button v-for="days in [7, 30, 90]" :key="days" type="button" :class="{ active: draft.expirationPreset === String(days) }" @click="selectExpiration(days)">{{ isEdit ? `延长 ${days} 天` : `${days} 天` }}</button><button type="button" :class="{ active: draft.expirationPreset === ExpirationPreset.CUSTOM }" @click="draft.expirationPreset = ExpirationPreset.CUSTOM">自定义</button></div>
          <label class="field"><span>到期时间</span><input v-model="draft.expirationDate" type="datetime-local" @change="draft.expirationPreset = ExpirationPreset.CUSTOM"></label>
        </div>
      </section>
    </form>
    <template #footer>
      <button type="button" class="button button--secondary" :disabled="saving" @click="emit('close')">取消</button>
      <button type="submit" form="key-editor-form" class="button button--primary" :disabled="saving">{{ saving ? '保存中…' : isEdit ? '保存更改' : '创建 Key' }}</button>
    </template>
  </SurfaceDialog>
</template>

<style scoped>
.key-editor { display: grid; gap: 14px; }
.editor-section { padding: 18px; display: grid; gap: 16px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 14px; }
.editor-section--primary { background: color-mix(in srgb, var(--accent) 4%, var(--surface-canvas)); border-color: color-mix(in srgb, var(--accent) 22%, var(--border-subtle)); }
.editor-section > header { display: flex; gap: 11px; align-items: flex-start; }
.editor-section > header > span { width: 26px; height: 26px; display: grid; place-content: center; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 8px; font: 750 var(--font-meta)/1 var(--font-mono); }
.editor-section h3 { margin: 0; font-size: 14px; letter-spacing: -.01em; }
.editor-section header p { margin: 4px 0 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.5; }
.editor-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.wide { grid-column: 1 / -1; }
.field { display: grid; align-content: start; gap: 7px; color: var(--text-secondary); font-size: var(--font-meta); }
.field input, .field select, .field textarea, .limit-grid input { width: 100%; min-height: 42px; padding: 0 11px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; outline: none; }
.field textarea { padding-block: 10px; resize: vertical; font-family: var(--font-mono, monospace); font-size: var(--font-body-sm); }
.field input:focus, .field select:focus, .field textarea:focus, .limit-grid input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 9%, transparent); }
.field input.invalid { border-color: var(--danger); }
.field small { color: var(--text-secondary); line-height: 1.4; }
.field .field-error { color: var(--danger); }
.group-context { padding: 12px 14px; display: flex; align-items: center; flex-wrap: wrap; gap: 7px; background: var(--surface-raised); border-left: 3px solid var(--accent); border-radius: 7px; font-size: var(--font-meta); }
.group-context strong { font-size: 12px; }
.group-context span { padding: 3px 6px; color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 5px; }
.group-context p { width: 100%; margin: 0; color: var(--text-secondary); }
.switch-row { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.switch-row input { margin-top: 2px; accent-color: var(--accent); }
.switch-row span { display: grid; gap: 3px; }
.switch-row strong { font-size: var(--font-body-sm); }
.switch-row small { color: var(--text-secondary); font-size: var(--font-meta); }
.usage-preview { padding: 10px 12px; display: grid; align-content: center; gap: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; }
.usage-preview > div:first-child { display: flex; justify-content: space-between; gap: 10px; font-size: var(--font-meta); }
.usage-preview .progress { height: 4px; overflow: hidden; background: var(--border-subtle); border-radius: 999px; }
.usage-preview .progress i { height: 100%; display: block; background: var(--accent); }
.usage-preview button, .limit-grid button { width: max-content; padding: 5px 8px; color: var(--danger); background: transparent; border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border-subtle)); border-radius: 7px; cursor: pointer; font-size: var(--font-meta); }
.limit-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.limit-grid label { display: grid; gap: 6px; color: var(--text-secondary); font-size: var(--font-meta); }
.limit-grid button { align-self: end; min-height: 42px; }
.expiration-editor { display: grid; grid-template-columns: 1fr minmax(240px, .7fr); gap: 13px; align-items: end; }
.preset-row { display: flex; flex-wrap: wrap; gap: 6px; }
.preset-row button { min-height: 36px; padding: 0 10px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; }
.preset-row button.active { color: var(--accent); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, var(--surface-raised)); }
@media (max-width: 680px) { .editor-grid, .limit-grid, .expiration-editor { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
</style>
