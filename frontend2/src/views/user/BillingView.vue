<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import * as subscriptionsAPI from '@shared-api/subscriptions'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import {
  expirationSummary,
  formatDateTime,
  formatMoney,
  platformLabel,
  quotaTone,
  subscriptionQuotaWindows,
  subscriptionStatusLabel,
  subscriptionStatusTone
} from '@/features/user/billing/model'
import type { UserSubscription } from '@/types'
import { useAppStore } from '@/stores/app'
import { formatPeakRateWindow, hasPeakRate, serverTimezoneLabel } from '@shared-utils/peak-rate'

interface RequestError { message?: string }

const app = useAppStore()
const subscriptions = ref<UserSubscription[]>([])
const loading = ref(true)
const error = ref('')

const activeCount = computed(() => subscriptions.value.filter((item) => item.status === 'active').length)
const configuredWindows = computed(() => subscriptions.value.reduce((total, item) => total + subscriptionQuotaWindows(item).length, 0))
const nextExpiration = computed(() => subscriptions.value
  .filter((item) => item.status === 'active' && item.expires_at && new Date(item.expires_at).getTime() > Date.now())
  .sort((left, right) => new Date(left.expires_at || 0).getTime() - new Date(right.expires_at || 0).getTime())[0]?.expires_at || null)

function errorMessage(caught: unknown): string {
  return (caught as RequestError)?.message || '订阅数据加载失败'
}

function peakRateLabel(subscription: UserSubscription): string {
  return formatPeakRateWindow(subscription.group, serverTimezoneLabel(app.cachedPublicSettings?.server_utc_offset))
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    subscriptions.value = await subscriptionsAPI.getMySubscriptions()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <ConsoleShell>
    <div class="subscriptions-page">
      <header class="subscriptions-heading">
        <div>
          <p>账务与权益 / 我的订阅</p>
          <h1>订阅权益</h1>
          <span>额度窗口、计费倍率、有效期和状态以服务端订阅记录为准。</span>
        </div>
        <div class="heading-actions">
          <RouterLink class="button button--secondary" to="/app/orders">我的订单</RouterLink>
          <RouterLink class="button button--primary" to="/app/purchase?tab=subscription">购买订阅</RouterLink>
        </div>
      </header>

      <section class="subscription-metrics" aria-label="订阅摘要">
        <div><span>全部订阅</span><strong>{{ subscriptions.length }}</strong><small>包含历史状态</small></div>
        <div><span>当前生效</span><strong>{{ activeCount }}</strong><small>可用于 API 调用</small></div>
        <div><span>额度窗口</span><strong>{{ configuredWindows }}</strong><small>日 / 周 / 月配置总数</small></div>
        <div><span>最近到期</span><strong>{{ nextExpiration ? formatDateTime(nextExpiration).split(' ')[0] : '—' }}</strong><small>{{ nextExpiration ? expirationSummary(nextExpiration) : '无到期时间' }}</small></div>
      </section>

      <PageState :loading="loading" :error="error" @retry="load">
        <div v-if="subscriptions.length" class="subscription-grid">
          <article v-for="subscription in subscriptions" :key="subscription.id" class="subscription-card">
            <header>
              <div>
                <span>{{ platformLabel(subscription.group?.platform || '') }}</span>
                <h2>{{ subscription.group?.name || `分组 #${subscription.group_id}` }}</h2>
                <p>{{ subscription.group?.description || '管理员未填写套餐说明' }}</p>
              </div>
              <strong :class="`status-${subscriptionStatusTone(subscription.status)}`">{{ subscriptionStatusLabel(subscription.status) }}</strong>
            </header>

            <dl class="subscription-facts">
              <div><dt>基础倍率</dt><dd>×{{ subscription.group?.rate_multiplier ?? 1 }}</dd></div>
              <div><dt>开始时间</dt><dd>{{ formatDateTime(subscription.starts_at) }}</dd></div>
              <div><dt>有效期</dt><dd>{{ expirationSummary(subscription.expires_at) }}</dd></div>
              <div><dt>订阅编号</dt><dd>#{{ subscription.id }}</dd></div>
            </dl>

            <p v-if="hasPeakRate(subscription.group)" class="peak-rate">高峰倍率 {{ peakRateLabel(subscription) }}</p>

            <section v-if="subscriptionQuotaWindows(subscription).length" class="quota-windows">
              <div v-for="window in subscriptionQuotaWindows(subscription)" :key="window.key" class="quota-window">
                <header>
                  <span>{{ window.label }}</span>
                  <strong v-if="window.disabled" class="is-disabled">已停用</strong>
                  <strong v-else>{{ formatMoney(window.used) }} / {{ formatMoney(window.limit) }}</strong>
                </header>
                <i><b :class="`tone-${quotaTone(window)}`" :style="{ width: `${window.percentage}%` }" /></i>
                <small>{{ window.resetsAt ? `${formatDateTime(window.resetsAt.toISOString())} 重置` : '窗口尚未开始' }}</small>
              </div>
            </section>
            <div v-else class="unlimited-state"><strong>∞ 未配置用量上限</strong><span>仍受账户余额、Key 和平台额度约束。</span></div>

            <footer>
              <span>{{ subscription.status === 'active' ? '订阅当前可用' : `最后更新 ${formatDateTime(subscription.updated_at)}` }}</span>
              <RouterLink
                v-if="subscription.status === 'active'"
                :to="{ path: '/app/purchase', query: { tab: 'subscription', group: String(subscription.group_id) } }"
              >续订此套餐 →</RouterLink>
            </footer>
          </article>
        </div>
        <section v-else class="subscription-empty">
          <strong>当前没有订阅记录</strong>
          <span>可以购买订阅套餐；余额充值仍可独立使用。</span>
          <RouterLink class="button button--primary" to="/app/purchase?tab=subscription">查看可选套餐</RouterLink>
        </section>
      </PageState>
    </div>
  </ConsoleShell>
</template>

<style scoped>
.subscriptions-page { width: min(1480px, 100%); margin: 0 auto; padding-bottom: 56px; }
.subscriptions-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 26px; }
.subscriptions-heading p { margin: 0 0 8px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }
.subscriptions-heading h1 { font-size: clamp(40px, 5vw, 64px); }
.subscriptions-heading span { margin-top: 12px; display: block; color: var(--text-secondary); font-size: var(--font-body-sm); }
.heading-actions { display: flex; gap: 8px; }.heading-actions .button { min-height: 42px; padding-inline: 14px; display: inline-flex; align-items: center; font-size: var(--font-meta); }
.subscription-metrics { margin: 26px 0 18px; display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--border-subtle); }
.subscription-metrics div { min-width: 0; padding: 18px; display: grid; gap: 5px; border-right: 1px solid var(--border-subtle); }.subscription-metrics div:first-child { padding-left: 0; }.subscription-metrics div:last-child { border-right: 0; }
.subscription-metrics span, .subscription-metrics small { overflow: hidden; color: var(--text-secondary); font-size: var(--font-meta); text-overflow: ellipsis; white-space: nowrap; }.subscription-metrics strong { font-size: 23px; }
.subscription-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.subscription-card { min-width: 0; overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }
.subscription-card > header { min-height: 105px; padding: 18px 19px; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--border-subtle); }.subscription-card > header > div { min-width: 0; }.subscription-card > header span { color: var(--accent); font-size: var(--font-meta); font-weight: 760; letter-spacing: .07em; text-transform: uppercase; }.subscription-card h2 { margin: 6px 0 0; font-size: 17px; }.subscription-card header p { margin: 7px 0 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.5; }
.subscription-card > header > strong { padding: 5px 8px; border-radius: 999px; font-size: var(--font-meta); white-space: nowrap; }.status-success { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }.status-warning { color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); }.status-danger { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }.status-muted { color: var(--text-secondary); background: var(--surface-canvas); }
.subscription-facts { margin: 0; padding: 14px 18px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--border-subtle); }.subscription-facts div { min-width: 0; padding: 10px; display: grid; gap: 4px; background: var(--surface-raised); }.subscription-facts dt { color: var(--text-secondary); font-size: var(--font-caption); }.subscription-facts dd { margin: 0; overflow: hidden; font-size: var(--font-meta); font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
.peak-rate { margin: 13px 18px 0; padding: 9px 10px; color: var(--warning); background: color-mix(in srgb, var(--warning) 8%, transparent); border-radius: 7px; font-size: var(--font-meta); }
.quota-windows { padding: 15px 18px; display: grid; gap: 12px; }.quota-window { display: grid; gap: 5px; }.quota-window header { display: flex; justify-content: space-between; gap: 10px; font-size: var(--font-meta); }.quota-window header span { color: var(--text-secondary); }.quota-window header strong { font-size: var(--font-meta); }.quota-window .is-disabled { color: var(--danger); }.quota-window > i { height: 5px; overflow: hidden; background: var(--surface-canvas); border-radius: 999px; }.quota-window > i b { height: 100%; display: block; }.tone-success { background: var(--success); }.tone-warning { background: var(--warning); }.tone-danger { background: var(--danger); }.quota-window small { color: var(--text-secondary); font-size: var(--font-caption); }
.unlimited-state { margin: 15px 18px; padding: 18px; display: grid; gap: 5px; color: var(--success); background: color-mix(in srgb, var(--success) 7%, transparent); border-radius: 10px; }.unlimited-state strong { font-size: var(--font-body-sm); }.unlimited-state span { color: var(--text-secondary); font-size: var(--font-meta); }
.subscription-card > footer { min-height: 45px; padding: 10px 18px; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--surface-canvas); border-top: 1px solid var(--border-subtle); }.subscription-card > footer span { color: var(--text-secondary); font-size: var(--font-caption); }.subscription-card > footer a { color: var(--accent); font-size: var(--font-meta); font-weight: 750; }
.subscription-empty { min-height: 330px; display: grid; place-content: center; justify-items: center; gap: 8px; text-align: center; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }.subscription-empty strong { font-size: 15px; }.subscription-empty span { color: var(--text-secondary); font-size: var(--font-meta); }.subscription-empty .button { margin-top: 8px; display: inline-flex; align-items: center; }
@media (max-width: 980px) { .subscription-grid { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .subscriptions-heading { align-items: stretch; flex-direction: column; }.heading-actions .button { flex: 1; justify-content: center; }.subscription-metrics { grid-template-columns: repeat(2, 1fr); }.subscription-metrics div:nth-child(2) { border-right: 0; }.subscription-metrics div:nth-child(-n+2) { border-bottom: 1px solid var(--border-subtle); }.subscription-metrics div:first-child { padding-left: 18px; } }
@media (max-width: 480px) { .subscription-metrics { grid-template-columns: 1fr; }.subscription-metrics div { border-right: 0; border-bottom: 1px solid var(--border-subtle); }.subscription-facts { grid-template-columns: 1fr; } }
</style>
