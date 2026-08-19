<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import PublicShell from '@/components/layout/PublicShell.vue'
import {
  getPublicKeyUsage,
  type PublicDailyUsageRow,
  type PublicKeyUsageResponse,
  type PublicModelUsageRow,
} from '@/features/public/keyUsage'
import {
  KeyUsageHistoryDays,
  KeyUsageRange,
  PublicKeyStatus,
  PublicKeyUsageMode,
  RateLimitWindow,
  localDate,
} from '@/features/public/model'

interface SummaryCell { label: string; value: string }
interface LimitCard { label: string; used: number; limit: number; remaining: number; resetAt?: string | null }

const apiKey = ref('')
const keyVisible = ref(false)
const loading = ref(false)
const error = ref('')
const result = ref<PublicKeyUsageResponse | null>(null)
const filters = reactive({
  range: KeyUsageRange.THIRTY_DAYS,
  startDate: localDate(new Date(Date.now() - 30 * 86_400_000)),
  endDate: localDate(),
  days: KeyUsageHistoryDays.THIRTY,
})
let controller: AbortController | null = null

const ranges = [
  { value: KeyUsageRange.TODAY, label: '今天' },
  { value: KeyUsageRange.SEVEN_DAYS, label: '近 7 天' },
  { value: KeyUsageRange.THIRTY_DAYS, label: '近 30 天' },
  { value: KeyUsageRange.NINETY_DAYS, label: '近 90 天' },
  { value: KeyUsageRange.CUSTOM, label: '自定义' },
]

const statusLabel = computed(() => {
  if (!result.value) return ''
  if (result.value.status === PublicKeyStatus.QUOTA_EXHAUSTED) return '额度已用尽'
  if (result.value.status === PublicKeyStatus.EXPIRED) return '已过期'
  if (result.value.isValid === false) return '不可用'
  return '可用'
})
const statusTone = computed(() => statusLabel.value === '可用' ? 'success' : 'danger')
const modeLabel = computed(() => result.value?.mode === PublicKeyUsageMode.QUOTA_LIMITED ? 'Key 独立额度' : (result.value?.planName || '钱包 / 订阅'))
const money = (value?: number | null) => value == null ? '—' : `$${Number(value).toFixed(4)}`
const integer = (value?: number | null) => value == null ? '—' : Number(value).toLocaleString()
const percent = (used: number, limit: number) => limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0

const limitCards = computed<LimitCard[]>(() => {
  const data = result.value
  if (!data) return []
  const cards: LimitCard[] = []
  if (data.quota) cards.push({ label: '总额度', used: data.quota.used, limit: data.quota.limit, remaining: data.quota.remaining })
  const rateLabels: Record<string, string> = {
    [RateLimitWindow.FIVE_HOURS]: '5 小时限额',
    [RateLimitWindow.ONE_DAY]: '每日限额',
    [RateLimitWindow.SEVEN_DAYS]: '7 日限额',
  }
  for (const item of data.rate_limits || []) cards.push({ label: rateLabels[item.window] || item.window, used: item.used, limit: item.limit, remaining: item.remaining, resetAt: item.reset_at })
  const subscription = data.subscription
  if (subscription) {
    const items = [
      ['每日订阅额度', subscription.daily_usage_usd, subscription.daily_limit_usd],
      ['每周订阅额度', subscription.weekly_usage_usd, subscription.weekly_limit_usd],
      ['每月订阅额度', subscription.monthly_usage_usd, subscription.monthly_limit_usd],
    ] as const
    for (const [label, used, limit] of items) if (limit && limit > 0) cards.push({ label, used, limit, remaining: Math.max(0, limit - used) })
  }
  return cards
})

const summary = computed<SummaryCell[]>(() => {
  const usage = result.value?.usage
  if (!usage) return []
  const today = usage.today || {}
  const total = usage.total || {}
  return [
    { label: '今日请求', value: integer(today.requests) },
    { label: '今日输入 Token', value: integer(today.input_tokens) },
    { label: '今日输出 Token', value: integer(today.output_tokens) },
    { label: '今日总 Token', value: integer(today.total_tokens) },
    { label: '今日缓存创建', value: integer(today.cache_creation_tokens) },
    { label: '今日缓存读取', value: integer(today.cache_read_tokens) },
    { label: '今日实际费用', value: money(today.actual_cost) },
    { label: 'RPM / TPM', value: `${integer(usage.rpm)} / ${integer(usage.tpm)}` },
    { label: '累计请求', value: integer(total.requests) },
    { label: '累计输入 Token', value: integer(total.input_tokens) },
    { label: '累计输出 Token', value: integer(total.output_tokens) },
    { label: '累计总 Token', value: integer(total.total_tokens) },
    { label: '累计缓存创建', value: integer(total.cache_creation_tokens) },
    { label: '累计缓存读取', value: integer(total.cache_read_tokens) },
    { label: '累计实际费用', value: money(total.actual_cost) },
    { label: '平均响应', value: usage.average_duration_ms == null ? '—' : `${Math.round(usage.average_duration_ms)} ms` },
  ]
})
const modelRows = computed<PublicModelUsageRow[]>(() => result.value?.model_stats || [])
const dailyRows = computed<PublicDailyUsageRow[]>(() => result.value?.daily_usage || [])
const remaining = computed(() => result.value?.quota?.remaining ?? result.value?.remaining ?? result.value?.balance)
const expiryLabel = computed(() => {
  const value = result.value?.expires_at || result.value?.subscription?.expires_at
  if (!value) return ''
  const formatted = new Date(value).toLocaleString()
  const days = result.value?.days_until_expiry
  if (days == null) return formatted
  if (days < 0) return `${formatted} · 已过期`
  if (days === 0) return `${formatted} · 今日到期`
  return `${formatted} · 剩余 ${days} 天`
})

function validateCustomDates(): boolean {
  if (filters.range !== KeyUsageRange.CUSTOM) return true
  if (!filters.startDate || !filters.endDate) { error.value = '请选择完整的开始和结束日期'; return false }
  if (filters.startDate > filters.endDate) { error.value = '开始日期不能晚于结束日期'; return false }
  return true
}

async function query(): Promise<void> {
  const key = apiKey.value.trim()
  error.value = ''
  if (!key) { error.value = '请输入 API Key'; return }
  if (!validateCustomDates()) return
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  try {
    result.value = await getPublicKeyUsage(key, {
      range: filters.range,
      customStartDate: filters.startDate,
      customEndDate: filters.endDate,
      days: filters.days,
    }, { signal: controller.signal })
  } catch (caught) {
    if ((caught as { name?: string }).name !== 'AbortError') {
      result.value = null
      error.value = (caught as { message?: string }).message || '查询失败，请确认 Key 是否有效'
    }
  } finally { loading.value = false }
}

function refreshForFilter(): void {
  if (result.value && apiKey.value.trim()) void query()
}

function rateReset(resetAt?: string | null): string {
  if (!resetAt) return '按滚动窗口统计'
  return `重置于 ${new Date(resetAt).toLocaleString()}`
}

onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <PublicShell>
    <main class="key-usage-page">
      <header class="key-usage-heading">
        <div><p class="eyebrow">PRIVATE LOOKUP</p><h1>查询 Key 用量</h1><p>Key 只会作为本次请求的认证头发送，不会写入浏览器存储。</p></div>
        <span>GET /v1/usage</span>
      </header>

      <section class="key-query-card" aria-label="Key 用量查询">
        <div class="key-query-row">
          <label><span>API Key</span><span class="key-input-wrap"><input v-model="apiKey" :type="keyVisible ? 'text' : 'password'" autocomplete="off" placeholder="sk-..." @keydown.enter="query" /><button type="button" :aria-label="keyVisible ? '隐藏 Key' : '显示 Key'" @click="keyVisible = !keyVisible">{{ keyVisible ? '隐藏' : '显示' }}</button></span></label>
          <button class="button button--primary" :disabled="loading" @click="query">{{ loading ? '查询中…' : '立即查询' }}</button>
        </div>
        <div class="key-filter-row">
          <fieldset><legend>模型统计范围</legend><button v-for="item in ranges" :key="item.value" :class="{ 'is-active': filters.range === item.value }" @click="filters.range = item.value; refreshForFilter()">{{ item.label }}</button></fieldset>
          <div v-if="filters.range === KeyUsageRange.CUSTOM" class="key-custom-range"><label>开始<input v-model="filters.startDate" type="date" /></label><label>结束<input v-model="filters.endDate" type="date" /></label><button class="button button--secondary" @click="query">应用</button></div>
          <label class="key-history-select">每日明细<select v-model="filters.days" @change="refreshForFilter"><option :value="KeyUsageHistoryDays.SEVEN">7 天</option><option :value="KeyUsageHistoryDays.THIRTY">30 天</option><option :value="KeyUsageHistoryDays.NINETY">90 天</option></select></label>
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </section>

      <section v-if="loading" class="public-state-card" aria-live="polite">正在验证 Key 并汇总用量…</section>
      <template v-else-if="result">
        <section class="key-status-strip">
          <div><span :class="`status-dot status-dot--${statusTone}`">{{ statusLabel }}</span><strong>{{ modeLabel }}</strong></div>
          <dl><div><dt>当前可用</dt><dd>{{ money(remaining) }}</dd></div><div v-if="expiryLabel"><dt>到期时间</dt><dd>{{ expiryLabel }}</dd></div></dl>
        </section>

        <section v-if="limitCards.length" class="key-limit-grid" aria-label="额度与周期限制">
          <article v-for="item in limitCards" :key="item.label"><header><span>{{ item.label }}</span><strong>{{ percent(item.used, item.limit) }}%</strong></header><div class="key-progress" role="progressbar" :aria-valuenow="percent(item.used, item.limit)" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${percent(item.used, item.limit)}%` }" /></div><dl><div><dt>已用</dt><dd>{{ money(item.used) }}</dd></div><div><dt>剩余</dt><dd>{{ money(item.remaining) }}</dd></div><div><dt>上限</dt><dd>{{ money(item.limit) }}</dd></div></dl><small v-if="item.resetAt">{{ rateReset(item.resetAt) }}</small></article>
        </section>

        <section v-if="summary.length" class="key-summary-grid" aria-label="请求与 Token 统计"><article v-for="cell in summary" :key="cell.label"><span>{{ cell.label }}</span><strong>{{ cell.value }}</strong></article></section>

        <section class="key-table-section"><header><div><p class="eyebrow">MODELS</p><h2>模型统计</h2></div><span>{{ modelRows.length }} 个模型</span></header><div v-if="modelRows.length" class="table-surface"><table><thead><tr><th>模型</th><th>请求</th><th>输入 Token</th><th>输出 Token</th><th>缓存创建</th><th>缓存读取</th><th>总 Token</th><th>实际费用</th></tr></thead><tbody><tr v-for="row in modelRows" :key="row.model"><td><strong>{{ row.model || '—' }}</strong></td><td>{{ integer(row.requests) }}</td><td>{{ integer(row.input_tokens) }}</td><td>{{ integer(row.output_tokens) }}</td><td>{{ integer(row.cache_creation_tokens) }}</td><td>{{ integer(row.cache_read_tokens) }}</td><td>{{ integer(row.total_tokens) }}</td><td>{{ money(row.actual_cost ?? row.cost) }}</td></tr></tbody></table></div><div v-else class="key-empty">当前范围暂无模型调用记录</div></section>

        <section class="key-table-section"><header><div><p class="eyebrow">DAILY</p><h2>每日明细</h2></div><span>最近 {{ filters.days }} 天</span></header><div v-if="dailyRows.length" class="table-surface"><table><thead><tr><th>日期</th><th>请求</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存写入</th><th>Token</th><th>实际费用</th></tr></thead><tbody><tr v-for="row in dailyRows" :key="row.date"><td><strong>{{ row.date }}</strong></td><td>{{ integer(row.requests) }}</td><td>{{ integer(row.input_tokens) }}</td><td>{{ integer(row.output_tokens) }}</td><td>{{ integer(row.cache_read_tokens) }}</td><td>{{ integer(row.cache_write_tokens) }}</td><td>{{ integer(row.total_tokens) }}</td><td>{{ money(row.actual_cost ?? row.cost) }}</td></tr></tbody></table></div><div v-else class="key-empty">这个 Key 暂无每日用量记录</div></section>
      </template>
    </main>
  </PublicShell>
</template>
