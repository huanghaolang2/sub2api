<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import * as userAPI from '@shared-api/user'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import { formatDateTime, formatMoney } from '@/features/user/billing/model'
import type { UserAffiliateDetail } from '@/types'
import { useAuthStore } from '@/stores/auth'

interface RequestError { response?: { data?: { detail?: string } }; message?: string }

const auth = useAuthStore()
const detail = ref<UserAffiliateDetail | null>(null)
const loading = ref(true)
const error = ref('')
const transferring = ref(false)
const feedback = ref('')
let feedbackTimer: number | null = null

const inviteLink = computed(() => detail.value
  ? `${window.location.origin}/register?aff=${encodeURIComponent(detail.value.aff_code)}`
  : '')
const rebateRate = computed(() => {
  const value = Math.round(Number(detail.value?.effective_rebate_rate_percent || 0) * 100) / 100
  return `${value}%`
})

function requestError(caught: unknown, fallback: string): string {
  const value = caught as RequestError
  return value.response?.data?.detail || value.message || fallback
}

function showFeedback(message: string): void {
  feedback.value = message
  if (feedbackTimer != null) window.clearTimeout(feedbackTimer)
  feedbackTimer = window.setTimeout(() => { feedback.value = '' }, 3200)
}

async function load(silent: boolean = false): Promise<void> {
  if (!silent) loading.value = true
  error.value = ''
  try {
    detail.value = await userAPI.getAffiliateDetail()
  } catch (caught) {
    error.value = requestError(caught, '邀请返利数据加载失败')
  } finally {
    if (!silent) loading.value = false
  }
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    showFeedback(`${label}已复制`)
  } catch {
    error.value = `${label}复制失败，请手动选择复制。`
  }
}

async function transfer(): Promise<void> {
  if (!detail.value || detail.value.aff_quota <= 0 || transferring.value) return
  transferring.value = true
  error.value = ''
  try {
    const response = await userAPI.transferAffiliateQuota()
    showFeedback(`已将 ${formatMoney(response.transferred_quota)} 返利转入账户余额`)
    await Promise.allSettled([load(true), auth.refreshUser()])
  } catch (caught) {
    error.value = requestError(caught, '返利转入失败')
  } finally {
    transferring.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <ConsoleShell>
    <div class="affiliate-page">
      <header class="affiliate-heading"><div><p>账务与权益 / 邀请返利</p><h1>邀请与返利</h1><span>分享专属链接，查看受邀用户和累计返利，并将可用返利转入余额。</span></div></header>
      <p v-if="feedback" class="affiliate-feedback" role="status">{{ feedback }}</p>
      <p v-if="error && detail" class="affiliate-feedback is-error" role="alert">{{ error }}</p>

      <PageState :loading="loading" :error="detail ? '' : error" @retry="load()">
        <template v-if="detail">
          <section class="affiliate-metrics" aria-label="返利摘要">
            <div><span>当前返利比例</span><strong>{{ rebateRate }}</strong><small>后台实际生效比例</small></div>
            <div><span>已邀请用户</span><strong>{{ detail.aff_count.toLocaleString() }}</strong><small>成功注册账户</small></div>
            <div><span>可转入返利</span><strong>{{ formatMoney(detail.aff_quota) }}</strong><small>当前可用</small></div>
            <div><span>累计返利</span><strong>{{ formatMoney(detail.aff_history_quota) }}</strong><small v-if="detail.aff_frozen_quota">冻结 {{ formatMoney(detail.aff_frozen_quota) }}</small><small v-else>无冻结返利</small></div>
          </section>

          <section class="invite-card">
            <header><div><span>专属邀请资产</span><h2>分享给新用户</h2></div><button class="button button--primary" :disabled="transferring || detail.aff_quota <= 0" @click="transfer">{{ transferring ? '转入中…' : '返利转入余额' }}</button></header>
            <div class="invite-values">
              <label><span>邀请码</span><div><code>{{ detail.aff_code }}</code><button type="button" @click="copy(detail.aff_code, '邀请码')">复制</button></div></label>
              <label><span>邀请链接</span><div><code>{{ inviteLink }}</code><button type="button" @click="copy(inviteLink, '邀请链接')">复制</button></div></label>
            </div>
            <ol><li>受邀用户通过链接或邀请码完成注册。</li><li>其符合规则的消费按 {{ rebateRate }} 形成返利。</li><li>可用返利可一次性转入 API 余额；冻结部分暂不可转出。</li></ol>
          </section>

          <section class="invitees-panel">
            <header><div><span>受邀用户</span><strong>{{ detail.invitees.length }}</strong></div></header>
            <div v-if="detail.invitees.length" class="invitees-table"><table><thead><tr><th>用户</th><th>邮箱</th><th>加入时间</th><th>贡献返利</th></tr></thead><tbody><tr v-for="item in detail.invitees" :key="item.user_id"><td><strong>{{ item.username || `用户 #${item.user_id}` }}</strong><small>#{{ item.user_id }}</small></td><td>{{ item.email || '—' }}</td><td>{{ formatDateTime(item.created_at) }}</td><td><strong class="money">{{ formatMoney(item.total_rebate) }}</strong></td></tr></tbody></table></div>
            <div v-else class="invitees-empty"><strong>还没有受邀用户</strong><span>复制上方链接开始邀请。</span></div>
          </section>
        </template>
      </PageState>
    </div>
  </ConsoleShell>
</template>

<style scoped>
.affiliate-page { width: min(1420px, 100%); margin: 0 auto; padding-bottom: 52px; }.affiliate-heading p { margin: 0 0 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }.affiliate-heading h1 { font-size: clamp(40px, 5vw, 64px); }.affiliate-heading span { margin-top: 12px; display: block; color: var(--text-secondary); font-size: var(--font-body-sm); }.affiliate-feedback { margin: 16px 0 0; padding: 10px 12px; color: var(--success); background: color-mix(in srgb, var(--success) 8%, transparent); border-left: 3px solid currentColor; font-size: var(--font-meta); }.affiliate-feedback.is-error { color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }
.affiliate-metrics { margin: 27px 0 15px; display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--border-subtle); }.affiliate-metrics div { min-width: 0; padding: 18px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); }.affiliate-metrics div:first-child { padding-left: 0; }.affiliate-metrics div:last-child { border-right: 0; }.affiliate-metrics span, .affiliate-metrics small { overflow: hidden; color: var(--text-secondary); font-size: var(--font-meta); text-overflow: ellipsis; white-space: nowrap; }.affiliate-metrics strong { overflow: hidden; font-size: 23px; text-overflow: ellipsis; white-space: nowrap; }
.invite-card, .invitees-panel { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }.invite-card > header { padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border-subtle); }.invite-card header span { color: var(--text-secondary); font-size: var(--font-meta); }.invite-card h2 { margin: 5px 0 0; font-size: 16px; }.invite-card .button { min-height: 40px; font-size: var(--font-meta); }.invite-values { padding: 18px 20px; display: grid; grid-template-columns: .65fr 1.35fr; gap: 10px; }.invite-values label { min-width: 0; display: grid; gap: 6px; }.invite-values label > span { color: var(--text-secondary); font-size: var(--font-meta); }.invite-values label > div { min-width: 0; min-height: 43px; padding: 0 7px 0 11px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 7px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.invite-values code { overflow: hidden; font-size: var(--font-meta); text-overflow: ellipsis; white-space: nowrap; }.invite-values button { min-height: 29px; padding: 0 8px; color: var(--accent); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 6px; cursor: pointer; font-size: var(--font-meta); }.invite-card ol { margin: 0; padding: 14px 20px 17px 36px; color: var(--text-secondary); background: var(--surface-canvas); border-top: 1px solid var(--border-subtle); font-size: var(--font-meta); line-height: 1.8; }
.invitees-panel { margin-top: 14px; }.invitees-panel > header { min-height: 64px; padding: 14px 18px; display: flex; align-items: center; border-bottom: 1px solid var(--border-subtle); }.invitees-panel header div { display: flex; align-items: baseline; gap: 8px; }.invitees-panel header span { color: var(--text-secondary); font-size: var(--font-meta); }.invitees-panel header strong { font-size: 17px; }.invitees-table { overflow: auto; }.invitees-table table { width: 100%; min-width: 720px; border-collapse: collapse; }.invitees-table th, .invitees-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-meta); }.invitees-table th { color: var(--text-secondary); background: var(--surface-canvas); font-size: var(--font-caption); letter-spacing: .06em; text-transform: uppercase; }.invitees-table tbody tr:last-child td { border-bottom: 0; }.invitees-table td strong, .invitees-table td small { display: block; }.invitees-table td small { margin-top: 3px; color: var(--text-secondary); font-size: var(--font-caption); }.invitees-table .money { color: var(--success); }.invitees-empty { min-height: 180px; display: grid; place-content: center; justify-items: center; gap: 5px; color: var(--text-secondary); }.invitees-empty strong { color: var(--text-primary); font-size: var(--font-body-sm); }.invitees-empty span { font-size: var(--font-meta); }
@media (max-width: 760px) { .affiliate-metrics { grid-template-columns: repeat(2, 1fr); }.affiliate-metrics div:nth-child(2) { border-right: 0; }.affiliate-metrics div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); }.affiliate-metrics div:first-child { padding-left: 18px; }.invite-card > header { align-items: stretch; flex-direction: column; }.invite-values { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .affiliate-metrics { grid-template-columns: 1fr; }.affiliate-metrics div { border-right: 0; border-bottom: 1px solid var(--border-subtle); } }
</style>
