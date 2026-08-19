<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as auditAPI from '@shared-api/admin/audit'
import type { AuditLog, AuditLogQuery } from '@shared-api/admin/audit'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { AuditSuccessFilter, downloadCSV, formatGovernanceDate } from '@/features/admin/governance/model'

const app = useAppStore()
const confirm = useConfirmStore()
const rows = ref<AuditLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const error = ref('')
const detail = ref<AuditLog | null>(null)
const detailOpen = ref(false)
const detailLoading = ref(false)
const clearOpen = ref(false)
const clearCode = ref('')
const clearing = ref(false)
const exporting = ref(false)
const filters = reactive({ q: '', actorEmail: '', action: '', clientIp: '', method: '', authMethod: '', success: AuditSuccessFilter.ALL, startTime: '', endTime: '' })
let controller: AbortController | null = null

const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const failedCount = computed(() => rows.value.filter((item) => item.status_code >= 400).length)

function query(overrides: AuditLogQuery = {}): AuditLogQuery {
  return {
    page: page.value, page_size: pageSize.value,
    q: filters.q.trim() || undefined, actor_email: filters.actorEmail.trim() || undefined,
    action: filters.action.trim() || undefined, client_ip: filters.clientIp.trim() || undefined,
    method: filters.method || undefined, auth_method: filters.authMethod || undefined,
    success: filters.success || undefined,
    start_time: filters.startTime ? new Date(filters.startTime).toISOString() : undefined,
    end_time: filters.endTime ? new Date(filters.endTime).toISOString() : undefined,
    ...overrides,
  }
}

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  loading.value = true; error.value = ''
  try { const response = await auditAPI.list(query()); rows.value = response.items || []; total.value = response.total || 0 }
  catch (caught) { if ((caught as { code?: string }).code !== 'ERR_CANCELED') error.value = (caught as { message?: string }).message || '审计日志加载失败' }
  finally { loading.value = false }
}

function search(): void { page.value = 1; void load() }
function resetFilters(): void { Object.assign(filters, { q: '', actorEmail: '', action: '', clientIp: '', method: '', authMethod: '', success: AuditSuccessFilter.ALL, startTime: '', endTime: '' }); search() }
async function openDetail(id: number): Promise<void> {
  detailOpen.value = true; detailLoading.value = true; detail.value = null
  try { detail.value = await auditAPI.get(id) }
  catch (caught) { app.showError((caught as { message?: string }).message || '审计详情加载失败'); detailOpen.value = false }
  finally { detailLoading.value = false }
}

async function requestClear(): Promise<void> {
  if (!await confirm.ask({ title: '清空操作审计', message: '该操作不可撤销，且必须使用当前管理员的 6 位 TOTP 再次验证。', confirmText: '继续验证', tone: ConfirmTone.DANGER })) return
  clearCode.value = ''; clearOpen.value = true
}

async function clearAll(): Promise<void> {
  if (!/^\d{6}$/.test(clearCode.value)) { app.showError('请输入 6 位 TOTP 验证码'); return }
  clearing.value = true
  try { const result = await auditAPI.clear(clearCode.value); clearOpen.value = false; app.showSuccess(`已清理 ${result.deleted} 条审计日志`); await load() }
  catch (caught) { clearCode.value = ''; app.showError((caught as { message?: string }).message || '审计日志清理失败') }
  finally { clearing.value = false }
}

async function exportAll(): Promise<void> {
  exporting.value = true
  try {
    const items: AuditLog[] = []
    let nextPage = 1
    let expected = total.value
    do {
      const response = await auditAPI.list(query({ page: nextPage, page_size: 100 }))
      items.push(...(response.items || [])); expected = response.total || expected; nextPage += 1
      if (!response.items?.length) break
    } while (items.length < expected)
    downloadCSV(`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, ['时间', '操作者', '角色', '认证', '动作', '方法', '路径', '状态', '耗时ms', 'IP', '请求ID'], items.map((item) => [item.created_at, item.actor_email, item.actor_role, item.auth_method, item.action, item.method, item.path, item.status_code, item.latency_ms, item.client_ip, item.request_id]))
    app.showSuccess(`已导出 ${items.length} 条审计记录`)
  } catch (caught) { app.showError((caught as { message?: string }).message || '导出失败') }
  finally { exporting.value = false }
}

onMounted(load)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Immutable Trace</span><h1>操作审计</h1><p>以操作者、凭据来源、动作、请求路径和结果还原每一次管理面操作；敏感内容由后端脱敏。</p></div><div class="resource-toolbar__actions"><button class="resource-button resource-button--secondary" :disabled="exporting" @click="exportAll">{{ exporting ? '导出中…' : '导出筛选结果' }}</button><button class="resource-button resource-button--danger" @click="requestClear">清空日志</button></div></header>
      <section class="resource-summary"><div><span>筛选结果</span><strong>{{ total }}</strong></div><div><span>当前页失败</span><strong>{{ failedCount }}</strong></div><div><span>当前页成功</span><strong>{{ rows.length - failedCount }}</strong></div><div><span>平均耗时</span><strong>{{ rows.length ? Math.round(rows.reduce((sum, item) => sum + item.latency_ms, 0) / rows.length) : 0 }} ms</strong></div></section>
      <section class="governance-card"><header class="governance-card__header"><div><h2>筛选条件</h2><p>文本条件回车即可查询；时间使用本地时区并转换为 ISO。</p></div><div class="resource-inline-actions"><button class="resource-button resource-button--secondary" @click="resetFilters">重置</button><button class="resource-button" @click="search">查询</button></div></header><div class="resource-form-grid resource-form-grid--4"><label>关键词<input v-model="filters.q" placeholder="动作、路径、请求 ID" @keyup.enter="search" /></label><label>操作者邮箱<input v-model="filters.actorEmail" @keyup.enter="search" /></label><label>动作<input v-model="filters.action" @keyup.enter="search" /></label><label>客户端 IP<input v-model="filters.clientIp" @keyup.enter="search" /></label><label>HTTP 方法<select v-model="filters.method" @change="search"><option value="">全部</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label><label>认证方式<select v-model="filters.authMethod" @change="search"><option value="">全部</option><option value="session">会话</option><option value="admin_api_key">管理员 API Key</option><option value="bearer">Bearer</option></select></label><label>结果<select v-model="filters.success" @change="search"><option :value="AuditSuccessFilter.ALL">全部</option><option :value="AuditSuccessFilter.SUCCESS">成功</option><option :value="AuditSuccessFilter.FAILED">失败</option></select></label><span></span><label>开始时间<input v-model="filters.startTime" type="datetime-local" /></label><label>结束时间<input v-model="filters.endTime" type="datetime-local" /></label></div></section>
      <PageState :loading="loading" :error="error" :empty="!loading && !error && !rows.length" empty-text="当前筛选范围没有审计记录。" @retry="load"><div class="resource-table"><table><thead><tr><th>时间</th><th>操作者</th><th>动作 / 路径</th><th>结果</th><th>耗时</th><th>来源 IP</th><th>操作</th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td>{{ formatGovernanceDate(item.created_at) }}</td><td><strong>{{ item.actor_email || '—' }}</strong><small>{{ item.actor_role }} · {{ item.auth_method }} · {{ item.credential_masked || '无凭据摘要' }}</small></td><td><code>{{ item.action }}</code><small>{{ item.method }} {{ item.path }}</small></td><td><span :class="['resource-status', item.status_code < 400 ? 'resource-status--active' : 'resource-status--error']">{{ item.status_code }}</span></td><td>{{ item.latency_ms }} ms</td><td><code>{{ item.client_ip || '—' }}</code></td><td><button class="resource-link" @click="openDetail(item.id)">查看详情</button></td></tr></tbody></table></div></PageState>
      <footer class="resource-pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span><div class="resource-pagination__actions"><select v-model.number="pageSize" @change="page = 1; load()"><option :value="20">20 / 页</option><option :value="50">50 / 页</option><option :value="100">100 / 页</option></select><button class="resource-button resource-button--secondary" :disabled="page <= 1" @click="page--; load()">上一页</button><button class="resource-button resource-button--secondary" :disabled="page >= pages" @click="page++; load()">下一页</button></div></footer>
    </main>

    <SurfaceDialog :show="detailOpen" title="审计事件详情" description="请求体、扩展数据和凭据摘要均按后端脱敏结果展示。" :width="DialogWidth.WIDE" @close="detailOpen = false"><div v-if="detailLoading" class="page-state">正在加载详情…</div><template v-else-if="detail"><dl class="governance-detail"><dt>动作</dt><dd>{{ detail.action }}</dd><dt>请求</dt><dd><code>{{ detail.method }} {{ detail.path }}</code></dd><dt>结果</dt><dd>{{ detail.status_code }} · {{ detail.latency_ms }} ms</dd><dt>操作者</dt><dd>{{ detail.actor_email }} · {{ detail.actor_role }}</dd><dt>认证</dt><dd>{{ detail.auth_method }} · {{ detail.credential_masked }}</dd><dt>来源</dt><dd>{{ detail.client_ip }} · {{ detail.user_agent }}</dd><dt>请求 ID</dt><dd><code>{{ detail.request_id }}</code></dd><dt>时间</dt><dd>{{ formatGovernanceDate(detail.created_at) }}</dd></dl><h3>脱敏请求体</h3><pre class="resource-code">{{ detail.request_body || '无' }}</pre><h3>扩展数据</h3><pre class="resource-code">{{ JSON.stringify(detail.extra || {}, null, 2) }}</pre></template></SurfaceDialog>
    <SurfaceDialog :show="clearOpen" title="TOTP 二次验证" description="清空全部审计日志不可撤销。验证码仅用于本次操作。" :width="DialogWidth.COMPACT" @close="clearOpen = false"><form id="audit-clear-form" class="resource-form-stack" @submit.prevent="clearAll"><label>6 位 TOTP 验证码<input v-model.trim="clearCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" autofocus /></label></form><template #footer><button class="button button--secondary" @click="clearOpen = false">取消</button><button type="submit" form="audit-clear-form" class="button resource-button--danger" :disabled="clearing || clearCode.length !== 6">{{ clearing ? '清理中…' : '确认清空' }}</button></template></SurfaceDialog>
  </ConsoleShell>
</template>
