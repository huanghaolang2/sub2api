<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import adminPaymentAPI from '@shared-api/admin/payment'
import type { CurrencyAmounts, DashboardStats, DailyPaymentStats, TopUserPaymentStats } from '@/types/payment'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import { PaymentMethod, PaymentRangeDays, formatCurrency, paymentMethodLabels } from '@/features/admin/commerce/model'

const days = ref<PaymentRangeDays>(PaymentRangeDays.MONTH)
const stats = ref<DashboardStats | null>(null)
const loading = ref(true)
const error = ref('')

const rangeOptions = [PaymentRangeDays.WEEK, PaymentRangeDays.MONTH, PaymentRangeDays.QUARTER]
const currencies = computed(() => stats.value ? [...new Set([
  ...Object.keys(stats.value.today_amount || {}),
  ...Object.keys(stats.value.total_amount || {}),
  ...Object.keys(stats.value.avg_amount || {})
])] : [])
const maxDaily = computed(() => Math.max(1, ...(stats.value?.daily_series || []).map((item) => sumAmounts(item.amount))))
const totalMethodAmount = computed(() => Math.max(1, ...(stats.value?.payment_methods || []).map((item) => sumAmounts(item.amount))))

function sumAmounts(amounts: CurrencyAmounts | undefined): number { return Object.values(amounts || {}).reduce((sum, value) => sum + Number(value || 0), 0) }
function sortedAmounts(amounts: CurrencyAmounts): Array<[string, number]> { return Object.entries(amounts || {}).sort(([left], [right]) => left.localeCompare(right)) }
function sortedUsers(value: Record<string, TopUserPaymentStats[]>): Array<[string, TopUserPaymentStats[]]> { return Object.entries(value || {}).filter(([, users]) => users.length).sort(([left], [right]) => left.localeCompare(right)) }
function dailyHeight(item: DailyPaymentStats): number { return Math.max(4, sumAmounts(item.amount) / maxDaily.value * 100) }
function methodWidth(amounts: CurrencyAmounts): number { return Math.max(4, sumAmounts(amounts) / totalMethodAmount.value * 100) }
function methodLabel(value: string): string { return paymentMethodLabels[value as PaymentMethod] || value }

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try { stats.value = (await adminPaymentAPI.getDashboard(days.value)).data }
  catch (caught) { error.value = (caught as { message?: string }).message || '支付概览加载失败' }
  finally { loading.value = false }
}

watch(days, load)
onMounted(load)
</script>

<template>
  <ConsoleShell>
    <main class="resource-page">
      <header class="resource-page__heading"><div><span class="resource-eyebrow">Revenue Pulse</span><h1>支付概览</h1><p>按币种保留原始金额口径，集中查看成交规模、订单效率、支付方式分布与高价值用户。</p></div><div class="commerce-range"><button v-for="option in rangeOptions" :key="option" :aria-pressed="days === option" @click="days = option">{{ option }} 天</button><button class="resource-button resource-button--secondary" :disabled="loading" @click="load">刷新</button></div></header>
      <PageState :loading="loading" :error="error" :empty="!loading && !error && !stats" @retry="load">
        <template v-if="stats">
          <section class="commerce-money-metrics">
            <article><span>今日实收</span><strong v-for="currency in currencies" :key="currency">{{ formatCurrency(stats.today_amount[currency], currency) }}</strong><small>{{ stats.today_count }} 笔订单</small></article>
            <article><span>累计实收</span><strong v-for="currency in currencies" :key="currency">{{ formatCurrency(stats.total_amount[currency], currency) }}</strong><small>共 {{ stats.total_count }} 笔</small></article>
            <article><span>平均客单</span><strong v-for="currency in currencies" :key="currency">{{ formatCurrency(stats.avg_amount[currency], currency) }}</strong><small>按完成订单统计</small></article>
            <article><span>当前观察窗</span><strong>{{ days }} 天</strong><small>{{ stats.daily_series.length }} 个数据点</small></article>
          </section>

          <section class="commerce-dashboard-grid commerce-dashboard-grid--wide">
            <article class="commerce-panel commerce-trend-panel"><header><div><span>每日趋势</span><h2>收入与订单量</h2></div><small>多币种仅用于相对高度，金额明细保留币种</small></header><div v-if="!stats.daily_series.length" class="resource-empty-inline">当前周期暂无收入。</div><div v-else class="commerce-bar-chart" role="img" aria-label="每日支付收入柱状图"><div v-for="item in stats.daily_series" :key="item.date" class="commerce-bar"><div class="commerce-bar__tooltip"><strong v-for="[currency, amount] in sortedAmounts(item.amount)" :key="currency">{{ formatCurrency(amount, currency) }}</strong><small>{{ item.count }} 笔</small></div><i :style="{ height: `${dailyHeight(item)}%` }"></i><span>{{ item.date.slice(5) }}</span></div></div></article>
            <article class="commerce-panel"><header><div><span>渠道结构</span><h2>支付方式</h2></div><small>{{ stats.payment_methods.reduce((sum, item) => sum + item.count, 0) }} 笔</small></header><div v-if="!stats.payment_methods.length" class="resource-empty-inline">暂无支付方式数据。</div><div v-else class="commerce-method-list"><div v-for="item in stats.payment_methods" :key="item.type"><div><strong>{{ methodLabel(item.type) }}</strong><span>{{ item.count }} 笔</span></div><i><b :style="{ width: `${methodWidth(item.amount)}%` }"></b></i><small v-for="[currency, amount] in sortedAmounts(item.amount)" :key="currency">{{ formatCurrency(amount, currency) }}</small></div></div></article>
          </section>

          <section class="commerce-panel"><header><div><span>用户价值</span><h2>高价值用户</h2></div><small>按币种独立排名</small></header><div v-if="!sortedUsers(stats.top_users).length" class="resource-empty-inline">暂无用户排行。</div><div v-else class="commerce-leaderboards"><div v-for="[currency, users] in sortedUsers(stats.top_users)" :key="currency"><h3>{{ currency }}</h3><ol><li v-for="(user, index) in users" :key="user.user_id"><em>{{ index + 1 }}</em><span><strong>{{ user.email }}</strong><small>用户 #{{ user.user_id }}</small></span><b>{{ formatCurrency(user.amount, currency) }}</b></li></ol></div></div></section>
        </template>
      </PageState>
    </main>
  </ConsoleShell>
</template>

<style scoped>
.commerce-range { display: flex; align-items: center; gap: 6px; }
.commerce-range > button:not(.resource-button) { min-height: 38px; padding: 0 12px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); cursor: pointer; }
.commerce-range > button:first-child { border-radius: 10px 0 0 10px; }
.commerce-range > button:nth-child(3) { border-radius: 0 10px 10px 0; }
.commerce-range > button[aria-pressed="true"] { color: white; background: var(--accent); border-color: var(--accent); }
.commerce-money-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; overflow: hidden; background: var(--border-subtle); border: 1px solid var(--border-subtle); border-radius: 16px; }
.commerce-money-metrics article { min-height: 128px; padding: 18px; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; background: var(--surface-raised); }
.commerce-money-metrics span, .commerce-money-metrics small { color: var(--text-secondary); font-size: var(--font-body-sm); }
.commerce-money-metrics strong { margin-top: 4px; font-size: 22px; letter-spacing: -.04em; }
.commerce-money-metrics small { margin-top: auto; margin-bottom: 13px; order: -1; }
.commerce-dashboard-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.commerce-dashboard-grid--wide { grid-template-columns: minmax(0, 1.45fr) minmax(300px, .75fr); }
.commerce-panel { padding: 19px; display: grid; gap: 18px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }
.commerce-panel > header { display: flex; justify-content: space-between; gap: 18px; }
.commerce-panel header span, .commerce-panel header small { color: var(--text-secondary); font-size: var(--font-meta); }
.commerce-panel h2 { margin: 4px 0 0; font-size: 19px; letter-spacing: -.03em; }
.commerce-bar-chart { height: 248px; padding-top: 38px; display: flex; align-items: flex-end; gap: 7px; overflow-x: auto; border-bottom: 1px solid var(--border-subtle); }
.commerce-bar { position: relative; min-width: 30px; height: 100%; display: flex; flex: 1; flex-direction: column; justify-content: flex-end; align-items: center; gap: 7px; }
.commerce-bar > i { width: min(28px, 76%); min-height: 4px; background: var(--accent); border-radius: 6px 6px 2px 2px; opacity: .82; }
.commerce-bar > span { color: var(--text-secondary); font-size: var(--font-meta); writing-mode: vertical-rl; }
.commerce-bar__tooltip { position: absolute; z-index: 2; bottom: calc(100% - 22px); padding: 7px 9px; display: none; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; white-space: nowrap; font-size: var(--font-meta); }
.commerce-bar:hover .commerce-bar__tooltip { display: grid; }
.commerce-method-list { display: grid; gap: 17px; }
.commerce-method-list > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 10px; }
.commerce-method-list > div > div { grid-column: 1 / -1; display: flex; justify-content: space-between; }
.commerce-method-list span, .commerce-method-list small { color: var(--text-secondary); font-size: var(--font-meta); }
.commerce-method-list i { height: 7px; overflow: hidden; background: var(--surface-canvas); border-radius: 999px; }
.commerce-method-list b { height: 100%; display: block; background: var(--accent); border-radius: inherit; }
.commerce-leaderboards { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
.commerce-leaderboards h3 { margin: 0 0 9px; color: var(--text-secondary); font-size: var(--font-body-sm); }
.commerce-leaderboards ol { margin: 0; padding: 0; list-style: none; }
.commerce-leaderboards li { padding: 11px 0; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 10px; border-bottom: 1px solid var(--border-subtle); }
.commerce-leaderboards em { width: 25px; height: 25px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 8px; font-style: normal; font-size: var(--font-meta); font-weight: 800; }
.commerce-leaderboards span { display: grid; }
.commerce-leaderboards small { color: var(--text-secondary); }
@media (max-width: 980px) { .commerce-money-metrics { grid-template-columns: repeat(2, 1fr); } .commerce-dashboard-grid--wide { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .commerce-range { flex-wrap: wrap; } .commerce-money-metrics { grid-template-columns: 1fr; } }
</style>
