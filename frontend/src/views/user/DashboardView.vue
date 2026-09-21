<template>
  <AppLayout>
    <div class="space-y-8 pb-10">
      <div v-if="loading" class="flex items-center justify-center py-12"><LoadingSpinner /></div>
      <div v-else-if="statsError" class="py-12 text-center text-sm text-red-500" role="alert">{{ statsError }}</div>
      <template v-else-if="stats">
        <UserDashboardTrends :trends="trends" :loading="periodLoading" />
        <UserDashboardStats
          :stats="stats"
          :loading="loading"
          :period-stats="periodStats"
          :period-loading="periodLoading"
          :error="statsError"
        />
      </template>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { usageAPI, type UserDashboardStats as UserStatsType } from '@/api/usage'
import { getUsageBoard, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder, type UsageBoardQuery } from '@/api/usageBoard'
import AppLayout from '@/components/layout/AppLayout.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import UserDashboardStats from '@/components/user/dashboard/UserDashboardStats.vue'
import UserDashboardTrends from '@/components/user/dashboard/UserDashboardTrends.vue'
import {
  buildDashboardTrend,
  dashboardPeriodLabel,
  dashboardTrendRange,
  summarizeUsageBoardPeriod,
  type DashboardPeriodStats,
  type DashboardTrendSeries
} from '@/components/user/dashboard/dashboardTrends'

const authStore = useAuthStore()
const stats = ref<UserStatsType | null>(null)
const loading = ref(false)
const periodLoading = ref(false)
const statsError = ref('')

const emptyPeriod = (error = ''): DashboardPeriodStats => ({ users: 0, usage: 0, ranking: [], error, rangeLabel: '' })
const emptyTrend = (error = ''): DashboardTrendSeries => ({ points: [], error })
const periodStats = ref({ week: emptyPeriod(), month: emptyPeriod() })
const trends = ref({ week: emptyTrend(), month: emptyTrend() })

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const today = () => new Date()

function boardQuery(kind: 'week' | 'month'): UsageBoardQuery {
  const base = {
    timezone,
    api_key_ids: [],
    group_ids: [],
    sort_order: UsageBoardSortOrder.DESC,
    page: 1,
    page_size: 1000
  }
  if (kind === 'week') {
    const range = dashboardTrendRange('week', today())
    return { ...base, granularity: UsageBoardGranularity.WEEK, start_date: range.startDate, end_date: range.endDate }
  }
  const range = dashboardTrendRange('month', today())
  return { ...base, granularity: UsageBoardGranularity.MONTH, start_month: range.startMonth, end_month: range.endMonth }
}

async function loadStats() {
  loading.value = true
  statsError.value = ''
  try {
    await authStore.refreshUser()
    stats.value = await usageAPI.getDashboardStats()
    return stats.value
  } catch (error) {
    statsError.value = error instanceof Error ? error.message : '仪表盘统计加载失败'
    return null
  } finally {
    loading.value = false
  }
}

async function loadPeriodStats() {
  periodLoading.value = true
  const kinds = ['week', 'month'] as const
  const results = await Promise.allSettled(kinds.map((kind) => getUsageBoard(UsageBoardScope.SELF, boardQuery(kind))))

  for (const [index, kind] of kinds.entries()) {
    const result = results[index]
    if (result.status === 'fulfilled') {
      periodStats.value[kind] = {
        ...summarizeUsageBoardPeriod(result.value),
        rangeLabel: dashboardPeriodLabel(kind, result.value)
      }
      trends.value[kind] = buildDashboardTrend(result.value, kind)
      continue
    }

    const error = result.reason instanceof Error ? result.reason.message : '统计加载失败'
    periodStats.value[kind] = emptyPeriod(error)
    trends.value[kind] = emptyTrend(error)
  }
  periodLoading.value = false
}

async function refreshAll() {
  await Promise.all([loadStats(), loadPeriodStats()])
}

onMounted(() => { void refreshAll() })
</script>
