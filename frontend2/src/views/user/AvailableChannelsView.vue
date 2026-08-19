<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as channelsAPI from '@shared-api/channels'
import * as groupsAPI from '@shared-api/groups'
import type { UserAvailableChannel, UserAvailableGroup, UserChannelPlatformSection, UserSupportedModel } from '@shared-api/channels'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import ModelPricingDialog from '@/components/user/models/ModelPricingDialog.vue'
import {
  ChannelAccessFilter,
  effectiveGroupRate,
  filterAvailableChannels,
  formatPeakWindow,
  modelRateRange,
  splitGroups,
  summarizeAvailableChannels
} from '@/features/user/channels/model'

const channels = ref<UserAvailableChannel[]>([])
const userRates = ref<Record<number, number>>({})
const query = ref('')
const platform = ref('all')
const access = ref(ChannelAccessFilter.ALL)
const loading = ref(true)
const error = ref('')
const selectedModel = ref<UserSupportedModel | null>(null)
const selectedSection = ref<UserChannelPlatformSection | null>(null)
const selectedChannel = ref('')
const selectedRate = ref(1)
const detailOpen = ref(false)
let controller: AbortController | null = null

const platforms = computed(() => [...new Set(channels.value.flatMap((channel) => channel.platforms.map((section) => section.platform)))].sort())
const filtered = computed(() => filterAvailableChannels(channels.value, query.value, platform.value, access.value))
const summary = computed(() => summarizeAvailableChannels(filtered.value))

function isAbortError(caught: unknown): boolean {
  const candidate = caught as { name?: string; code?: string }
  return candidate?.name === 'AbortError' || candidate?.code === 'ERR_CANCELED'
}

function groupsByAccess(section: UserChannelPlatformSection): ReturnType<typeof splitGroups> {
  return splitGroups(section)
}

function rateFor(group: UserAvailableGroup): number {
  return effectiveGroupRate(group, userRates.value)
}

function openModel(channelName: string, section: UserChannelPlatformSection, model: UserSupportedModel): void {
  selectedChannel.value = channelName
  selectedSection.value = section
  selectedModel.value = model
  selectedRate.value = section.groups.length ? rateFor(section.groups[0]!) : 1
  detailOpen.value = true
}

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const [channelResult, rateResult] = await Promise.all([
      channelsAPI.getAvailable({ signal: controller.signal }),
      groupsAPI.getUserGroupRates().catch(() => ({} as Record<number, number>))
    ])
    channels.value = channelResult
    userRates.value = rateResult
  } catch (caught) {
    if (!isAbortError(caught)) error.value = (caught as { message?: string }).message || '可用渠道暂时无法加载'
  } finally {
    loading.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <ConsoleShell>
    <section class="available-page">
      <header class="page-heading channels-heading">
        <div><p>账号实际可访问范围 · 渠道 / 分组 / 模型完整映射</p><h1>可用渠道</h1><span>先确认能用哪个渠道与分组，再查看对应模型的完整基准价和账号生效倍率。</span></div>
        <button
          type="button"
          class="button button--secondary"
          :disabled="loading"
          @click="load"
        >
          {{ loading ? '同步中…' : '刷新能力' }}
        </button>
      </header>

      <section
        class="channel-metrics"
        aria-label="可用能力摘要"
      >
        <div><span>渠道</span><strong>{{ summary.channels }}</strong></div>
        <div><span>平台</span><strong>{{ summary.platforms }}</strong></div>
        <div><span>可用分组</span><strong>{{ summary.groups }}</strong></div>
        <div><span>支持模型</span><strong>{{ summary.models }}</strong></div>
      </section>

      <section
        class="channel-toolbar"
        aria-label="筛选可用渠道"
      >
        <label class="search-field"><span>搜索</span><input
          v-model="query"
          type="search"
          placeholder="渠道、说明、平台、分组或模型"
        ></label>
        <label><span>平台</span><select
          v-model="platform"
          aria-label="筛选渠道平台"
        ><option value="all">全部平台</option><option
          v-for="item in platforms"
          :key="item"
          :value="item"
        >{{ item }}</option></select></label>
        <label><span>访问类型</span><select
          v-model="access"
          aria-label="筛选访问类型"
        ><option :value="ChannelAccessFilter.ALL">全部类型</option><option :value="ChannelAccessFilter.EXCLUSIVE">包含专属分组</option><option :value="ChannelAccessFilter.PUBLIC">包含公开分组</option></select></label>
      </section>

      <div
        v-if="loading"
        class="channel-state"
        role="status"
      >
        正在核对当前账号的渠道、分组和价格…
      </div>
      <div
        v-else-if="error"
        class="channel-state channel-state--error"
        role="alert"
      >
        <p>{{ error }}</p><button
          type="button"
          class="button button--secondary"
          @click="load"
        >
          重新加载
        </button>
      </div>
      <div
        v-else-if="filtered.length === 0"
        class="channel-state"
      >
        <strong>没有匹配的可用渠道</strong><span>清空搜索或切换平台与访问类型后重试。</span>
      </div>
      <div
        v-else
        class="channel-list"
      >
        <article
          v-for="(channel, channelIndex) in filtered"
          :key="`${channel.name}-${channelIndex}`"
          class="channel-card"
        >
          <header><div><span class="channel-index">CH {{ String(channelIndex + 1).padStart(2, '0') }}</span><h2>{{ channel.name }}</h2></div><p>{{ channel.description || '管理员暂未填写渠道说明。' }}</p></header>
          <div class="platform-sections">
            <section
              v-for="section in channel.platforms"
              :key="`${channel.name}-${section.platform}`"
              class="platform-section"
            >
              <header><div><span class="platform-mark">{{ section.platform }}</span><strong>{{ section.groups.length }} 个分组 · {{ section.supported_models.length }} 个模型</strong></div></header>
              <div class="section-grid">
                <div class="group-panel">
                  <div class="panel-title">
                    <span>可访问分组</span><small>专属优先，倍率为当前账号实际值</small>
                  </div>
                  <div
                    v-if="section.groups.length"
                    class="access-blocks"
                  >
                    <section
                      v-if="groupsByAccess(section).exclusive.length"
                      class="access-block access-block--exclusive"
                    >
                      <header><span>专属授权</span><small>{{ groupsByAccess(section).exclusive.length }}</small></header><div class="group-grid">
                        <article
                          v-for="group in groupsByAccess(section).exclusive"
                          :key="group.id"
                          class="group-item"
                        >
                          <div><strong>{{ group.name }}</strong><span>{{ group.subscription_type === 'subscription' ? '订阅权益' : '标准计费' }}</span></div><dl><div><dt>默认</dt><dd>{{ group.rate_multiplier }}×</dd></div><div><dt>账号生效</dt><dd>{{ rateFor(group) }}×</dd></div></dl><p v-if="group.peak_rate_enabled">
                            高峰 {{ formatPeakWindow(group) }}（服务端时区）
                          </p>
                        </article>
                      </div>
                    </section>
                    <section
                      v-if="groupsByAccess(section).public.length"
                      class="access-block"
                    >
                      <header><span>公开分组</span><small>{{ groupsByAccess(section).public.length }}</small></header><div class="group-grid">
                        <article
                          v-for="group in groupsByAccess(section).public"
                          :key="group.id"
                          class="group-item"
                        >
                          <div><strong>{{ group.name }}</strong><span>{{ group.subscription_type === 'subscription' ? '订阅权益' : '标准计费' }}</span></div><dl><div><dt>默认</dt><dd>{{ group.rate_multiplier }}×</dd></div><div><dt>账号生效</dt><dd>{{ rateFor(group) }}×</dd></div></dl><p v-if="group.peak_rate_enabled">
                            高峰 {{ formatPeakWindow(group) }}（服务端时区）
                          </p>
                        </article>
                      </div>
                    </section>
                  </div>
                  <div
                    v-else
                    class="inline-empty"
                  >
                    该平台暂无可访问分组
                  </div>
                </div>
                <div class="model-panel">
                  <div class="panel-title">
                    <span>支持模型</span><small>点击查看全部价格字段与阶梯</small>
                  </div>
                  <div
                    v-if="section.supported_models.length"
                    class="model-grid"
                  >
                    <button
                      v-for="model in section.supported_models"
                      :key="`${section.platform}-${model.name}`"
                      type="button"
                      class="model-chip"
                      @click="openModel(channel.name, section, model)"
                    >
                      <span><strong>{{ model.name }}</strong><small>{{ model.pricing ? model.pricing.billing_mode : '未配置价格' }}</small></span><em>{{ modelRateRange(model, section, userRates) }}</em>
                    </button>
                  </div>
                  <div
                    v-else
                    class="inline-empty"
                  >
                    该平台暂无已发布模型
                  </div>
                </div>
              </div>
            </section>
          </div>
        </article>
      </div>

      <ModelPricingDialog
        :show="detailOpen"
        :model-name="selectedModel?.name || ''"
        :platform="selectedModel?.platform || selectedSection?.platform || ''"
        :context="selectedSection ? `${selectedChannel} · ${selectedSection.groups.length ? '首个可用分组生效价' : '渠道基准价'}` : ''"
        :pricing="selectedModel?.pricing || null"
        :effective-rate="selectedRate"
        @close="detailOpen = false"
      />
    </section>
  </ConsoleShell>
</template>

<style scoped>
.available-page { padding-bottom: 52px; }.channels-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; }.channels-heading .button { flex: 0 0 auto; }.channel-metrics { margin: 24px 0 18px; display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--border-subtle); }.channel-metrics div { padding: 17px 19px; display: grid; gap: 6px; border-right: 1px solid var(--border-subtle); }.channel-metrics div:first-child { padding-left: 0; }.channel-metrics div:last-child { border-right: 0; }.channel-metrics span { color: var(--text-secondary); font-size: var(--font-meta); }.channel-metrics strong { font-size: 25px; }
.channel-toolbar { margin-bottom: 16px; padding: 11px; display: grid; grid-template-columns: minmax(240px, 1.6fr) minmax(140px, .7fr) minmax(170px, .8fr); gap: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; }.channel-toolbar label { display: grid; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); }.channel-toolbar input, .channel-toolbar select { min-height: 40px; padding: 0 10px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; }
.channel-state { min-height: 280px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--text-secondary); text-align: center; border: 1px solid var(--border-subtle); border-radius: 14px; }.channel-state--error { color: var(--danger); }.channel-list { display: grid; gap: 17px; }.channel-card { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }.channel-card > header { padding: 17px 19px; display: grid; grid-template-columns: minmax(200px, .75fr) 1.25fr; align-items: center; gap: 24px; background: color-mix(in srgb, var(--accent) 3%, var(--surface-raised)); border-bottom: 1px solid var(--border-subtle); }.channel-card > header > div { display: flex; align-items: center; gap: 9px; }.channel-card h2 { margin: 0; font-size: 18px; }.channel-card > header p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.6; }.channel-index { color: var(--accent); font: 700 var(--font-caption)/1 var(--font-mono); }
.platform-sections { display: grid; }.platform-section + .platform-section { border-top: 1px solid var(--border-subtle); }.platform-section > header { padding: 10px 19px; background: var(--surface-canvas); }.platform-section > header > div { display: flex; align-items: center; gap: 9px; }.platform-section > header strong { color: var(--text-secondary); font-size: var(--font-meta); font-weight: 500; }.platform-mark { padding: 4px 7px; color: var(--accent); background: var(--accent-soft); border-radius: 5px; font-size: var(--font-meta); font-weight: 800; text-transform: uppercase; }.section-grid { display: grid; grid-template-columns: minmax(420px, 1.05fr) minmax(360px, .95fr); }.group-panel, .model-panel { min-width: 0; padding: 15px 18px 18px; }.group-panel { border-right: 1px solid var(--border-subtle); }.panel-title { margin-bottom: 11px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }.panel-title > span { font-size: var(--font-meta); font-weight: 800; }.panel-title small { color: var(--text-secondary); font-size: var(--font-meta); }
.access-blocks { display: grid; gap: 10px; }.access-block { padding-left: 10px; border-left: 2px solid var(--border-strong); }.access-block--exclusive { border-left-color: var(--accent); }.access-block > header { margin-bottom: 7px; display: flex; gap: 6px; color: var(--text-secondary); font-size: var(--font-meta); }.access-block--exclusive > header { color: var(--accent); }.group-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }.group-item { min-width: 0; padding: 10px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.group-item > div { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }.group-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-meta); }.group-item > div > span { flex: 0 0 auto; color: var(--text-secondary); font-size: var(--font-caption); }.group-item dl { margin: 8px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }.group-item dl div { display: flex; justify-content: space-between; gap: 4px; }.group-item dt { color: var(--text-secondary); font-size: var(--font-caption); }.group-item dd { margin: 0; color: var(--accent); font-size: var(--font-meta); font-weight: 800; }.group-item p { margin: 7px 0 0; color: var(--warning); font-size: var(--font-caption); line-height: 1.45; }
.model-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }.model-chip { min-width: 0; min-height: 54px; padding: 9px 10px; display: flex; align-items: center; justify-content: space-between; gap: 9px; color: var(--text-primary); text-align: left; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; cursor: pointer; transition: border-color .18s ease, transform .18s ease; }.model-chip:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border-subtle)); transform: translateY(-1px); }.model-chip > span { min-width: 0; display: grid; gap: 4px; }.model-chip strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-meta); }.model-chip small { color: var(--text-secondary); font-size: var(--font-caption); text-transform: uppercase; }.model-chip em { flex: 0 0 auto; color: var(--accent); font-size: var(--font-caption); font-style: normal; font-weight: 700; }.inline-empty { min-height: 80px; display: grid; place-content: center; color: var(--text-secondary); font-size: var(--font-meta); border: 1px dashed var(--border-subtle); border-radius: 9px; }
@media (max-width: 1050px) { .section-grid { grid-template-columns: 1fr; }.group-panel { border-right: 0; border-bottom: 1px solid var(--border-subtle); } }
@media (max-width: 760px) { .channels-heading, .channel-card > header { align-items: flex-start; grid-template-columns: 1fr; flex-direction: column; }.channel-toolbar { grid-template-columns: 1fr 1fr; }.search-field { grid-column: 1 / -1; }.channel-card > header { display: grid; gap: 8px; }.group-grid, .model-grid { grid-template-columns: 1fr; }.panel-title { align-items: flex-start; flex-direction: column; }.channels-heading .button { width: 100%; } }
@media (max-width: 560px) { .channel-metrics { grid-template-columns: 1fr 1fr; }.channel-metrics div:nth-child(2) { border-right: 0; }.channel-metrics div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); }.channel-metrics div:first-child { padding-left: 19px; }.channel-toolbar { grid-template-columns: 1fr; }.search-field { grid-column: auto; }.group-panel, .model-panel { padding-inline: 13px; } }
</style>
