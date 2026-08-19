<script setup lang="ts">
import { computed } from 'vue'
import { AccountStatus } from '@/types/auth'
import type { DashboardStats } from '@/types/user'
import { formatCompactNumber, formatCurrency } from './dashboard'

const props = defineProps<{
  stats: DashboardStats | null
  status: AccountStatus
  balance: number
  concurrency: number
  isAdmin: boolean
  canUseBatchImage: boolean
  simpleMode: boolean
}>()

const inactiveKeys = computed(() => Math.max((props.stats?.total_api_keys ?? 0) - (props.stats?.active_api_keys ?? 0), 0))
const accountActive = computed(() => props.status === AccountStatus.ACTIVE)
const quickActions = computed(() => [
  { label: '管理 API 密钥', detail: '创建、启停与查看密钥', to: '/app/keys', mark: 'K', hideInSimpleMode: false },
  { label: '查看用量明细', detail: '检索每一次 API 调用', to: '/app/usage', mark: 'U', hideInSimpleMode: true },
  ...(props.canUseBatchImage ? [{ label: '批量图片', detail: '提交、跟踪与下载生图任务', to: '/app/batch-image', mark: 'I', hideInSimpleMode: true }] : []),
  { label: '钱包与订阅', detail: '余额、套餐与订阅记录', to: '/app/subscriptions', mark: 'B', hideInSimpleMode: true },
  { label: '兑换码', detail: '兑换余额或订阅权益', to: '/app/redeem', mark: 'R', hideInSimpleMode: true },
  ...(props.isAdmin ? [{ label: '进入平台概览', detail: '查看全局运营数据', to: '/admin/dashboard', mark: 'A', hideInSimpleMode: true }] : [])
].filter((action) => !props.simpleMode || !action.hideInSimpleMode))
</script>

<template>
  <article class="dashboard-account-panel">
    <header>
      <div><span>账户与服务</span><strong>状态总览</strong><small>仅展示当前账户真实配置</small></div>
      <span class="dashboard-account-status" :class="{ 'is-active': accountActive }"><i />{{ accountActive ? '账户可用' : '账户停用' }}</span>
    </header>

    <dl class="dashboard-account-facts">
      <div><dt>API 密钥</dt><dd>{{ stats?.active_api_keys ?? 0 }} / {{ stats?.total_api_keys ?? 0 }}</dd><small>{{ inactiveKeys }} 个未启用</small></div>
      <div><dt>并发额度</dt><dd>{{ concurrency.toLocaleString() }}</dd><small>账户当前配置</small></div>
      <div v-if="!simpleMode"><dt>可用余额</dt><dd>{{ formatCurrency(balance) }}</dd><small>以账户数据为准</small></div>
      <div><dt>近 5 分钟</dt><dd>{{ formatCompactNumber(stats?.rpm ?? 0) }} RPM</dd><small>{{ formatCompactNumber(stats?.tpm ?? 0) }} TPM</small></div>
    </dl>

    <nav class="dashboard-quick-actions" aria-label="快捷操作">
      <RouterLink v-for="action in quickActions" :key="action.to" :to="action.to">
        <span>{{ action.mark }}</span>
        <span><strong>{{ action.label }}</strong><small>{{ action.detail }}</small></span>
        <i aria-hidden="true">→</i>
      </RouterLink>
    </nav>
  </article>
</template>

<style scoped>
.dashboard-account-panel { min-width: 0; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }
.dashboard-account-panel > header { min-height: 76px; padding: 18px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--border-subtle); }
.dashboard-account-panel > header > div { display: grid; gap: 3px; }
.dashboard-account-panel > header > div span { color: var(--text-secondary); font-size: 12px; font-weight: 650; }
.dashboard-account-panel > header > div strong { font-size: 15px; letter-spacing: -.025em; }
.dashboard-account-panel > header > div small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-account-status { min-height: 28px; padding: 0 9px; display: inline-flex; align-items: center; gap: 6px; color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); border-radius: 8px; font-size: var(--font-meta); font-weight: 750; white-space: nowrap; }
.dashboard-account-status i { width: 6px; height: 6px; background: currentColor; border-radius: 50%; }
.dashboard-account-status.is-active { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }
.dashboard-account-facts { margin: 0; padding: 16px 18px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--border-subtle); border-bottom: 1px solid var(--border-subtle); }
.dashboard-account-facts > div { min-width: 0; padding: 13px 14px; display: grid; gap: 3px; background: var(--surface-raised); }
.dashboard-account-facts dt { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-account-facts dd { margin: 0; overflow: hidden; font-size: 14px; font-weight: 740; letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dashboard-account-facts small { color: var(--text-secondary); font-size: var(--font-meta); }
.dashboard-quick-actions { padding: 6px 18px 12px; display: grid; }
.dashboard-quick-actions a { min-width: 0; min-height: 48px; padding: 7px 2px; display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 10px; border-bottom: 1px solid var(--border-subtle); }
.dashboard-quick-actions a:last-child { border-bottom: 0; }
.dashboard-quick-actions a > span:first-child { width: 28px; height: 28px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 8px; font-size: var(--font-meta); font-weight: 800; }
.dashboard-quick-actions a > span:nth-child(2) { min-width: 0; display: grid; gap: 2px; }
.dashboard-quick-actions a strong { font-size: var(--font-body-sm); }
.dashboard-quick-actions a small { overflow: hidden; color: var(--text-secondary); font-size: var(--font-meta); text-overflow: ellipsis; white-space: nowrap; }
.dashboard-quick-actions a > i { color: var(--text-secondary); font-size: var(--font-meta); font-style: normal; transition: transform .18s ease, color .18s ease; }
.dashboard-quick-actions a:hover > i { color: var(--accent); transform: translateX(2px); }

@media (max-width: 520px) {
  .dashboard-account-facts { grid-template-columns: 1fr; }
}
</style>
