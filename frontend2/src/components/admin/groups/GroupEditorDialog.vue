<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import * as groupsAPI from '@shared-api/admin/groups'
import type { AdminGroup } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import ChannelPricingEditor from '@/components/admin/resources/ChannelPricingEditor.vue'
import {
  GroupEditorTab,
  emptyGroupDraft,
  groupDraftToRequest,
  groupToDraft,
  type GroupDraft
} from '@/features/admin/resources/group'
import { GroupPlatformOption, ResourceStatus, SubscriptionMode, groupPlatformOptions, splitValues } from '@/features/admin/resources/model'
import { useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean; group: AdminGroup | null; groups: AdminGroup[]; submitting?: boolean }>()
const emit = defineEmits<{
  close: []
  submit: [payload: ReturnType<typeof groupDraftToRequest>]
}>()

const app = useAppStore()
const confirm = useConfirmStore()
const tab = ref(GroupEditorTab.BASIC)
const form = reactive<GroupDraft>(emptyGroupDraft())
const modelsListCandidates = ref<string[]>([])
const modelsListLoading = ref(false)
const modelsListError = ref('')
const liveChecking = ref(false)
let modelsListRequest = 0

const selectedModels = computed(() => splitValues(form.models_list_text))

function reset(): void {
  Object.assign(form, props.group ? groupToDraft(props.group) : emptyGroupDraft())
  tab.value = GroupEditorTab.BASIC
}

function toggleCopyGroup(id: number): void {
  form.copy_accounts_from_group_ids = form.copy_accounts_from_group_ids.includes(id)
    ? form.copy_accounts_from_group_ids.filter((item) => item !== id)
    : [...form.copy_accounts_from_group_ids, id]
}

async function loadModelsListCandidates(): Promise<void> {
  const request = ++modelsListRequest
  modelsListLoading.value = true
  modelsListError.value = ''
  try {
    const models = await groupsAPI.getModelAllowlistCandidates(props.group?.id || 0, form.platform)
    if (request === modelsListRequest) modelsListCandidates.value = models
  } catch (caught) {
    if (request === modelsListRequest) {
      modelsListCandidates.value = []
      modelsListError.value = (caught as { message?: string }).message || '候选模型加载失败'
    }
  } finally {
    if (request === modelsListRequest) modelsListLoading.value = false
  }
}

function setSelectedModels(models: string[]): void {
  form.models_list_text = [...new Set(models)].join('\n')
}

function toggleModel(model: string): void {
  const current = selectedModels.value
  setSelectedModels(current.includes(model) ? current.filter((item) => item !== model) : [...current, model])
}

function addAllCandidateModels(): void {
  setSelectedModels([...selectedModels.value, ...modelsListCandidates.value])
}

function invertCandidateModels(): void {
  const current = selectedModels.value
  const candidates = new Set(modelsListCandidates.value)
  const custom = current.filter((model) => !candidates.has(model))
  setSelectedModels([...custom, ...modelsListCandidates.value.filter((model) => !current.includes(model))])
}

async function toggleLive(checked: boolean): Promise<void> {
  if (!checked) {
    form.allow_live = false
    return
  }
  liveChecking.value = true
  try {
    const capability = await groupsAPI.getLiveCapability().catch(() => ({ supported: false, reason: '无法确认当前服务端的 Live 运行能力' }))
    if (capability.supported) {
      form.allow_live = true
      return
    }
    form.allow_live = await confirm.ask({
      title: '当前环境未确认支持 OpenAI Live',
      message: `${capability.reason || '服务端报告 Live 能力不可用'}。仍要为该分组开启吗？`,
      confirmText: '仍然开启',
      cancelText: '保持关闭'
    })
  } finally {
    liveChecking.value = false
  }
}

function submit(): void {
  try {
    emit('submit', groupDraftToRequest(form, Boolean(props.group)))
  } catch (caught) {
    app.showError((caught as Error).message)
  }
}

watch(() => props.show, (show) => {
  if (!show) return
  reset()
  void loadModelsListCandidates()
})

watch(() => form.platform, () => {
  if (props.show) void loadModelsListCandidates()
})
</script>

<template>
  <SurfaceDialog
    :show="show"
    :title="group ? '编辑分组' : '创建分组'"
    description="分组定义授权、调度与最终计价；所有既有字段均在三个区域内保留。"
    :width="DialogWidth.WIDE"
    @close="emit('close')"
  >
    <form id="group-editor-form" class="resource-form-stack" @submit.prevent="submit">
      <div class="resource-tabs" role="tablist" aria-label="分组设置区域">
        <button type="button" role="tab" :aria-selected="tab === GroupEditorTab.BASIC" @click="tab = GroupEditorTab.BASIC">基础与额度</button>
        <button type="button" role="tab" :aria-selected="tab === GroupEditorTab.PRICING" @click="tab = GroupEditorTab.PRICING">计价与媒体</button>
        <button type="button" role="tab" :aria-selected="tab === GroupEditorTab.ROUTING" @click="tab = GroupEditorTab.ROUTING">路由与协议</button>
      </div>

      <div v-if="tab === GroupEditorTab.BASIC" class="resource-form-stack">
        <div class="resource-form-grid resource-form-grid--3">
          <label class="resource-field--wide">分组名称 *<input v-model="form.name" required maxlength="100" /></label>
          <label class="resource-field--wide">描述<textarea v-model="form.description" rows="2" /></label>
          <label>平台<select v-model="form.platform"><option v-for="option in groupPlatformOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label>状态<select v-model="form.status"><option :value="ResourceStatus.ACTIVE">启用</option><option :value="ResourceStatus.INACTIVE">停用</option></select></label>
          <label>授权模式<select v-model="form.subscription_type"><option :value="SubscriptionMode.STANDARD">标准余额</option><option :value="SubscriptionMode.SUBSCRIPTION">订阅额度</option></select></label>
          <label>默认倍率<input v-model="form.rate_multiplier" type="number" min="0" step="any" /></label>
          <label>RPM 上限<input v-model="form.rpm_limit" type="number" min="0" step="1" /><small>0 表示不限</small></label>
          <label>排序值<input v-model.number="form.sort_order" type="number" step="1" disabled /><small>使用列表“调整排序”统一保存</small></label>
        </div>
        <fieldset v-if="form.subscription_type === SubscriptionMode.SUBSCRIPTION" class="resource-form-section">
          <legend>订阅额度（USD）</legend>
          <div class="resource-form-grid resource-form-grid--3">
            <label>每日<input v-model="form.daily_limit_usd" type="number" min="0" step="any" /></label>
            <label>每周<input v-model="form.weekly_limit_usd" type="number" min="0" step="any" /></label>
            <label>每月<input v-model="form.monthly_limit_usd" type="number" min="0" step="any" /></label>
          </div>
        </fieldset>
        <fieldset class="resource-form-section">
          <legend>授权与前置条件</legend>
          <div class="resource-form-grid resource-form-grid--3">
            <label class="resource-check"><input v-model="form.is_exclusive" type="checkbox" /><span>专属分组</span></label>
            <label class="resource-check"><input v-model="form.require_oauth_only" type="checkbox" /><span>仅 OAuth 账号</span></label>
            <label class="resource-check"><input v-model="form.require_privacy_set" type="checkbox" /><span>要求隐私设置完成</span></label>
          </div>
        </fieldset>
        <fieldset v-if="!group" class="resource-form-section">
          <legend>创建时复制账号</legend>
          <div class="resource-form-grid resource-form-grid--3">
            <label v-for="candidate in groups" :key="candidate.id" class="resource-check">
              <input type="checkbox" :checked="form.copy_accounts_from_group_ids.includes(candidate.id)" @change="toggleCopyGroup(candidate.id)" />
              <span>{{ candidate.name }} · {{ candidate.platform }}</span>
            </label>
          </div>
        </fieldset>
      </div>

      <div v-else-if="tab === GroupEditorTab.PRICING" class="resource-form-stack">
        <ChannelPricingEditor v-model="form.model_pricing" :platform="form.platform" :allow-platform="false" />
        <fieldset class="resource-form-section">
          <legend>Token 与高峰计费</legend>
          <div class="resource-form-grid resource-form-grid--4">
            <label class="resource-check"><input v-model="form.long_context_pricing_enabled" type="checkbox" /><span>启用长上下文价格</span></label>
            <label class="resource-check"><input v-model="form.peak_rate_enabled" type="checkbox" /><span>启用高峰倍率</span></label>
            <label>高峰开始<input v-model="form.peak_start" type="time" /></label>
            <label>高峰结束<input v-model="form.peak_end" type="time" /></label>
            <label>高峰倍率<input v-model="form.peak_rate_multiplier" type="number" min="0" step="any" /></label>
            <label class="resource-check"><input v-model="form.profit_control_enabled" type="checkbox" /><span>启用利润控制</span></label>
            <label>最低利润率<input v-model="form.profit_min_margin" type="number" min="0" step="any" /></label>
            <label>安全缓冲<input v-model="form.profit_safety_buffer" type="number" min="0" step="any" /></label>
          </div>
        </fieldset>
        <fieldset class="resource-form-section">
          <legend>图片与批量图片</legend>
          <div class="resource-form-grid resource-form-grid--4">
            <label class="resource-check"><input v-model="form.allow_image_generation" type="checkbox" /><span>允许图片生成</span></label>
            <label class="resource-check"><input v-model="form.allow_batch_image_generation" type="checkbox" /><span>允许批量图片</span></label>
            <label class="resource-check"><input v-model="form.image_rate_independent" type="checkbox" /><span>图片独立倍率</span></label>
            <label>图片倍率<input v-model="form.image_rate_multiplier" type="number" min="0" step="any" /></label>
            <label>批量折扣倍率<input v-model="form.batch_image_discount_multiplier" type="number" min="0" step="any" /></label>
            <label>批量预扣倍率<input v-model="form.batch_image_hold_multiplier" type="number" min="0" step="any" /></label>
            <label>1K 图片价<input v-model="form.image_price_1k" type="number" min="0" step="any" /></label>
            <label>2K 图片价<input v-model="form.image_price_2k" type="number" min="0" step="any" /></label>
            <label>4K 图片价<input v-model="form.image_price_4k" type="number" min="0" step="any" /></label>
          </div>
        </fieldset>
        <fieldset class="resource-form-section">
          <legend>视频与特殊媒体价格</legend>
          <div class="resource-form-grid resource-form-grid--4">
            <label class="resource-check"><input v-model="form.video_rate_independent" type="checkbox" /><span>视频独立倍率</span></label>
            <label>视频倍率<input v-model="form.video_rate_multiplier" type="number" min="0" step="any" /></label>
            <label>480p 价格<input v-model="form.video_price_480p" type="number" min="0" step="any" /></label>
            <label>720p 价格<input v-model="form.video_price_720p" type="number" min="0" step="any" /></label>
            <label>1080p 价格<input v-model="form.video_price_1080p" type="number" min="0" step="any" /></label>
            <label>网页搜索 / 次<input v-model="form.web_search_price_per_call" type="number" min="0" step="any" /></label>
            <label>搜索 / 1K<input v-model="form.search_price_per_1k" type="number" min="0" step="any" /></label>
            <label>实时音频 / 分钟<input v-model="form.audio_realtime_price_per_min" type="number" min="0" step="any" /></label>
            <label>TTS / 百万字符<input v-model="form.audio_tts_price_per_million_chars" type="number" min="0" step="any" /></label>
            <label>STT / 小时<input v-model="form.audio_stt_price_per_hour" type="number" min="0" step="any" /></label>
            <label class="resource-field--wide">视频模型 × 分辨率覆盖价（JSON）<textarea v-model="form.video_model_prices_json" rows="5" spellcheck="false" /></label>
          </div>
        </fieldset>
      </div>

      <div v-else class="resource-form-stack">
        <fieldset class="resource-form-section">
          <legend>降级与模型能力</legend>
          <div class="resource-form-grid resource-form-grid--3">
            <label>默认降级分组<select v-model="form.fallback_group_id"><option value="">不降级</option><option v-for="candidate in groups.filter(item => item.id !== group?.id)" :key="candidate.id" :value="candidate.id">{{ candidate.name }}</option></select></label>
            <label>无效请求降级分组<select v-model="form.fallback_group_id_on_invalid_request"><option value="">不降级</option><option v-for="candidate in groups.filter(item => item.id !== group?.id)" :key="candidate.id" :value="candidate.id">{{ candidate.name }}</option></select></label>
            <label>Reasoning 上限<input v-model="form.max_reasoning_effort" placeholder="留空表示不限" /></label>
            <label class="resource-field--wide">支持的模型范围（逗号或换行）<textarea v-model="form.supported_model_scopes_text" rows="3" /></label>
            <label class="resource-field--wide">Reasoning effort 映射（JSON 数组）<textarea v-model="form.reasoning_effort_mappings_json" rows="4" spellcheck="false" /></label>
          </div>
        </fieldset>
        <fieldset class="resource-form-section">
          <legend>协议能力</legend>
          <div class="resource-form-grid resource-form-grid--3">
            <label class="resource-check"><input v-model="form.claude_code_only" type="checkbox" /><span>仅 Claude Code</span></label>
            <label class="resource-check"><input v-model="form.mcp_xml_inject" type="checkbox" /><span>注入 MCP XML</span></label>
            <label v-if="form.platform === GroupPlatformOption.OPENAI" class="resource-check"><input type="checkbox" :checked="form.allow_live" :disabled="liveChecking" @change="toggleLive(($event.target as HTMLInputElement).checked)" /><span>{{ liveChecking ? '检查 Live 能力…' : '允许 OpenAI Live' }}</span></label>
            <label class="resource-check"><input v-model="form.allow_messages_dispatch" type="checkbox" /><span>允许 Messages 调度</span></label>
            <label>默认映射模型<input v-model="form.default_mapped_model" /></label>
            <label class="resource-field--wide">Messages 调度配置（JSON）<textarea v-model="form.messages_dispatch_json" rows="5" spellcheck="false" /></label>
          </div>
        </fieldset>
        <fieldset class="resource-form-section">
          <legend>/v1/models 列表</legend>
          <label class="resource-check"><input v-model="form.models_list_enabled" type="checkbox" /><span>使用自定义模型列表</span></label>
          <template v-if="form.models_list_enabled">
            <div class="resource-inline-actions">
              <button type="button" class="resource-button resource-button--secondary" :disabled="modelsListLoading" @click="loadModelsListCandidates">{{ modelsListLoading ? '加载中…' : '刷新候选模型' }}</button>
              <button type="button" class="resource-button resource-button--secondary" :disabled="!modelsListCandidates.length" @click="addAllCandidateModels">加入全部</button>
              <button type="button" class="resource-button resource-button--secondary" :disabled="!modelsListCandidates.length" @click="invertCandidateModels">反选候选项</button>
              <span class="muted">已选 {{ selectedModels.length }} 个</span>
            </div>
            <p v-if="modelsListError" class="resource-field-error" role="alert">{{ modelsListError }}</p>
            <div v-if="modelsListCandidates.length" class="model-candidate-grid" aria-label="候选模型">
              <label v-for="model in modelsListCandidates" :key="model" class="resource-check">
                <input type="checkbox" :checked="selectedModels.includes(model)" @change="toggleModel(model)" />
                <span>{{ model }}</span>
              </label>
            </div>
            <label>模型顺序（可手动调整，逗号或换行）<textarea v-model="form.models_list_text" rows="6" /></label>
          </template>
        </fieldset>
        <fieldset class="resource-form-section">
          <legend>账号模型路由</legend>
          <label class="resource-check"><input v-model="form.model_routing_enabled" type="checkbox" /><span>启用账号级模型路由</span></label>
          <label>路由表（模型到账号 ID 数组，JSON）<textarea v-model="form.model_routing_json" rows="7" spellcheck="false" /></label>
        </fieldset>
      </div>
    </form>
    <template #footer>
      <button type="button" class="button button--secondary" @click="emit('close')">取消</button>
      <button type="submit" form="group-editor-form" class="button button--primary" :disabled="submitting">{{ submitting ? '保存中…' : '保存分组' }}</button>
    </template>
  </SurfaceDialog>
</template>

<style scoped>
.model-candidate-grid {
  max-height: 220px;
  padding: 10px;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
  background: var(--surface-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
}

@media (max-width: 760px) {
  .model-candidate-grid { grid-template-columns: 1fr; }
}
</style>
