<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import adminPaymentAPI from '@shared-api/admin/payment'
import type { AdminPaymentConfig, UpdatePaymentConfigRequest } from '@shared-api/admin/payment'
import * as groupsAPI from '@shared-api/admin/groups'
import type { AdminGroup } from '@/types'
import type { PaymentChannel, ProviderInstance, SubscriptionPlan } from '@/types/payment'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import PaymentConfigPanel from '@/components/admin/commerce/PaymentConfigPanel.vue'
import PaymentChannelEditorDialog from '@/components/admin/commerce/PaymentChannelEditorDialog.vue'
import PaymentProviderEditorDialog from '@/components/admin/commerce/PaymentProviderEditorDialog.vue'
import PaymentPlanEditorDialog from '@/components/admin/commerce/PaymentPlanEditorDialog.vue'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { PaymentSetupTab, formatCurrency, paymentMethodLabels, PaymentMethod } from '@/features/admin/commerce/model'

const app = useAppStore()
const confirm = useConfirmStore()
const tab = ref<PaymentSetupTab>(PaymentSetupTab.CONFIG)
const config = ref<AdminPaymentConfig | null>(null)
const channels = ref<PaymentChannel[]>([])
const providers = ref<ProviderInstance[]>([])
const plans = ref<SubscriptionPlan[]>([])
const groups = ref<AdminGroup[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const channelOpen = ref(false)
const editingChannel = ref<PaymentChannel | null>(null)
const providerOpen = ref(false)
const editingProvider = ref<ProviderInstance | null>(null)
const planOpen = ref(false)
const editingPlan = ref<SubscriptionPlan | null>(null)

const enabledChannels = computed(() => channels.value.filter((item) => item.enabled).length)
const enabledProviders = computed(() => providers.value.filter((item) => item.enabled).length)
const salePlans = computed(() => plans.value.filter((item) => item.for_sale).length)

function normalizePlan(value: SubscriptionPlan & { features?: string | string[] }): SubscriptionPlan {
  return { ...value, features: typeof value.features === 'string' ? value.features.split('\n').map((item) => item.trim()).filter(Boolean) : value.features || [] }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [configResponse, channelResponse, providerResponse, planResponse, groupResponse] = await Promise.all([
      adminPaymentAPI.getConfig(), adminPaymentAPI.getChannels(), adminPaymentAPI.getProviders(), adminPaymentAPI.getPlans(), groupsAPI.getAllIncludingInactive()
    ])
    config.value = configResponse.data
    channels.value = channelResponse.data || []
    providers.value = providerResponse.data || []
    plans.value = (planResponse.data || []).map((item) => normalizePlan(item))
    groups.value = groupResponse
  } catch (caught) { error.value = (caught as { message?: string }).message || '支付配置加载失败' }
  finally { loading.value = false }
}

async function saveConfig(payload: UpdatePaymentConfigRequest): Promise<void> {
  saving.value = true
  try {
    const previousTypes = new Set(config.value?.enabled_payment_types || [])
    const nextTypes = new Set(payload.enabled_payment_types ?? config.value?.enabled_payment_types ?? [])
    const disabledTypes = [...previousTypes].filter((type) => !nextTypes.has(type))
    await adminPaymentAPI.updateConfig(payload)
    const providersToDisable = providers.value.filter((item) => item.enabled && disabledTypes.includes(item.provider_key))
    const disableResults = await Promise.allSettled(providersToDisable.map((item) => adminPaymentAPI.updateProvider(item.id, { enabled: false })))
    const failed = disableResults.filter((result) => result.status === 'rejected').length
    if (failed) app.showError(`支付配置已保存，但有 ${failed} 个已关闭支付方式的 Provider 停用失败，请在 Provider 列表重试。`)
    else app.showSuccess(providersToDisable.length ? `支付配置已保存，并停用 ${providersToDisable.length} 个关联 Provider` : '支付配置已保存')
    await load()
  }
  catch (caught) { app.showError((caught as { message?: string }).message || '配置保存失败') }
  finally { saving.value = false }
}

function createChannel(): void { editingChannel.value = null; channelOpen.value = true }
function editChannel(value: PaymentChannel): void { editingChannel.value = value; channelOpen.value = true }
async function saveChannel(payload: Partial<PaymentChannel>): Promise<void> { saving.value = true; try { if (editingChannel.value) await adminPaymentAPI.updateChannel(editingChannel.value.id, payload); else await adminPaymentAPI.createChannel(payload); app.showSuccess(editingChannel.value ? '支付渠道已更新' : '支付渠道已创建'); channelOpen.value = false; await load() } catch (caught) { app.showError((caught as { message?: string }).message || '渠道保存失败') } finally { saving.value = false } }
async function toggleChannel(value: PaymentChannel): Promise<void> { try { await adminPaymentAPI.updateChannel(value.id, { enabled: !value.enabled }); app.showSuccess(value.enabled ? '支付渠道已停用' : '支付渠道已启用'); await load() } catch (caught) { app.showError((caught as { message?: string }).message || '渠道状态更新失败') } }
async function deleteChannel(value: PaymentChannel): Promise<void> { if (!await confirm.ask({ title: '删除支付渠道', message: `删除“${value.name}”？依赖该渠道的用户购买展示会立即消失；后端依赖校验仍会阻止不安全删除。`, confirmText: '删除渠道', tone: ConfirmTone.DANGER })) return; try { await adminPaymentAPI.deleteChannel(value.id); app.showSuccess('支付渠道已删除'); await load() } catch (caught) { app.showError((caught as { message?: string }).message || '渠道存在依赖，无法删除') } }

function createProvider(): void { editingProvider.value = null; providerOpen.value = true }
function editProvider(value: ProviderInstance): void { editingProvider.value = value; providerOpen.value = true }
async function saveProvider(payload: Partial<ProviderInstance>): Promise<void> { saving.value = true; try { if (editingProvider.value) await adminPaymentAPI.updateProvider(editingProvider.value.id, payload); else await adminPaymentAPI.createProvider(payload); app.showSuccess(editingProvider.value ? 'Provider 已更新' : 'Provider 已创建'); providerOpen.value = false; await load() } catch (caught) { app.showError((caught as { message?: string }).message || 'Provider 保存失败') } finally { saving.value = false } }
async function toggleProvider(value: ProviderInstance): Promise<void> { try { await adminPaymentAPI.updateProvider(value.id, { enabled: !value.enabled }); app.showSuccess(value.enabled ? 'Provider 已停用' : 'Provider 已启用'); await load() } catch (caught) { app.showError((caught as { message?: string }).message || 'Provider 状态更新失败') } }
async function deleteProvider(value: ProviderInstance): Promise<void> { if (!await confirm.ask({ title: '删除 Provider', message: `删除“${value.name}”？支持 ${value.supported_types.join('、') || '未声明'}；关联订单与渠道存在时后端会拒绝。`, confirmText: '删除 Provider', tone: ConfirmTone.DANGER })) return; try { await adminPaymentAPI.deleteProvider(value.id); app.showSuccess('Provider 已删除'); await load() } catch (caught) { app.showError((caught as { message?: string }).message || 'Provider 存在依赖，无法删除') } }

function createPlan(): void { editingPlan.value = null; planOpen.value = true }
function editPlan(value: SubscriptionPlan): void { editingPlan.value = value; planOpen.value = true }
async function savePlan(payload: Record<string, unknown>): Promise<void> { saving.value = true; try { if (editingPlan.value) await adminPaymentAPI.updatePlan(editingPlan.value.id, payload); else await adminPaymentAPI.createPlan(payload); app.showSuccess(editingPlan.value ? '订阅计划已更新' : '订阅计划已创建'); planOpen.value = false; await load() } catch (caught) { app.showError((caught as { message?: string }).message || '计划保存失败') } finally { saving.value = false } }
async function togglePlan(value: SubscriptionPlan): Promise<void> { try { await adminPaymentAPI.updatePlan(value.id, { for_sale: !value.for_sale }); app.showSuccess(value.for_sale ? '计划已下架' : '计划已上架'); await load() } catch (caught) { app.showError((caught as { message?: string }).message || '计划状态更新失败') } }
async function deletePlan(value: SubscriptionPlan): Promise<void> { const group = groups.value.find((item) => item.id === value.group_id); if (!await confirm.ask({ title: '删除订阅计划', message: `删除“${value.name}”？绑定分组：${group?.name || `#${value.group_id}`}。历史订单仍保留计划 ID，存在销售依赖时后端会拒绝。`, confirmText: '删除计划', tone: ConfirmTone.DANGER })) return; try { await adminPaymentAPI.deletePlan(value.id); app.showSuccess('订阅计划已删除'); await load() } catch (caught) { app.showError((caught as { message?: string }).message || '计划存在依赖，无法删除') } }

function groupName(id: number): string { return groups.value.find((item) => item.id === id)?.name || `分组 #${id}` }
function methodLabel(value: string): string { return paymentMethodLabels[value as PaymentMethod] || value }

onMounted(load)
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Commerce Infrastructure</span><h1>计划与支付</h1><p>支付开关、交易边界、渠道、Provider 与订阅计划拆成四个专用工作区，避免把运行配置和销售商品混在一张表里。</p></div><button class="resource-button resource-button--secondary" :disabled="loading" @click="load">刷新全部</button></header>
      <section class="resource-summary"><div><span>支付总开关</span><strong>{{ config?.enabled ? '已启用' : '已停用' }}</strong></div><div><span>支付渠道</span><strong>{{ enabledChannels }} / {{ channels.length }}</strong></div><div><span>Provider</span><strong>{{ enabledProviders }} / {{ providers.length }}</strong></div><div><span>在售计划</span><strong>{{ salePlans }} / {{ plans.length }}</strong></div></section>
      <nav class="resource-tabs commerce-setup-tabs" aria-label="支付配置工作区"><button v-for="item in [{ key: PaymentSetupTab.CONFIG, label: '支付配置' }, { key: PaymentSetupTab.CHANNELS, label: '支付渠道' }, { key: PaymentSetupTab.PROVIDERS, label: 'Provider 实例' }, { key: PaymentSetupTab.PLANS, label: '订阅计划' }]" :key="item.key" :aria-selected="tab === item.key" @click="tab = item.key">{{ item.label }}</button></nav>
      <PageState :loading="loading" :error="error" @retry="load">
        <PaymentConfigPanel v-if="tab === PaymentSetupTab.CONFIG" :config="config" :saving="saving" @save="saveConfig" />
        <template v-else-if="tab === PaymentSetupTab.CHANNELS"><section class="commerce-section-heading"><div><h2>支付渠道</h2><p>面向用户的渠道能力、平台、模型与费率描述。</p></div><button class="resource-button" @click="createChannel">创建渠道</button></section><div class="resource-table"><table><thead><tr><th>ID / 渠道</th><th>平台与分组</th><th>费率</th><th>模型</th><th>功能</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-if="!channels.length"><td colspan="7">暂无支付渠道</td></tr><tr v-for="item in channels" :key="item.id"><td><strong>{{ item.name }}</strong><small>#{{ item.id }} · {{ item.description || '无描述' }}</small></td><td>{{ item.platform }}<small>{{ item.group_id ? groupName(item.group_id) : '未绑定分组' }}</small></td><td>{{ item.rate_multiplier }}x</td><td>{{ item.models.slice(0, 3).join('、') || '—' }}<small v-if="item.models.length > 3">另有 {{ item.models.length - 3 }} 个</small></td><td>{{ item.features.slice(0, 2).join('、') || '—' }}</td><td><button :class="['resource-status', item.enabled ? 'resource-status--active' : '']" @click="toggleChannel(item)">{{ item.enabled ? '启用' : '停用' }}</button></td><td><div class="resource-inline-actions"><button class="resource-link" @click="editChannel(item)">编辑</button><button class="resource-link resource-link--danger" @click="deleteChannel(item)">删除</button></div></td></tr></tbody></table></div></template>
        <template v-else-if="tab === PaymentSetupTab.PROVIDERS"><section class="commerce-section-heading"><div><h2>Provider 实例</h2><p>保存上游支付配置、支付模式、退款能力、限额与调度顺序。</p></div><button class="resource-button" @click="createProvider">创建 Provider</button></section><div class="resource-table"><table><thead><tr><th>实例</th><th>支持方式</th><th>支付模式</th><th>退款</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-if="!providers.length"><td colspan="7">暂无 Provider</td></tr><tr v-for="item in providers" :key="item.id"><td><strong>{{ item.name }}</strong><small>#{{ item.id }} · {{ item.provider_key }}</small></td><td>{{ item.supported_types.map(methodLabel).join('、') || '—' }}</td><td>{{ item.payment_mode }}<small>{{ item.limits || '无限额说明' }}</small></td><td>{{ item.refund_enabled ? '管理员可退款' : '不支持退款' }}<small>{{ item.allow_user_refund ? '用户可申请' : '用户不可申请' }}</small></td><td>{{ item.sort_order }}</td><td><button :class="['resource-status', item.enabled ? 'resource-status--active' : '']" @click="toggleProvider(item)">{{ item.enabled ? '启用' : '停用' }}</button></td><td><div class="resource-inline-actions"><button class="resource-link" @click="editProvider(item)">编辑</button><button class="resource-link resource-link--danger" @click="deleteProvider(item)">删除</button></div></td></tr></tbody></table></div></template>
        <template v-else><section class="commerce-section-heading"><div><h2>订阅计划</h2><p>销售名称、价格、有效期与分组权益的映射。</p></div><button class="resource-button" @click="createPlan">创建计划</button></section><div class="resource-table"><table><thead><tr><th>ID / 计划</th><th>订阅分组</th><th>价格</th><th>有效期</th><th>卖点</th><th>排序</th><th>销售状态</th><th>操作</th></tr></thead><tbody><tr v-if="!plans.length"><td colspan="8">暂无订阅计划</td></tr><tr v-for="item in plans" :key="item.id"><td><strong>{{ item.name }}</strong><small>#{{ item.id }} · {{ item.description }}</small></td><td>{{ groupName(item.group_id) }}<small>{{ item.group_platform || groups.find(group => group.id === item.group_id)?.platform || '—' }}</small></td><td><strong>{{ formatCurrency(item.price, item.currency || 'USD') }}</strong><small v-if="item.original_price">原价 {{ formatCurrency(item.original_price, item.currency || 'USD') }}</small></td><td>{{ item.validity_days }} {{ item.validity_unit || 'days' }}</td><td>{{ item.features.slice(0, 2).join('、') || '—' }}<small v-if="item.features.length > 2">另有 {{ item.features.length - 2 }} 项</small></td><td>{{ item.sort_order }}</td><td><button :class="['resource-status', item.for_sale ? 'resource-status--active' : '']" @click="togglePlan(item)">{{ item.for_sale ? '在售' : '下架' }}</button></td><td><div class="resource-inline-actions"><button class="resource-link" @click="editPlan(item)">编辑</button><button class="resource-link resource-link--danger" @click="deletePlan(item)">删除</button></div></td></tr></tbody></table></div></template>
      </PageState>
    </main>
    <PaymentChannelEditorDialog :show="channelOpen" :channel="editingChannel" :saving="saving" @close="channelOpen = false" @submit="saveChannel" />
    <PaymentProviderEditorDialog :show="providerOpen" :provider="editingProvider" :saving="saving" :enabled-payment-types="config?.enabled_payment_types || []" @close="providerOpen = false" @submit="saveProvider" />
    <PaymentPlanEditorDialog :show="planOpen" :plan="editingPlan" :groups="groups" :config="config" :saving="saving" @close="planOpen = false" @submit="savePlan" />
  </ConsoleShell>
</template>

<style scoped>
.commerce-setup-tabs { padding: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }
.commerce-section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
.commerce-section-heading h2 { margin: 0; font-size: 22px; letter-spacing: -.03em; }
.commerce-section-heading p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-body-sm); }
@media (max-width: 700px) { .commerce-section-heading { align-items: stretch; flex-direction: column; } }
</style>
