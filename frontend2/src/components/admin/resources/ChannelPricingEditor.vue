<script setup lang="ts">
import { ref } from 'vue'
import * as channelsAPI from '@shared-api/admin/channels'
import {
  BillingModeOption,
  emptyPricingDraft,
  perTokenToMillion,
  splitValues,
  type ChannelPricingDraft,
  type PricingIntervalDraft
} from '@/features/admin/resources/model'
import { useAppStore } from '@/stores/app'

const props = withDefaults(defineProps<{
  modelValue: ChannelPricingDraft[]
  platform?: string
  allowPlatform?: boolean
}>(), { platform: '', allowPlatform: true })

const emit = defineEmits<{ 'update:modelValue': [value: ChannelPricingDraft[]] }>()
const app = useAppStore()
const syncing = ref<number | null>(null)
const lookingUp = ref<number | null>(null)

function replaceAt(index: number, patch: Partial<ChannelPricingDraft>): void {
  emit('update:modelValue', props.modelValue.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
}

function updateField<K extends keyof ChannelPricingDraft>(index: number, field: K, value: ChannelPricingDraft[K]): void {
  replaceAt(index, { [field]: value } as Pick<ChannelPricingDraft, K>)
}

function addPricing(): void {
  emit('update:modelValue', [...props.modelValue, emptyPricingDraft(props.platform)])
}

function removePricing(index: number): void {
  emit('update:modelValue', props.modelValue.filter((_, itemIndex) => itemIndex !== index))
}

function emptyInterval(index: number): PricingIntervalDraft {
  const previous = props.modelValue[index]?.intervals.at(-1)
  return {
    min_tokens: previous?.max_tokens ?? 0,
    max_tokens: null,
    tier_label: '',
    input_price: null,
    output_price: null,
    cache_write_price: null,
    cache_read_price: null,
    per_request_price: null,
    sort_order: props.modelValue[index]?.intervals.length ?? 0
  }
}

function addInterval(index: number): void {
  const entry = props.modelValue[index]
  if (!entry) return
  replaceAt(index, { intervals: [...entry.intervals, emptyInterval(index)] })
}

function updateInterval(index: number, intervalIndex: number, patch: Partial<PricingIntervalDraft>): void {
  const entry = props.modelValue[index]
  if (!entry) return
  replaceAt(index, {
    intervals: entry.intervals.map((item, itemIndex) => itemIndex === intervalIndex ? { ...item, ...patch } : item)
  })
}

function removeInterval(index: number, intervalIndex: number): void {
  const entry = props.modelValue[index]
  if (!entry) return
  replaceAt(index, { intervals: entry.intervals.filter((_, itemIndex) => itemIndex !== intervalIndex) })
}

async function syncModels(index: number): Promise<void> {
  const entry = props.modelValue[index]
  if (!entry?.platform) {
    app.showError('请先选择平台')
    return
  }
  syncing.value = index
  try {
    const response = await channelsAPI.syncPricingModels(entry.platform)
    const merged = [...new Set([...splitValues(entry.modelsText), ...response.models])]
    replaceAt(index, { modelsText: merged.join('\n') })
    app.showSuccess(`已同步 ${response.models.length} 个模型`)
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '模型同步失败')
  } finally {
    syncing.value = null
  }
}

async function lookupDefault(index: number): Promise<void> {
  const entry = props.modelValue[index]
  const model = splitValues(entry?.modelsText || '')[0]
  if (!entry || !model) {
    app.showError('请先填写至少一个模型')
    return
  }
  lookingUp.value = index
  try {
    const response = await channelsAPI.getModelDefaultPricing(model)
    if (!response.found) {
      app.showError('定价目录中没有该模型')
      return
    }
    replaceAt(index, {
      input_price: perTokenToMillion(response.input_price),
      output_price: perTokenToMillion(response.output_price),
      cache_write_price: perTokenToMillion(response.cache_write_price),
      cache_read_price: perTokenToMillion(response.cache_read_price),
      image_input_price: perTokenToMillion(response.image_input_price),
      image_output_price: perTokenToMillion(response.image_output_price)
    })
    app.showSuccess('已填入目录参考价，请确认后保存')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '读取默认价格失败')
  } finally {
    lookingUp.value = null
  }
}
</script>

<template>
  <section class="pricing-editor" aria-label="模型计价规则">
    <header class="pricing-editor__header">
      <div>
        <h3>模型计价规则</h3>
        <p>Token 价格统一按 USD / 1M Token 输入；保存时自动换算为后端既有的单 Token 价格。</p>
      </div>
      <button class="resource-button resource-button--secondary" type="button" @click="addPricing">新增计价组</button>
    </header>

    <div v-if="modelValue.length === 0" class="resource-empty-inline">
      尚未配置专用价格；系统继续使用既有默认计价语义。
    </div>

    <article v-for="(entry, index) in modelValue" :key="index" class="pricing-rule">
      <div class="pricing-rule__title">
        <strong>计价组 {{ index + 1 }}</strong>
        <div class="resource-inline-actions">
          <button type="button" class="resource-link" :disabled="syncing === index" @click="syncModels(index)">
            {{ syncing === index ? '同步中…' : '拉取平台模型' }}
          </button>
          <button type="button" class="resource-link" :disabled="lookingUp === index" @click="lookupDefault(index)">
            {{ lookingUp === index ? '读取中…' : '读取目录参考价' }}
          </button>
          <button type="button" class="resource-link resource-link--danger" @click="removePricing(index)">移除</button>
        </div>
      </div>

      <div class="resource-form-grid resource-form-grid--3">
        <label v-if="allowPlatform">平台
          <select :value="entry.platform" @change="updateField(index, 'platform', ($event.target as HTMLSelectElement).value)">
            <option value="">跟随资源平台</option>
            <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option><option value="antigravity">Antigravity</option>
            <option value="grok">Grok</option><option value="kimi">Kimi</option>
            <option value="zhipu">智谱</option><option value="deepseek">DeepSeek</option>
          </select>
        </label>
        <label>计费模式
          <select :value="entry.billing_mode" @change="updateField(index, 'billing_mode', ($event.target as HTMLSelectElement).value as BillingModeOption)">
            <option :value="BillingModeOption.TOKEN">按 Token</option>
            <option :value="BillingModeOption.PER_REQUEST">按请求</option>
            <option :value="BillingModeOption.IMAGE">按图片</option>
            <option :value="BillingModeOption.VIDEO">按视频</option>
          </select>
        </label>
        <label class="resource-field--wide">模型（逗号或换行分隔）
          <textarea :value="entry.modelsText" rows="3" placeholder="gpt-5.5&#10;gpt-5.5-mini" @input="updateField(index, 'modelsText', ($event.target as HTMLTextAreaElement).value)" />
        </label>
      </div>

      <div v-if="entry.billing_mode === BillingModeOption.TOKEN" class="resource-form-grid resource-form-grid--4">
        <label>输入 $/1M<input :value="entry.input_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'input_price', ($event.target as HTMLInputElement).value)" /></label>
        <label>输出 $/1M<input :value="entry.output_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'output_price', ($event.target as HTMLInputElement).value)" /></label>
        <label>缓存写入 $/1M<input :value="entry.cache_write_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'cache_write_price', ($event.target as HTMLInputElement).value)" /></label>
        <label>缓存读取 $/1M<input :value="entry.cache_read_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'cache_read_price', ($event.target as HTMLInputElement).value)" /></label>
        <label>图片输入 $/1M<input :value="entry.image_input_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'image_input_price', ($event.target as HTMLInputElement).value)" /></label>
        <label>图片输出 $/1M<input :value="entry.image_output_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'image_output_price', ($event.target as HTMLInputElement).value)" /></label>
      </div>
      <div v-else class="resource-form-grid resource-form-grid--3">
        <label>按次价格 USD<input :value="entry.per_request_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'per_request_price', ($event.target as HTMLInputElement).value)" /></label>
        <label>图片输入 $/1M<input :value="entry.image_input_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'image_input_price', ($event.target as HTMLInputElement).value)" /></label>
        <label>图片输出 $/1M<input :value="entry.image_output_price ?? ''" type="number" min="0" step="any" @input="updateField(index, 'image_output_price', ($event.target as HTMLInputElement).value)" /></label>
      </div>

      <div class="pricing-intervals">
        <div class="pricing-intervals__heading">
          <div><strong>阶梯区间</strong><small>可选；区间不能重叠，无上限区间必须最后。</small></div>
          <button type="button" class="resource-link" @click="addInterval(index)">添加区间</button>
        </div>
        <div v-for="(interval, intervalIndex) in entry.intervals" :key="intervalIndex" class="pricing-interval">
          <label>起点<input :value="interval.min_tokens" type="number" min="0" @input="updateInterval(index, intervalIndex, { min_tokens: ($event.target as HTMLInputElement).value })" /></label>
          <label>终点<input :value="interval.max_tokens ?? ''" type="number" min="0" placeholder="无上限" @input="updateInterval(index, intervalIndex, { max_tokens: ($event.target as HTMLInputElement).value || null })" /></label>
          <label>区间名称<input :value="interval.tier_label" type="text" @input="updateInterval(index, intervalIndex, { tier_label: ($event.target as HTMLInputElement).value })" /></label>
          <label v-if="entry.billing_mode === BillingModeOption.TOKEN">输入 $/1M<input :value="interval.input_price ?? ''" type="number" min="0" step="any" @input="updateInterval(index, intervalIndex, { input_price: ($event.target as HTMLInputElement).value })" /></label>
          <label v-if="entry.billing_mode === BillingModeOption.TOKEN">输出 $/1M<input :value="interval.output_price ?? ''" type="number" min="0" step="any" @input="updateInterval(index, intervalIndex, { output_price: ($event.target as HTMLInputElement).value })" /></label>
          <label v-else>按次价格<input :value="interval.per_request_price ?? ''" type="number" min="0" step="any" @input="updateInterval(index, intervalIndex, { per_request_price: ($event.target as HTMLInputElement).value })" /></label>
          <button type="button" class="resource-link resource-link--danger" @click="removeInterval(index, intervalIndex)">删除</button>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.pricing-editor { display: grid; gap: 16px; }
.pricing-editor__header, .pricing-rule__title, .pricing-intervals__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.pricing-editor h3, .pricing-rule__title strong { margin: 0; }
.pricing-editor p, .pricing-intervals small { margin: 5px 0 0; display: block; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.pricing-rule { padding: 18px; display: grid; gap: 17px; border: 1px solid var(--border-subtle); border-radius: 15px; background: var(--surface-canvas); }
.pricing-intervals { padding-top: 15px; display: grid; gap: 12px; border-top: 1px solid var(--border-subtle); }
.pricing-interval { display: grid; grid-template-columns: repeat(5, minmax(105px, 1fr)) auto; align-items: end; gap: 9px; }
@media (max-width: 760px) { .pricing-editor__header, .pricing-rule__title { align-items: stretch; flex-direction: column; } .pricing-interval { grid-template-columns: repeat(2, 1fr); } }
</style>
