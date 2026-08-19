<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as modelPlazaAPI from '@shared-api/modelPlaza'
import type { ModelPlazaResponse } from '@shared-api/modelPlaza'
import ModelPricingDialog from '@/components/user/models/ModelPricingDialog.vue'
import {
  billingModeLabel,
  filterPricing,
  flattenPricing,
  formatEffectivePrice,
  PricingBillingFilter,
  pricingUnit,
  type PricingRow
} from './model'
import { BILLING_MODE_PER_REQUEST } from '@/constants/channel'

interface PricingGroupView {
  id: number
  name: string
  description: string
  platform: string
  rows: PricingRow[]
}

const response = ref<ModelPlazaResponse | null>(null)
const query = ref('')
const platform = ref('all')
const billingFilter = ref(PricingBillingFilter.ALL)
const loading = ref(true)
const error = ref('')
const selectedRow = ref<PricingRow | null>(null)
const detailOpen = ref(false)
let controller: AbortController | null = null

const rows = computed(() => flattenPricing(response.value?.groups ?? []))
const platforms = computed(() => [...new Set(rows.value.map((row) => row.platform))].sort())
const filteredRows = computed(() => filterPricing(rows.value, query.value, platform.value, billingFilter.value))
const groupedRows = computed<PricingGroupView[]>(() => {
  const groups = new Map<number, PricingGroupView>()
  for (const row of filteredRows.value) {
    const existing = groups.get(row.groupId)
    if (existing) existing.rows.push(row)
    else groups.set(row.groupId, { id: row.groupId, name: row.groupName, description: row.groupDescription, platform: row.platform, rows: [row] })
  }
  return [...groups.values()]
})
const summary = computed(() => ({
  groups: groupedRows.value.length,
  models: filteredRows.value.length,
  platforms: new Set(filteredRows.value.map((row) => row.platform)).size,
  exclusive: new Set(filteredRows.value.filter((row) => row.isExclusive).map((row) => row.groupId)).size
}))

function openDetail(row: PricingRow): void {
  selectedRow.value = row
  detailOpen.value = true
}

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    response.value = await modelPlazaAPI.getModelPlaza({ signal: controller.signal })
  } catch (caught) {
    const candidate = caught as { code?: string; name?: string; message?: string }
    if (candidate.code !== 'ERR_CANCELED' && candidate.name !== 'AbortError') error.value = candidate.message || '模型价格暂时无法加载'
  } finally {
    loading.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="pricing-explorer" aria-label="模型价格浏览器">
    <section class="pricing-metrics">
      <div><span>可见分组</span><strong>{{ summary.groups }}</strong></div>
      <div><span>模型价格项</span><strong>{{ summary.models }}</strong></div>
      <div><span>平台</span><strong>{{ summary.platforms }}</strong></div>
      <div><span>专属分组</span><strong>{{ summary.exclusive }}</strong></div>
    </section>

    <aside v-if="response?.description" class="pricing-description"><strong>价格说明</strong><p>{{ response.description }}</p></aside>

    <div class="pricing-toolbar">
      <label class="search-field"><span>搜索</span><input v-model="query" type="search" placeholder="模型、平台、分组或说明"></label>
      <label><span>平台</span><select v-model="platform" aria-label="筛选平台"><option value="all">全部平台</option><option v-for="item in platforms" :key="item" :value="item">{{ item }}</option></select></label>
      <label><span>计费模式</span><select v-model="billingFilter" aria-label="筛选计费模式"><option :value="PricingBillingFilter.ALL">全部模式</option><option :value="PricingBillingFilter.TOKEN">Token</option><option :value="PricingBillingFilter.PER_REQUEST">按次</option><option :value="PricingBillingFilter.IMAGE">图片</option><option :value="PricingBillingFilter.VIDEO">视频</option></select></label>
      <button type="button" class="button button--secondary" :disabled="loading" @click="load">{{ loading ? '同步中…' : '刷新价格' }}</button>
    </div>

    <div v-if="loading" class="pricing-state" role="status">正在同步共享模型广场…</div>
    <div v-else-if="error" class="pricing-state pricing-state--error" role="alert"><p>{{ error }}</p><button type="button" class="button button--secondary" @click="load">重新加载</button></div>
    <div v-else-if="groupedRows.length === 0" class="pricing-state">没有找到匹配的模型价格。</div>
    <div v-else class="pricing-groups">
      <section v-for="group in groupedRows" :key="group.id" class="pricing-group">
        <header>
          <div><span class="platform-tag">{{ group.platform }}</span><h2>{{ group.name }}</h2><p>{{ group.description || '该分组暂无价格说明。' }}</p></div>
          <div class="group-rate-summary">
            <span :class="['access-badge', { exclusive: group.rows[0]?.isExclusive }]">{{ group.rows[0]?.isExclusive ? '专属分组' : '公开分组' }}</span>
            <span>{{ group.rows[0]?.subscriptionType === 'subscription' ? '订阅权益' : '标准计费' }}</span>
            <span>默认 {{ group.rows[0]?.defaultRate }}×</span>
            <span v-if="group.rows[0]?.userRate != null">账号专属 {{ group.rows[0]?.userRate }}×</span>
            <span v-if="group.rows[0]?.peakRateEnabled">高峰 {{ group.rows[0]?.peakStart }}–{{ group.rows[0]?.peakEnd }} · {{ group.rows[0]?.peakRate }}×</span>
            <span v-if="group.rows[0]?.imageRateIndependent">图片独立 {{ group.rows[0]?.imageRate }}×</span>
          </div>
        </header>
        <div class="group-table-wrap"><table><thead><tr><th>模型 / 模式</th><th>输入</th><th>输出</th><th>缓存写</th><th>缓存读</th><th>图片输入</th><th>图片输出</th><th>按次</th><th>官方参考</th><th>操作</th></tr></thead><tbody><tr v-for="row in group.rows" :key="row.key"><td><strong>{{ row.model }}</strong><small>{{ billingModeLabel(row.billingMode) }} {{ pricingUnit(row.billingMode) }} · 生效 {{ row.effectiveRate }}×</small></td><td>{{ formatEffectivePrice(row.input, row.effectiveRate, row.billingMode) }}</td><td>{{ formatEffectivePrice(row.output, row.effectiveRate, row.billingMode) }}</td><td>{{ formatEffectivePrice(row.cacheWrite, row.effectiveRate, row.billingMode) }}</td><td>{{ formatEffectivePrice(row.cacheRead, row.effectiveRate, row.billingMode) }}</td><td>{{ formatEffectivePrice(row.imageInput, row.effectiveRate, row.billingMode) }}</td><td>{{ formatEffectivePrice(row.imageOutput, row.effectiveRate, row.billingMode) }}</td><td>{{ formatEffectivePrice(row.perRequest, row.effectiveRate, BILLING_MODE_PER_REQUEST) }}</td><td><span :class="['coverage-dot', { covered: row.officialPricing }]">{{ row.officialPricing ? '已覆盖' : '无数据' }}</span></td><td><button type="button" @click="openDetail(row)">完整价格<span v-if="row.intervals.length"> · {{ row.intervals.length }} 阶</span></button></td></tr></tbody></table></div>
      </section>
    </div>

    <aside class="pricing-notes"><div><span>01</span><p><strong>价格口径</strong> Token 字段按每 100 万 Token 展示；图片与按次字段按单次展示，币种为 USD。</p></div><div><span>02</span><p><strong>倍率口径</strong> 优先使用账号专属倍率；图片独立计价开启时，图片模型改用图片倍率；高峰倍率单独标识。</p></div><div><span>03</span><p><strong>字段完整性</strong> 点击“完整价格”可查看基准价、生效价、所有阶梯和五项官方参考价格。</p></div></aside>

    <ModelPricingDialog
      :show="detailOpen"
      :model-name="selectedRow?.model || ''"
      :platform="selectedRow?.platform || ''"
      :context="selectedRow ? `${selectedRow.groupName} · ${billingModeLabel(selectedRow.billingMode)}` : ''"
      :pricing="selectedRow?.pricing || null"
      :official-pricing="selectedRow?.officialPricing || null"
      :effective-rate="selectedRow?.effectiveRate || 1"
      @close="detailOpen = false"
    />
  </section>
</template>

<style scoped>
.pricing-explorer { width: 100%; padding-bottom: 50px; }.pricing-metrics { margin-bottom: 22px; display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--border-subtle); }.pricing-metrics div { padding: 17px 19px; display: grid; gap: 6px; border-right: 1px solid var(--border-subtle); }.pricing-metrics div:first-child { padding-left: 0; }.pricing-metrics div:last-child { border-right: 0; }.pricing-metrics span { color: var(--text-secondary); font-size: var(--font-meta); }.pricing-metrics strong { font-size: 25px; }.pricing-description { margin-bottom: 15px; padding: 13px 15px; display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 13px; color: var(--text-primary); background: color-mix(in srgb, var(--accent) 5%, var(--surface-raised)); border-left: 3px solid var(--accent); border-radius: 6px; }.pricing-description strong { font-size: var(--font-meta); }.pricing-description p { margin: 0; color: var(--text-secondary); white-space: pre-wrap; font-size: var(--font-meta); line-height: 1.6; }
.pricing-toolbar { margin-bottom: 16px; padding: 11px; display: grid; grid-template-columns: minmax(220px, 1.5fr) minmax(130px, .7fr) minmax(130px, .7fr) auto; align-items: end; gap: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.pricing-toolbar label { display: grid; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); }.pricing-toolbar input, .pricing-toolbar select { min-height: 40px; padding: 0 10px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; }.pricing-toolbar .button { min-height: 40px; }.pricing-state { min-height: 260px; display: grid; place-content: center; gap: 12px; color: var(--text-secondary); text-align: center; border: 1px solid var(--border-subtle); border-radius: 14px; }.pricing-state--error { color: var(--danger); }
.pricing-groups { display: grid; gap: 14px; }.pricing-group { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }.pricing-group > header { padding: 15px 17px; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; background: color-mix(in srgb, var(--accent) 2.5%, var(--surface-raised)); border-bottom: 1px solid var(--border-subtle); }.pricing-group header > div:first-child { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 5px 9px; }.pricing-group h2 { margin: 0; font-size: 16px; }.pricing-group header p { grid-column: 1 / -1; margin: 2px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.platform-tag { padding: 4px 6px; color: var(--accent); background: var(--accent-soft); border-radius: 5px; font-size: var(--font-meta); font-weight: 700; text-transform: uppercase; }.group-rate-summary { max-width: 55%; display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 5px; }.group-rate-summary span { padding: 4px 6px; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 5px; font-size: var(--font-meta); }.group-rate-summary .access-badge { color: var(--success); }.group-rate-summary .access-badge.exclusive { color: var(--accent); }
.group-table-wrap { overflow: auto; }.group-table-wrap table { width: 100%; min-width: 1250px; border-collapse: collapse; }.group-table-wrap th, .group-table-wrap td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); font-variant-numeric: tabular-nums; }.group-table-wrap th { color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-meta); text-transform: uppercase; letter-spacing: .05em; }.group-table-wrap tr:last-child td { border-bottom: 0; }.group-table-wrap td:first-child { min-width: 190px; }.group-table-wrap td:first-child strong, .group-table-wrap td:first-child small { display: block; }.group-table-wrap td:first-child small { margin-top: 5px; color: var(--text-secondary); }.group-table-wrap td:last-child button { min-height: 29px; padding: 0 8px; color: var(--accent); background: transparent; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border-subtle)); border-radius: 6px; cursor: pointer; white-space: nowrap; font-size: var(--font-meta); }.coverage-dot { color: var(--text-secondary); }.coverage-dot::before { content: ''; width: 5px; height: 5px; margin-right: 5px; display: inline-block; background: var(--border-subtle); border-radius: 50%; }.coverage-dot.covered { color: var(--success); }.coverage-dot.covered::before { background: var(--success); }
.pricing-notes { margin-top: 16px; display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--border-subtle); }.pricing-notes > div { padding: 14px; display: grid; grid-template-columns: auto 1fr; gap: 9px; border-right: 1px solid var(--border-subtle); }.pricing-notes > div:last-child { border-right: 0; }.pricing-notes span { color: var(--accent); font: 700 var(--font-caption)/1 var(--font-mono); }.pricing-notes p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.6; }.pricing-notes strong { color: var(--text-primary); }
@media (max-width: 860px) { .pricing-toolbar { grid-template-columns: 1fr 1fr; }.search-field { grid-column: 1 / -1; }.pricing-toolbar .button { width: 100%; }.pricing-group > header { flex-direction: column; }.group-rate-summary { max-width: none; justify-content: flex-start; }.pricing-notes { grid-template-columns: 1fr; }.pricing-notes > div { border-right: 0; border-bottom: 1px solid var(--border-subtle); }.pricing-notes > div:last-child { border-bottom: 0; } }
@media (max-width: 580px) { .pricing-metrics { grid-template-columns: 1fr 1fr; }.pricing-metrics div:nth-child(2) { border-right: 0; }.pricing-metrics div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); }.pricing-metrics div:first-child { padding-left: 19px; }.pricing-description { grid-template-columns: 1fr; } }
</style>
