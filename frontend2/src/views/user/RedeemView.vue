<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import * as authAPI from '@shared-api/auth'
import * as redeemAPI from '@shared-api/redeem'
import { useSubscriptionStore } from '@shared-stores/subscriptions'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import { formatDateTime, formatMoney } from '@/features/user/billing/model'
import type { RedeemHistoryItem } from '@shared-api/redeem'
import { useAuthStore } from '@/stores/auth'

interface RequestError { response?: { data?: { detail?: string } }; message?: string }
interface RedeemResult {
  message: string
  type: string
  value: number
  new_balance?: number
  new_concurrency?: number
  group_name?: string
  validity_days?: number
}

const auth = useAuthStore()
const subscriptionStore = useSubscriptionStore()
const redeemCode = ref('')
const submitting = ref(false)
const result = ref<RedeemResult | null>(null)
const error = ref('')
const history = ref<RedeemHistoryItem[]>([])
const historyLoading = ref(true)
const historyError = ref('')
const contactInfo = ref('')

const balance = computed(() => Number(auth.user?.balance || 0))
const concurrency = computed(() => Number(auth.user?.concurrency || 0))

function requestError(caught: unknown, fallback: string): string {
  const value = caught as RequestError
  return value.response?.data?.detail || value.message || fallback
}

function isBalanceType(type: string): boolean {
  return type === 'balance' || type === 'admin_balance'
}

function isSubscriptionType(type: string): boolean {
  return type === 'subscription'
}

function isAdminAdjustment(type: string): boolean {
  return type === 'admin_balance' || type === 'admin_concurrency'
}

function historyTitle(item: RedeemHistoryItem): string {
  if (item.type === 'balance') return '兑换余额'
  if (item.type === 'admin_balance') return item.value >= 0 ? '管理员增加余额' : '管理员扣减余额'
  if (item.type === 'concurrency') return '兑换并发额度'
  if (item.type === 'admin_concurrency') return item.value >= 0 ? '管理员增加并发' : '管理员减少并发'
  if (item.type === 'subscription') return '兑换订阅权益'
  return item.type || '未知记录'
}

function historyValue(item: RedeemHistoryItem): string {
  const sign = item.value >= 0 ? '+' : ''
  if (isBalanceType(item.type)) return `${sign}${formatMoney(item.value)}`
  if (isSubscriptionType(item.type)) {
    const days = item.validity_days || Math.round(item.value)
    return `${days} 天${item.group?.name ? ` · ${item.group.name}` : ''}`
  }
  return `${sign}${item.value} 并发`
}

async function loadHistory(): Promise<void> {
  historyLoading.value = true
  historyError.value = ''
  try {
    history.value = await redeemAPI.getHistory()
  } catch (caught) {
    historyError.value = requestError(caught, '兑换记录加载失败')
  } finally {
    historyLoading.value = false
  }
}

async function redeem(): Promise<void> {
  const code = redeemCode.value.trim()
  if (!code || submitting.value) return
  submitting.value = true
  result.value = null
  error.value = ''
  try {
    result.value = await redeemAPI.redeem(code) as RedeemResult
    redeemCode.value = ''
    const refreshes: Promise<unknown>[] = [auth.refreshUser(), loadHistory()]
    if (result.value.type === 'subscription') refreshes.push(subscriptionStore.fetchActiveSubscriptions(true))
    await Promise.allSettled(refreshes)
  } catch (caught) {
    error.value = requestError(caught, '兑换失败，请检查兑换码后重试')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  void loadHistory()
  void authAPI.getPublicSettings().then((settings) => { contactInfo.value = settings.contact_info || '' }).catch(() => undefined)
})
</script>

<template>
  <ConsoleShell>
    <div class="redeem-page">
      <header class="redeem-heading">
        <div><p>账务与权益 / 兑换码</p><h1>兑换权益</h1><span>余额、并发和订阅兑换均使用同一个入口；成功后立即刷新账户与记录。</span></div>
        <RouterLink class="button button--secondary" to="/app/subscriptions">查看订阅</RouterLink>
      </header>

      <section class="redeem-layout">
        <div class="redeem-main">
          <section class="account-balance">
            <div><span>当前可用余额</span><strong>{{ formatMoney(balance) }}</strong></div>
            <div><span>并发额度</span><strong>{{ concurrency.toLocaleString() }}</strong><small>并发请求</small></div>
          </section>

          <form class="redeem-form" @submit.prevent="redeem">
            <label for="redeem-code">兑换码</label>
            <div><input id="redeem-code" v-model="redeemCode" required autocomplete="off" placeholder="输入完整兑换码" :disabled="submitting"><button class="button button--primary" :disabled="submitting || !redeemCode.trim()">{{ submitting ? '兑换中…' : '立即兑换' }}</button></div>
            <small>兑换码只能使用一次；提交前后不会展示或记录额外敏感信息。</small>
          </form>

          <section v-if="result" class="redeem-feedback is-success" role="status">
            <strong>兑换成功</strong><p>{{ result.message }}</p>
            <dl>
              <div v-if="result.type === 'balance'"><dt>增加余额</dt><dd>{{ formatMoney(result.value) }}</dd></div>
              <div v-else-if="result.type === 'concurrency'"><dt>增加并发</dt><dd>{{ result.value }}</dd></div>
              <div v-else-if="result.type === 'subscription'"><dt>订阅权益</dt><dd>{{ result.group_name || '已发放' }}{{ result.validity_days ? ` · ${result.validity_days} 天` : '' }}</dd></div>
              <div v-if="result.new_balance != null"><dt>最新余额</dt><dd>{{ formatMoney(result.new_balance) }}</dd></div>
              <div v-if="result.new_concurrency != null"><dt>最新并发</dt><dd>{{ result.new_concurrency }}</dd></div>
            </dl>
          </section>
          <section v-if="error" class="redeem-feedback is-error" role="alert"><strong>兑换未完成</strong><p>{{ error }}</p></section>

          <section class="redeem-guidance">
            <strong>兑换说明</strong>
            <ul><li>余额兑换会增加 API 可用余额。</li><li>并发兑换会更新账户并发配置。</li><li>订阅兑换会发放指定分组及有效期。</li><li>如兑换码来源或结果有疑问，请联系 {{ contactInfo || '平台管理员' }}。</li></ul>
          </section>
        </div>

        <aside class="history-panel">
          <header><div><span>最近活动</span><strong>{{ history.length }}</strong></div><button type="button" :disabled="historyLoading" @click="loadHistory">刷新</button></header>
          <div v-if="historyLoading" class="history-state">正在加载兑换记录…</div>
          <div v-else-if="historyError" class="history-state is-error"><strong>记录加载失败</strong><span>{{ historyError }}</span><button type="button" @click="loadHistory">重试</button></div>
          <div v-else-if="history.length" class="history-list">
            <article v-for="item in history" :key="item.id">
              <div><strong>{{ historyTitle(item) }}</strong><small>{{ formatDateTime(item.used_at || item.created_at) }}</small><p v-if="item.notes" :title="item.notes">{{ item.notes }}</p></div>
              <div><strong :class="{ negative: item.value < 0 }">{{ historyValue(item) }}</strong><code v-if="!isAdminAdjustment(item.type)">{{ item.code.slice(0, 8) }}…</code><small v-else>人工调整</small></div>
            </article>
          </div>
          <div v-else class="history-state"><strong>暂无兑换记录</strong><span>兑换或管理员调整后会显示在这里。</span></div>
        </aside>
      </section>
    </div>
  </ConsoleShell>
</template>

<style scoped>
.redeem-page { width: min(1380px, 100%); margin: 0 auto; padding-bottom: 50px; }.redeem-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }.redeem-heading p { margin: 0 0 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }.redeem-heading h1 { font-size: clamp(40px, 5vw, 64px); }.redeem-heading span { margin-top: 12px; display: block; color: var(--text-secondary); font-size: var(--font-body-sm); }.redeem-heading .button { min-height: 42px; display: inline-flex; align-items: center; font-size: var(--font-meta); }
.redeem-layout { margin-top: 28px; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(340px, .8fr); gap: 14px; align-items: start; }.redeem-main { display: grid; gap: 13px; }.account-balance { display: grid; grid-template-columns: 1.4fr .6fr; overflow: hidden; color: white; background: var(--accent); border-radius: 15px; }.account-balance > div { min-height: 120px; padding: 21px; display: grid; align-content: center; gap: 5px; border-right: 1px solid rgb(255 255 255 / 22%); }.account-balance > div:last-child { border-right: 0; }.account-balance span, .account-balance small { opacity: .72; font-size: var(--font-meta); }.account-balance strong { font-size: clamp(25px, 4vw, 38px); letter-spacing: -.04em; }
.redeem-form { padding: 19px; display: grid; gap: 8px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 14px; }.redeem-form > label { font-size: var(--font-meta); font-weight: 720; }.redeem-form > div { display: grid; grid-template-columns: 1fr auto; gap: 8px; }.redeem-form input { min-width: 0; min-height: 48px; padding: 0 13px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; letter-spacing: .04em; }.redeem-form .button { min-height: 48px; }.redeem-form small { color: var(--text-secondary); font-size: var(--font-meta); }
.redeem-feedback { padding: 16px 18px; border-left: 3px solid; border-radius: 10px; }.redeem-feedback.is-success { color: var(--success); background: color-mix(in srgb, var(--success) 8%, var(--surface-raised)); }.redeem-feedback.is-error { color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--surface-raised)); }.redeem-feedback > strong { font-size: var(--font-body-sm); }.redeem-feedback p { margin: 5px 0 0; font-size: var(--font-meta); }.redeem-feedback dl { margin: 12px 0 0; display: flex; flex-wrap: wrap; gap: 7px; }.redeem-feedback dl div { min-width: 120px; padding: 8px; display: grid; gap: 3px; color: var(--text-primary); background: var(--surface-raised); border-radius: 7px; }.redeem-feedback dt { color: var(--text-secondary); font-size: var(--font-caption); }.redeem-feedback dd { margin: 0; font-size: var(--font-meta); font-weight: 700; }
.redeem-guidance { padding: 17px 19px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }.redeem-guidance > strong { font-size: var(--font-meta); }.redeem-guidance ul { margin: 10px 0 0; padding-left: 17px; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.9; }
.history-panel { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 14px; }.history-panel > header { min-height: 68px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); }.history-panel > header div { display: grid; gap: 3px; }.history-panel header span { color: var(--text-secondary); font-size: var(--font-meta); }.history-panel header strong { font-size: 18px; }.history-panel header button, .history-state button { min-height: 30px; padding: 0 8px; color: var(--accent); background: transparent; border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; font-size: var(--font-meta); }.history-list { max-height: 550px; overflow: auto; padding: 4px 15px; }.history-list article { min-height: 72px; padding: 12px 1px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border-subtle); }.history-list article:last-child { border-bottom: 0; }.history-list article > div { min-width: 0; display: grid; gap: 4px; }.history-list article > div:last-child { text-align: right; }.history-list strong { font-size: var(--font-meta); }.history-list article > div:last-child strong { color: var(--success); }.history-list article > div:last-child strong.negative { color: var(--danger); }.history-list small, .history-list code { color: var(--text-secondary); font-size: var(--font-caption); }.history-list p { max-width: 210px; margin: 0; overflow: hidden; color: var(--text-secondary); font-size: var(--font-caption); text-overflow: ellipsis; white-space: nowrap; }.history-state { min-height: 230px; padding: 20px; display: grid; place-content: center; justify-items: center; gap: 6px; color: var(--text-secondary); text-align: center; font-size: var(--font-meta); }.history-state.is-error { color: var(--danger); }.history-state span { font-size: var(--font-meta); }
@media (max-width: 940px) { .redeem-layout { grid-template-columns: 1fr; }.history-list { max-height: none; } }
@media (max-width: 620px) { .redeem-heading { align-items: stretch; flex-direction: column; }.redeem-heading .button { justify-content: center; }.account-balance { grid-template-columns: 1fr; }.account-balance > div { min-height: 90px; border-right: 0; border-bottom: 1px solid rgb(255 255 255 / 22%); }.redeem-form > div { grid-template-columns: 1fr; } }
</style>
