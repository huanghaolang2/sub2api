<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as channelsAPI from '@shared-api/admin/channels'
import * as groupsAPI from '@shared-api/admin/groups'
import type { Channel, CreateChannelRequest, UpdateChannelRequest } from '@shared-api/admin/channels'
import type { AdminGroup } from '@/types'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import ChannelEditorDialog from '@/components/admin/channels/ChannelEditorDialog.vue'
import { SortDirection, formatResourceDate } from '@/features/admin/resources/model'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'

const app = useAppStore(); const confirm = useConfirmStore()
const channels = ref<Channel[]>([]); const allChannels = ref<Channel[]>([]); const groups = ref<AdminGroup[]>([])
const total = ref(0); const page = ref(1); const pageSize = ref(20); const loading = ref(true); const error = ref('')
const filters = reactive({ search: '', status: '' }); const sort = reactive({ by: 'created_at', order: SortDirection.DESC })
const showEditor = ref(false); const editing = ref<Channel | null>(null); const submitting = ref(false)
let controller: AbortController | null = null; let timer: number | null = null
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const active = computed(() => channels.value.filter((item) => item.status === 'active').length)
const boundGroups = computed(() => new Set(channels.value.flatMap((item) => item.group_ids)).size)
const pricingRules = computed(() => channels.value.reduce((sum, item) => sum + item.model_pricing.length, 0))

async function loadReferences(): Promise<void> {
  const [groupResult, channelResult] = await Promise.allSettled([groupsAPI.getAllIncludingInactive(), channelsAPI.list(1, 1000)])
  if (groupResult.status === 'fulfilled') groups.value = groupResult.value
  if (channelResult.status === 'fulfilled') allChannels.value = channelResult.value.items
}
async function load(): Promise<void> {
  controller?.abort(); controller = new AbortController(); const current = controller; loading.value = true; error.value = ''
  try { const response = await channelsAPI.list(page.value, pageSize.value, { search: filters.search.trim() || undefined, status: filters.status || undefined, sort_by: sort.by, sort_order: sort.order }, { signal: current.signal }); channels.value = response.items; total.value = response.total; void loadReferences() }
  catch (caught) { if ((caught as { code?: string }).code !== 'ERR_CANCELED') error.value = (caught as { message?: string }).message || '渠道加载失败' }
  finally { if (controller === current) loading.value = false }
}
function searchLater(): void { if (timer) window.clearTimeout(timer); timer = window.setTimeout(() => { page.value = 1; void load() }, 280) }
function filter(): void { page.value = 1; void load() }
function setSort(by: string): void {
  if (sort.by === by) sort.order = sort.order === SortDirection.ASC ? SortDirection.DESC : SortDirection.ASC
  else { sort.by = by; sort.order = SortDirection.ASC }
  void load()
}
function create(): void { editing.value = null; showEditor.value = true }
async function edit(channel: Channel): Promise<void> {
  try {
    editing.value = await channelsAPI.getById(channel.id)
    showEditor.value = true
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '渠道详情加载失败')
  }
}
async function save(payload: CreateChannelRequest | UpdateChannelRequest): Promise<void> { if (submitting.value) return; submitting.value = true; try { if (editing.value) await channelsAPI.update(editing.value.id, payload as UpdateChannelRequest); else await channelsAPI.create(payload as CreateChannelRequest); app.showSuccess(editing.value ? '渠道已更新' : '渠道已创建'); showEditor.value = false; await load() } catch (caught) { app.showError((caught as { message?: string }).message || '渠道保存失败') } finally { submitting.value = false } }
async function toggle(channel: Channel): Promise<void> { const next = channel.status === 'active' ? 'disabled' : 'active'; if (next === 'disabled' && !await confirm.ask({ title: '停用渠道', message: `停用 ${channel.name} 后，绑定分组不会再按此渠道规则计价。`, confirmText: '停用', tone: ConfirmTone.DANGER })) return; try { await channelsAPI.update(channel.id, { status: next }); app.showSuccess(next === 'active' ? '渠道已启用' : '渠道已停用'); await load() } catch (caught) { app.showError((caught as { message?: string }).message || '状态更新失败') } }
async function remove(channel: Channel): Promise<void> { if (!await confirm.ask({ title: '删除渠道', message: `确认永久删除 ${channel.name}？`, confirmText: '删除', tone: ConfirmTone.DANGER })) return; try { await channelsAPI.remove(channel.id); app.showSuccess('渠道已删除'); await load() } catch (caught) { app.showError((caught as { message?: string }).message || '删除失败') } }
onMounted(load); onBeforeUnmount(() => { controller?.abort(); if (timer) window.clearTimeout(timer) })
</script>

<template><ConsoleShell><main class="resource-page"><header class="resource-page__heading"><div><span class="resource-eyebrow">Pricing Orchestration</span><h1>渠道与价格</h1><p>把分组组织为渠道，统一管理模型白名单、映射、计费来源、阶梯价格与账号统计成本。</p></div><button class="resource-button" @click="create">创建渠道</button></header>
  <section class="resource-summary"><div><span>当前页 / 总数</span><strong>{{ channels.length }} / {{ total }}</strong></div><div><span>当前页启用</span><strong>{{ active }}</strong></div><div><span>绑定分组</span><strong>{{ boundGroups }}</strong></div><div><span>模型价格组</span><strong>{{ pricingRules }}</strong></div></section>
  <section class="resource-toolbar"><div class="resource-toolbar__filters"><input v-model="filters.search" type="search" placeholder="搜索渠道名称或描述" @input="searchLater" /><select v-model="filters.status" @change="filter"><option value="">全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" @click="load">刷新</button></div></section>
  <PageState :loading="loading" :error="error" :empty="!loading && !error && channels.length === 0" empty-text="没有匹配的渠道。" @retry="load"><div class="resource-table"><table><thead><tr><th @click="setSort('name')">渠道 ↕</th><th>状态</th><th>分组</th><th>价格</th><th>计费模型</th><th>能力</th><th @click="setSort('created_at')">创建时间 ↕</th><th>操作</th></tr></thead><tbody><tr v-for="channel in channels" :key="channel.id"><td><strong>{{ channel.name }}</strong><small>#{{ channel.id }} · {{ channel.description || '无描述' }}</small></td><td><button :class="['resource-status', `resource-status--${channel.status}`]" @click="toggle(channel)">{{ channel.status === 'active' ? '启用' : '停用' }}</button></td><td>{{ channel.group_ids.length }} 个<small>{{ channel.group_ids.slice(0, 3).map(id => groups.find(group => group.id === id)?.name || `#${id}`).join('、') }}</small></td><td>{{ channel.model_pricing.length }} 组<small>{{ channel.account_stats_pricing_rules.length }} 条统计规则</small></td><td>{{ channel.billing_model_source }}<small>{{ channel.restrict_models ? '限制未定价模型' : '允许未定价模型' }}</small></td><td><span v-for="key in Object.keys(channel.features_config || {}).slice(0, 3)" :key="key" class="feature-pill">{{ key }}</span><small v-if="Object.keys(channel.features_config || {}).length === 0">无扩展能力</small></td><td>{{ formatResourceDate(channel.created_at) }}</td><td><div class="resource-inline-actions"><button class="resource-link" @click="edit(channel)">编辑</button><button class="resource-link resource-link--danger" @click="remove(channel)">删除</button></div></td></tr></tbody></table></div></PageState>
  <footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; load()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option><option :value="100">100 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; load()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; load()">下一页</button></div></footer>
  </main><ChannelEditorDialog :show="showEditor" :channel="editing" :groups="groups" :channels="allChannels" :submitting="submitting" @close="showEditor = false" @submit="save" /></ConsoleShell></template>

<style scoped>.feature-pill { margin: 2px; padding: 3px 6px; display: inline-block; color: var(--accent); background: var(--accent-soft); border-radius: 6px; font-size: var(--font-meta); }</style>
