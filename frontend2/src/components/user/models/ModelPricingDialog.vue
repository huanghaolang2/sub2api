<script setup lang="ts">
import type { UserSupportedModelPricing } from '@shared-api/channels'
import type { PlazaOfficialPricing } from '@shared-api/modelPlaza'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import {
  billingModeLabel,
  formatBasePrice,
  formatEffectivePrice,
  pricingUnit
} from '@/features/pricing/model'
import { BILLING_MODE_PER_REQUEST, BILLING_MODE_TOKEN } from '@/constants/channel'

withDefaults(defineProps<{
  show: boolean
  modelName: string
  platform?: string
  context?: string
  pricing: UserSupportedModelPricing | null
  officialPricing?: PlazaOfficialPricing | null
  effectiveRate?: number
}>(), {
  platform: '',
  context: '',
  officialPricing: null,
  effectiveRate: 1
})

defineEmits<{ close: [] }>()
</script>

<template>
  <SurfaceDialog
    :show="show"
    :title="modelName || '模型价格'"
    :description="[platform, context].filter(Boolean).join(' · ')"
    :width="DialogWidth.WIDE"
    @close="$emit('close')"
  >
    <div v-if="!pricing" class="pricing-empty">该模型已开放，但当前渠道未配置价格。</div>
    <div v-else class="pricing-detail">
      <section class="pricing-overview">
        <div><span>计费模式</span><strong>{{ billingModeLabel(pricing.billing_mode) }}</strong></div>
        <div><span>展示单位</span><strong>{{ pricingUnit(pricing.billing_mode) }}</strong></div>
        <div><span>生效倍率</span><strong>{{ effectiveRate }}×</strong></div>
        <div><span>阶梯区间</span><strong>{{ pricing.intervals?.length || 0 }}</strong></div>
      </section>

      <section class="price-ledger">
        <header><div><span>字段</span><span>渠道基准价</span><span>当前生效价</span></div></header>
        <div><strong>输入</strong><span>{{ formatBasePrice(pricing.input_price, pricing.billing_mode) }}</span><span>{{ formatEffectivePrice(pricing.input_price, effectiveRate, pricing.billing_mode) }}</span></div>
        <div><strong>输出</strong><span>{{ formatBasePrice(pricing.output_price, pricing.billing_mode) }}</span><span>{{ formatEffectivePrice(pricing.output_price, effectiveRate, pricing.billing_mode) }}</span></div>
        <div><strong>缓存写入</strong><span>{{ formatBasePrice(pricing.cache_write_price, pricing.billing_mode) }}</span><span>{{ formatEffectivePrice(pricing.cache_write_price, effectiveRate, pricing.billing_mode) }}</span></div>
        <div><strong>缓存读取</strong><span>{{ formatBasePrice(pricing.cache_read_price, pricing.billing_mode) }}</span><span>{{ formatEffectivePrice(pricing.cache_read_price, effectiveRate, pricing.billing_mode) }}</span></div>
        <div><strong>图片输入</strong><span>{{ formatBasePrice(pricing.image_input_price, pricing.billing_mode) }}</span><span>{{ formatEffectivePrice(pricing.image_input_price, effectiveRate, pricing.billing_mode) }}</span></div>
        <div><strong>图片输出</strong><span>{{ formatBasePrice(pricing.image_output_price, pricing.billing_mode) }}</span><span>{{ formatEffectivePrice(pricing.image_output_price, effectiveRate, pricing.billing_mode) }}</span></div>
        <div><strong>按次调用</strong><span>{{ formatBasePrice(pricing.per_request_price, BILLING_MODE_PER_REQUEST) }}</span><span>{{ formatEffectivePrice(pricing.per_request_price, effectiveRate, BILLING_MODE_PER_REQUEST) }}</span></div>
      </section>

      <section v-if="pricing.intervals?.length" class="interval-section">
        <header><div><strong>阶梯定价</strong><small>Token 范围为 (min, max]；max 为空表示无上限。</small></div></header>
        <div class="interval-table-wrap"><table><thead><tr><th>区间 / 标签</th><th>输入</th><th>输出</th><th>缓存写</th><th>缓存读</th><th>按次</th></tr></thead><tbody><tr v-for="(interval, index) in pricing.intervals" :key="`${interval.min_tokens}-${interval.max_tokens}-${index}`"><td><strong>{{ interval.tier_label || `(${interval.min_tokens.toLocaleString()}, ${interval.max_tokens == null ? '∞' : interval.max_tokens.toLocaleString()}]` }}</strong></td><td>{{ formatBasePrice(interval.input_price, pricing.billing_mode) }}</td><td>{{ formatBasePrice(interval.output_price, pricing.billing_mode) }}</td><td>{{ formatBasePrice(interval.cache_write_price, pricing.billing_mode) }}</td><td>{{ formatBasePrice(interval.cache_read_price, pricing.billing_mode) }}</td><td>{{ formatBasePrice(interval.per_request_price, BILLING_MODE_PER_REQUEST) }}</td></tr></tbody></table></div>
      </section>

      <section v-if="officialPricing" class="official-section">
        <header><div><strong>官方参考价</strong><small>来自 LiteLLM 数据；字段为空表示官方数据未覆盖，不代表免费。</small></div></header>
        <dl><div><dt>输入 / 1M</dt><dd>{{ formatBasePrice(officialPricing.input_price, BILLING_MODE_TOKEN) }}</dd></div><div><dt>输出 / 1M</dt><dd>{{ formatBasePrice(officialPricing.output_price, BILLING_MODE_TOKEN) }}</dd></div><div><dt>缓存写 5m / 1M</dt><dd>{{ formatBasePrice(officialPricing.cache_write_price, BILLING_MODE_TOKEN) }}</dd></div><div><dt>缓存写 1h / 1M</dt><dd>{{ formatBasePrice(officialPricing.cache_write_1h_price ?? null, BILLING_MODE_TOKEN) }}</dd></div><div><dt>缓存读 / 1M</dt><dd>{{ formatBasePrice(officialPricing.cache_read_price, BILLING_MODE_TOKEN) }}</dd></div></dl>
      </section>
    </div>
    <template #footer><button type="button" class="button button--secondary" @click="$emit('close')">关闭</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.pricing-empty { min-height: 200px; display: grid; place-content: center; color: var(--text-secondary); }.pricing-detail { display: grid; gap: 14px; }.pricing-overview { display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--border-subtle); }.pricing-overview > div { padding: 13px; display: grid; gap: 6px; border-right: 1px solid var(--border-subtle); }.pricing-overview > div:last-child { border-right: 0; }.pricing-overview span, .official-section dt { color: var(--text-secondary); font-size: var(--font-meta); text-transform: uppercase; letter-spacing: .06em; }.pricing-overview strong { font-size: 14px; }
.price-ledger { overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 11px; }.price-ledger header, .price-ledger > div { padding: 10px 13px; border-bottom: 1px solid var(--border-subtle); }.price-ledger > div:last-child { border-bottom: 0; }.price-ledger header { background: var(--surface-canvas); }.price-ledger header > div, .price-ledger > div { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }.price-ledger header span { color: var(--text-secondary); font-size: var(--font-meta); text-transform: uppercase; }.price-ledger > div strong, .price-ledger > div span { font-size: var(--font-meta); font-variant-numeric: tabular-nums; }.price-ledger > div span:last-child { color: var(--accent); font-weight: 700; }
.interval-section, .official-section { display: grid; gap: 10px; }.interval-section header > div, .official-section header > div { display: flex; align-items: baseline; gap: 8px; }.interval-section header small, .official-section header small { color: var(--text-secondary); font-size: var(--font-meta); }.interval-table-wrap { overflow: auto; border: 1px solid var(--border-subtle); border-radius: 10px; }.interval-table-wrap table { width: 100%; min-width: 690px; border-collapse: collapse; }.interval-table-wrap th, .interval-table-wrap td { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }.interval-table-wrap th { color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-meta); }.interval-table-wrap tr:last-child td { border-bottom: 0; }
.official-section { padding: 14px; background: color-mix(in srgb, var(--accent) 4%, var(--surface-canvas)); border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-subtle)); border-radius: 11px; }.official-section dl { margin: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: var(--border-subtle); }.official-section dl div { padding: 10px; display: grid; gap: 5px; background: var(--surface-raised); }.official-section dd { margin: 0; font-size: var(--font-meta); font-weight: 700; }
@media (max-width: 720px) { .pricing-overview { grid-template-columns: 1fr 1fr; }.pricing-overview > div:nth-child(2) { border-right: 0; }.pricing-overview > div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); }.official-section dl { grid-template-columns: 1fr 1fr; }.price-ledger header > div, .price-ledger > div { grid-template-columns: .8fr 1fr 1fr; } }
</style>
