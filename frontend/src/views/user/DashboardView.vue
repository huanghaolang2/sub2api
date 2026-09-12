<template>
  <AppLayout>
    <div class="space-y-6">
      <div v-if="loading" class="flex items-center justify-center py-12"><LoadingSpinner /></div>
      <div v-else-if="statsError" class="py-12 text-center text-sm text-red-500" role="alert">{{ statsError }}</div>
      <template v-else-if="stats">
        <UserDashboardStats :stats="stats" :loading="loading" :period-stats="periodStats" :period-loading="periodLoading" :error="statsError" />
        <UserDashboardQuickActions />
      </template>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'; import { useAuthStore } from '@/stores/auth'; import { usageAPI, type UserDashboardStats as UserStatsType } from '@/api/usage'
import { getUsageBoard, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder } from '@/api/usageBoard'
import AppLayout from '@/components/layout/AppLayout.vue'; import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import UserDashboardStats from '@/components/user/dashboard/UserDashboardStats.vue'; import UserDashboardQuickActions from '@/components/user/dashboard/UserDashboardQuickActions.vue'
import { formatDateLocalInput } from '@/utils/format'

const authStore = useAuthStore()
const stats = ref<UserStatsType | null>(null); const loading = ref(false); const periodLoading = ref(false); const statsError = ref('')
const periodStats = ref({
  today: { users: 0, usage: 0, ranking: [] as Array<{ name: string; usage: number }>, error: '' },
  week: { users: 0, usage: 0, ranking: [] as Array<{ name: string; usage: number }>, error: '' },
  month: { users: 0, usage: 0, ranking: [] as Array<{ name: string; usage: number }>, error: '' }
})

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const today = () => new Date()
const dateValue = (value: Date) => formatDateLocalInput(value)
const rangeStart = (kind: 'week' | 'month'): string => {
  const now = today()
  if (kind === 'month') return dateValue(new Date(now.getFullYear(), now.getMonth(), 1))
  const mondayOffset = (now.getDay() + 6) % 7
  return dateValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset))
}
const sumBoard = (result: Awaited<ReturnType<typeof getUsageBoard>>) => ({
  users: result.series.filter((series) => series.points.some((point) => point.total_tokens > 0)).length,
  usage: result.series.reduce((sum, series) => sum + series.points.reduce((periodSum, point) => periodSum + point.total_tokens, 0), 0),
  ranking: result.series.map((series) => ({ name: series.api_key_name, usage: series.points.reduce((sum, point) => sum + point.total_tokens, 0) })).filter((item) => item.usage > 0).sort((a, b) => b.usage - a.usage).slice(0, 3)
})

const loadStats = async () => { loading.value = true; statsError.value = ''; try { await authStore.refreshUser(); stats.value = await usageAPI.getDashboardStats(); return stats.value } catch (error) { statsError.value = error instanceof Error ? error.message : '仪表盘统计加载失败'; return null } finally { loading.value = false } }
const loadPeriodStats = async () => {
  periodLoading.value = true
  const end = dateValue(today())
  const ranges = (['today', 'week', 'month'] as const).map((kind) => getUsageBoard(UsageBoardScope.SELF, {
    granularity: kind === 'today' ? UsageBoardGranularity.DAY : kind === 'week' ? UsageBoardGranularity.WEEK : UsageBoardGranularity.MONTH,
    ...(kind === 'today' || kind === 'week' ? { start_date: kind === 'today' ? end : rangeStart('week'), end_date: end } : { start_month: end.slice(0, 7), end_month: end.slice(0, 7) }),
    timezone, api_key_ids: [], group_ids: [], sort_order: UsageBoardSortOrder.DESC, page: 1, page_size: 1000
  }))
  const results = await Promise.allSettled(ranges)
  for (const [index, kind] of (['today', 'week', 'month'] as const).entries()) {
    const result = results[index]
    periodStats.value[kind] = result.status === 'fulfilled'
      ? { ...sumBoard(result.value), error: '' }
      : { users: 0, usage: 0, ranking: [], error: result.reason instanceof Error ? result.reason.message : '统计加载失败' }
  }
  periodLoading.value = false
}
const refreshAll = async () => { await loadStats(); await loadPeriodStats() }

onMounted(() => { void refreshAll() })
</script>
