<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import * as accountsAPI from '@shared-api/admin/accounts'
import type { Channel, CreateChannelRequest, UpdateChannelRequest } from '@shared-api/admin/channels'
import type { Account, AdminGroup } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import ChannelPricingEditor from '@/components/admin/resources/ChannelPricingEditor.vue'
import { ChannelEditorTab, channelDraftToRequest, channelToDraft, emptyChannelDraft, emptyChannelRule, type ChannelDraft } from '@/features/admin/resources/channel'
import { useAppStore } from '@/stores/app'
import { useConfirmStore } from '@/stores/confirm'

const props = defineProps<{ show: boolean; channel: Channel | null; groups: AdminGroup[]; channels: Channel[]; submitting?: boolean }>()
const emit = defineEmits<{ close: []; submit: [payload: CreateChannelRequest | UpdateChannelRequest] }>()
const app = useAppStore()
const confirm = useConfirmStore()
const tab = ref(ChannelEditorTab.BASIC)
const form = reactive<ChannelDraft>(emptyChannelDraft())
const baseline = ref('')
const accountQueries = ref<Record<number, string>>({})
const accountResults = ref<Record<number, Account[]>>({})
const accountSearching = ref<Record<number, boolean>>({})
let accountTimer: number | null = null

const groupConflicts = computed(() => {
  const map = new Map<number, string>()
  props.channels.filter((item) => item.id !== props.channel?.id).forEach((item) => item.group_ids.forEach((id) => map.set(id, item.name)))
  return map
})
const dirty = computed(() => props.show && JSON.stringify(form) !== baseline.value)

function reset(): void {
  Object.assign(form, props.channel ? channelToDraft(props.channel) : emptyChannelDraft())
  tab.value = ChannelEditorTab.BASIC; accountQueries.value = {}; accountResults.value = {}
  baseline.value = JSON.stringify(form)
}

function toggleGroup(id: number): void {
  form.group_ids = form.group_ids.includes(id) ? form.group_ids.filter((item) => item !== id) : [...form.group_ids, id]
}

function toggleRuleGroup(ruleIndex: number, id: number): void {
  const rule = form.account_stats_pricing_rules[ruleIndex]; if (!rule) return
  rule.group_ids = rule.group_ids.includes(id) ? rule.group_ids.filter((item) => item !== id) : [...rule.group_ids, id]
}

function addRule(): void { form.account_stats_pricing_rules.push(emptyChannelRule()) }
function removeRule(index: number): void { form.account_stats_pricing_rules.splice(index, 1) }

function searchAccountsLater(ruleIndex: number): void {
  if (accountTimer) window.clearTimeout(accountTimer)
  accountTimer = window.setTimeout(() => void searchAccounts(ruleIndex), 280)
}

async function searchAccounts(ruleIndex: number): Promise<void> {
  accountSearching.value[ruleIndex] = true
  try { accountResults.value[ruleIndex] = (await accountsAPI.list(1, 12, { search: accountQueries.value[ruleIndex] || undefined })).items }
  catch (caught) { app.showError((caught as { message?: string }).message || '账号搜索失败') }
  finally { accountSearching.value[ruleIndex] = false }
}

function selectAccount(ruleIndex: number, account: Account): void {
  const rule = form.account_stats_pricing_rules[ruleIndex]; if (!rule || rule.account_ids.includes(account.id)) return
  rule.account_ids.push(account.id)
}

function removeAccount(ruleIndex: number, id: number): void {
  const rule = form.account_stats_pricing_rules[ruleIndex]; if (rule) rule.account_ids = rule.account_ids.filter((item) => item !== id)
}

function accountLabel(ruleIndex: number, id: number): string {
  const found = accountResults.value[ruleIndex]?.find((item) => item.id === id)
  return found ? `${found.name} #${id}` : `账号 #${id}`
}

function submit(): void {
  try { emit('submit', channelDraftToRequest(form, Boolean(props.channel))) }
  catch (caught) { app.showError((caught as Error).message) }
}

async function requestClose(): Promise<void> {
  if (!dirty.value || await confirm.ask({ title: '放弃未保存修改？', message: '渠道表单中的改动尚未保存。', confirmText: '放弃修改' })) emit('close')
}

watch(() => props.show, (show) => { if (show) reset() })
</script>

<template>
  <SurfaceDialog :show="show" :title="channel ? '编辑渠道' : '创建渠道'" description="渠道聚合分组，并决定模型映射、计费模型来源与账号统计价格。" :width="DialogWidth.WIDE" @close="requestClose">
    <form id="channel-editor-form" class="resource-form-stack" @submit.prevent="submit">
      <div class="resource-tabs" role="tablist"><button type="button" role="tab" :aria-selected="tab === ChannelEditorTab.BASIC" @click="tab = ChannelEditorTab.BASIC">基础与分组</button><button type="button" role="tab" :aria-selected="tab === ChannelEditorTab.PRICING" @click="tab = ChannelEditorTab.PRICING">模型与价格</button><button type="button" role="tab" :aria-selected="tab === ChannelEditorTab.ADVANCED" @click="tab = ChannelEditorTab.ADVANCED">映射与统计</button></div>

      <div v-if="tab === ChannelEditorTab.BASIC" class="resource-form-stack">
        <div class="resource-form-grid resource-form-grid--3">
          <label class="resource-field--wide">渠道名称 *<input v-model="form.name" required /></label><label class="resource-field--wide">描述<textarea v-model="form.description" rows="3" /></label>
          <label v-if="channel">状态<select v-model="form.status"><option value="active">启用</option><option value="disabled">停用</option></select></label>
          <label>计费模型来源<select v-model="form.billing_model_source"><option value="channel_mapped">渠道映射后模型</option><option value="requested">请求模型</option><option value="upstream">最终上游模型</option><option value="response_model">上游响应模型</option></select></label>
          <label class="resource-check"><input v-model="form.restrict_models" type="checkbox" /><span>仅允许定价表内模型</span></label>
        </div>
        <fieldset class="resource-form-section"><legend>绑定分组 *</legend><div class="group-choice-grid"><label v-for="group in groups" :key="group.id" :class="['group-choice', { 'group-choice--blocked': groupConflicts.has(group.id) && !form.group_ids.includes(group.id) }]"><input type="checkbox" :checked="form.group_ids.includes(group.id)" :disabled="groupConflicts.has(group.id) && !form.group_ids.includes(group.id)" @change="toggleGroup(group.id)" /><span><strong>{{ group.name }}</strong><small>{{ group.platform }} · {{ group.rate_multiplier }}×<template v-if="groupConflicts.has(group.id)"> · 已属于 {{ groupConflicts.get(group.id) }}</template></small></span></label></div></fieldset>
      </div>

      <div v-else-if="tab === ChannelEditorTab.PRICING" class="resource-form-stack">
        <ChannelPricingEditor v-model="form.model_pricing" />
        <fieldset class="resource-form-section"><legend>渠道能力开关</legend><div class="resource-form-grid resource-form-grid--3"><label class="resource-check"><input v-model="form.web_search_emulation" type="checkbox" /><span>Anthropic Web Search 模拟</span></label><label class="resource-check"><input v-model="form.codex_image_generation_bridge" type="checkbox" /><span>Codex 图片生成桥接</span></label><label class="resource-check"><input v-model="form.bedrock_cc_compat" type="checkbox" /><span>Bedrock Claude Code 兼容</span></label></div></fieldset>
      </div>

      <div v-else class="resource-form-stack">
        <fieldset class="resource-form-section"><legend>模型映射</legend><p class="muted">按平台配置源模型到目标模型，例如 { "openai": { "gpt-*": "gpt-5.5" } }。</p><textarea v-model="form.model_mapping_json" rows="8" class="resource-code" spellcheck="false" /></fieldset>
        <fieldset class="resource-form-section"><legend>扩展能力原始配置</legend><p class="muted">保存时保留未被上方三个开关管理的既有字段。</p><textarea v-model="form.features_config_json" rows="7" class="resource-code" spellcheck="false" /></fieldset>
        <fieldset class="resource-form-section"><legend>账号统计自定义价格</legend><label class="resource-check"><input v-model="form.apply_pricing_to_account_stats" type="checkbox" /><span>将自定义价格应用于账号成本统计</span></label><button type="button" class="resource-button resource-button--secondary" @click="addRule">新增统计规则</button>
          <article v-for="(rule, ruleIndex) in form.account_stats_pricing_rules" :key="ruleIndex" class="channel-rule">
            <div class="pricing-rule__title"><strong>规则 {{ ruleIndex + 1 }}</strong><button class="resource-link resource-link--danger" type="button" @click="removeRule(ruleIndex)">删除规则</button></div>
            <label>规则名称 *<input v-model="rule.name" /></label>
            <div><small class="muted">匹配分组</small><div class="rule-choices"><label v-for="group in groups" :key="group.id" class="resource-check"><input type="checkbox" :checked="rule.group_ids.includes(group.id)" @change="toggleRuleGroup(ruleIndex, group.id)" /><span>{{ group.name }}</span></label></div></div>
            <div class="account-picker"><label>搜索并加入账号<input v-model="accountQueries[ruleIndex]" placeholder="账号名称" @focus="searchAccounts(ruleIndex)" @input="searchAccountsLater(ruleIndex)" /></label><div class="selected-chips"><button v-for="id in rule.account_ids" :key="id" type="button" @click="removeAccount(ruleIndex, id)">{{ accountLabel(ruleIndex, id) }} ×</button></div><div v-if="accountSearching[ruleIndex]" class="muted">搜索中…</div><div v-else-if="accountResults[ruleIndex]?.length" class="account-results"><button v-for="account in accountResults[ruleIndex]" :key="account.id" type="button" :disabled="rule.account_ids.includes(account.id)" @click="selectAccount(ruleIndex, account)">{{ account.name }} <small>#{{ account.id }} · {{ account.platform }}</small></button></div></div>
            <ChannelPricingEditor v-model="rule.pricing" />
          </article>
        </fieldset>
      </div>
    </form>
    <template #footer><button type="button" class="button button--secondary" @click="requestClose">取消</button><button type="submit" form="channel-editor-form" class="button button--primary" :disabled="submitting">{{ submitting ? '保存中…' : '保存渠道' }}</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.group-choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.group-choice { padding: 11px; display: flex; gap: 9px; background: var(--surface-canvas); border-radius: 10px; cursor: pointer; }.group-choice span { display: grid; gap: 4px; }.group-choice small { color: var(--text-secondary); font-size: var(--font-meta); }.group-choice--blocked { opacity: .52; cursor: not-allowed; }.channel-rule { padding: 16px; display: grid; gap: 14px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 13px; }.pricing-rule__title { display: flex; align-items: center; justify-content: space-between; }.channel-rule > label, .account-picker label { display: grid; gap: 6px; color: var(--text-secondary); font-size: var(--font-body-sm); }.channel-rule input { min-height: 40px; padding: 8px 11px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 9px; }.rule-choices, .selected-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 7px; }.selected-chips button { padding: 5px 8px; color: var(--accent); background: var(--accent-soft); border: 0; border-radius: 999px; cursor: pointer; font-size: var(--font-meta); }.account-results { max-height: 160px; overflow: auto; display: grid; border: 1px solid var(--border-subtle); border-radius: 9px; }.account-results button { padding: 9px; display: flex; justify-content: space-between; color: var(--text-primary); background: var(--surface-raised); border: 0; border-bottom: 1px solid var(--border-subtle); cursor: pointer; text-align: left; }.account-results button:last-child { border-bottom: 0; }
@media (max-width: 700px) { .group-choice-grid { grid-template-columns: 1fr; } }
</style>
