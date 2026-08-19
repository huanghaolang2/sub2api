<script setup lang="ts">
import { computed } from 'vue'
import type { PlatformQuotaItem } from '@/types'
import type { DashboardPlatformStats, DashboardStats } from '@/types/user'
import { formatCompactNumber, formatCurrency } from './dashboard'

interface PlatformCard {
  platform: string
  stat: DashboardPlatformStats | null
  quota: PlatformQuotaItem | null
  isOther: boolean
}

interface QuotaWindowView {
  key: 'daily' | 'weekly' | 'monthly'
  label: string
  limit: number
  usage: number
  resetsAt: string | null
  percent: number
}

const props = defineProps<{
  stats: DashboardStats | null
  quotas: PlatformQuotaItem[]
  loading: boolean
  error: string
}>()

const platformLabels: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
  __other__: '其他 / 未归属'
}
const platformOrder = ['anthropic', 'openai', 'gemini', 'antigravity', 'grok']

const cards = computed<PlatformCard[]>(() => {
  const stats = new Map((props.stats?.by_platform || []).map((item) => [item.platform, item]))
  const quotas = new Map<string, PlatformQuotaItem>(props.quotas.map((item) => [item.platform, item]))
  const platforms = [...new Set([...stats.keys(), ...quotas.keys()])]
  platforms.sort((left, right) => {
    const leftIndex = platformOrder.indexOf(left)
    const rightIndex = platformOrder.indexOf(right)
    if (leftIndex < 0 && rightIndex < 0) return left.localeCompare(right)
    if (leftIndex < 0) return 1
    if (rightIndex < 0) return -1
    return leftIndex - rightIndex
  })
  const result = platforms.map((platform) => ({
    platform,
    stat: stats.get(platform) || null,
    quota: quotas.get(platform) || null,
    isOther: false
  }))
  const attributedTotal = [...stats.values()].reduce((total, item) => total + Number(item.total_actual_cost || 0), 0)
  const attributedToday = [...stats.values()].reduce((total, item) => total + Number(item.today_actual_cost || 0), 0)
  const totalDifference = Math.max(0, Number(props.stats?.total_actual_cost || 0) - attributedTotal)
  const todayDifference = Math.max(0, Number(props.stats?.today_actual_cost || 0) - attributedToday)
  if (totalDifference > 0.0001 || todayDifference > 0.0001) {
    result.push({
      platform: '__other__',
      stat: {
        platform: '__other__', total_requests: 0, total_tokens: 0, total_actual_cost: totalDifference,
        today_requests: 0, today_tokens: 0, today_actual_cost: todayDifference
      },
      quota: null,
      isOther: true
    })
  }
  return result
})

function label(platform: string): string {
  return platformLabels[platform] || platform
}

function windows(quota: PlatformQuotaItem | null): QuotaWindowView[] {
  if (!quota) return []
  return [
    { key: 'daily', label: '每日', limit: quota.daily_limit_usd, usage: quota.daily_usage_usd, resetsAt: quota.daily_window_resets_at || null },
    { key: 'weekly', label: '每周', limit: quota.weekly_limit_usd, usage: quota.weekly_usage_usd, resetsAt: quota.weekly_window_resets_at || null },
    { key: 'monthly', label: '每月', limit: quota.monthly_limit_usd, usage: quota.monthly_usage_usd, resetsAt: quota.monthly_window_resets_at || null }
  ].filter((item): item is Omit<QuotaWindowView, 'percent'> & { limit: number } => item.limit != null)
    .map((item) => ({ ...item, percent: item.limit > 0 ? Math.min(100, Math.max(0, item.usage / item.limit * 100)) : 100 }))
}

function quotaTone(item: QuotaWindowView): string {
  if (item.limit === 0 || item.percent >= 95) return 'danger'
  if (item.percent >= 75) return 'warning'
  return 'success'
}

function resetLabel(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
</script>

<template>
  <article class="platform-panel">
    <header>
      <div><span>消费归属与服务限额</span><strong>平台用量</strong><small>消费统计与管理员配置的日 / 周 / 月额度合并展示</small></div>
      <RouterLink to="/app/usage">查看全部用量 →</RouterLink>
    </header>

    <div v-if="loading && cards.length === 0" class="platform-state" role="status">正在加载平台消费与额度…</div>
    <div v-else-if="cards.length === 0" class="platform-state"><strong>暂无平台用量</strong><span>{{ error || '产生调用或配置平台额度后，这里会按平台展示。' }}</span></div>
    <div v-else class="platform-grid">
      <section v-for="card in cards" :key="card.platform" :class="['platform-card', { 'is-other': card.isOther }]">
        <header><div><strong>{{ label(card.platform) }}</strong><code>{{ card.platform }}</code></div><span>{{ formatCurrency(card.stat?.total_actual_cost || 0) }}</span></header>
        <dl>
          <div><dt>今日消费</dt><dd>{{ formatCurrency(card.stat?.today_actual_cost || 0) }}</dd></div>
          <div><dt>累计请求</dt><dd>{{ card.stat?.total_requests ? formatCompactNumber(card.stat.total_requests) : '—' }}</dd></div>
          <div><dt>累计 Tokens</dt><dd>{{ card.stat?.total_tokens ? formatCompactNumber(card.stat.total_tokens) : '—' }}</dd></div>
        </dl>
        <div v-if="windows(card.quota).length" class="quota-list">
          <strong>额度窗口</strong>
          <div v-for="item in windows(card.quota)" :key="item.key" class="quota-row">
            <div><span>{{ item.label }}</span><strong v-if="item.limit === 0" class="is-disabled">已停用</strong><strong v-else>{{ formatCurrency(item.usage) }} / {{ formatCurrency(item.limit) }}</strong></div>
            <i><b :class="`tone-${quotaTone(item)}`" :style="{ width: `${item.percent}%` }" /></i>
            <small v-if="item.resetsAt">{{ resetLabel(item.resetsAt) }} 重置</small>
          </div>
        </div>
        <p v-else-if="!card.isOther" class="no-quota">管理员未设置平台额度</p>
        <p v-else class="no-quota">后端未能归属到具体平台的消费差额</p>
      </section>
    </div>
    <p v-if="error && cards.length" class="platform-warning" role="alert">额度刷新失败，消费数据仍可用：{{ error }}</p>
  </article>
</template>

<style scoped>
.platform-panel { margin-top: 16px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }
.platform-panel > header { min-height: 76px; padding: 18px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }
.platform-panel > header > div { display: grid; gap: 3px; }.platform-panel > header span { color: var(--text-secondary); font-size: 12px; font-weight: 650; }.platform-panel > header strong { font-size: 15px; }.platform-panel > header small { color: var(--text-secondary); font-size: var(--font-meta); }.platform-panel > header a { padding-top: 3px; color: var(--accent); font-size: var(--font-meta); font-weight: 700; }
.platform-state { min-height: 180px; padding: 24px; display: grid; place-content: center; justify-items: center; gap: 6px; color: var(--text-secondary); text-align: center; }.platform-state strong { color: var(--text-primary); font-size: 13px; }.platform-state span { font-size: var(--font-meta); }
.platform-grid { padding: 16px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.platform-card { min-width: 0; padding: 15px; display: grid; align-content: start; gap: 13px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 12px; }.platform-card.is-other { border-style: dashed; }
.platform-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }.platform-card > header div { min-width: 0; display: grid; gap: 3px; }.platform-card > header strong { font-size: 14px; }.platform-card > header code { overflow: hidden; color: var(--text-secondary); font-size: var(--font-meta); text-overflow: ellipsis; white-space: nowrap; }.platform-card > header > span { color: var(--accent); font-size: 14px; font-weight: 760; }
.platform-card dl { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--border-subtle); }.platform-card dl > div { min-width: 0; padding: 8px; display: grid; gap: 3px; background: var(--surface-raised); }.platform-card dt { color: var(--text-secondary); font-size: var(--font-meta); }.platform-card dd { margin: 0; overflow: hidden; font-size: var(--font-meta); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.quota-list { padding-top: 11px; display: grid; gap: 8px; border-top: 1px solid var(--border-subtle); }.quota-list > strong { color: var(--text-secondary); font-size: var(--font-meta); letter-spacing: .06em; }.quota-row { display: grid; gap: 4px; }.quota-row > div { display: flex; justify-content: space-between; gap: 8px; font-size: var(--font-meta); }.quota-row > div span { color: var(--text-secondary); }.quota-row > div strong { font-size: var(--font-meta); }.quota-row .is-disabled { color: var(--danger); }.quota-row > i { height: 4px; overflow: hidden; background: var(--border-subtle); border-radius: 999px; }.quota-row > i b { height: 100%; display: block; border-radius: inherit; }.quota-row .tone-success { background: var(--success); }.quota-row .tone-warning { background: var(--warning); }.quota-row .tone-danger { background: var(--danger); }.quota-row small { color: var(--text-secondary); font-size: var(--font-caption); }.no-quota { margin: 0; padding-top: 10px; color: var(--text-secondary); border-top: 1px solid var(--border-subtle); font-size: var(--font-meta); }.platform-warning { margin: 0 16px 14px; padding: 9px 10px; color: var(--warning); background: color-mix(in srgb, var(--warning) 8%, transparent); border-radius: 7px; font-size: var(--font-meta); }
@media (max-width: 1180px) { .platform-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .platform-grid { grid-template-columns: 1fr; }.platform-panel > header { align-items: stretch; flex-direction: column; }.platform-panel > header a { width: max-content; } }
</style>
