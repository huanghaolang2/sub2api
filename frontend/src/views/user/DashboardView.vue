<template>
  <AppLayout>
    <div class="space-y-8 pb-10">
      <template v-for="section in sections" :key="section.id">
        <UserDashboardTrends v-if="section.kind === DashboardKind.TREND" :section="section" @retry="retry" />
        <UserDashboardStats v-else-if="section.kind === DashboardKind.TOKEN" :section="section" @retry="retry" />
        <UserDashboardModels v-else :section="section" @retry="retry" />
      </template>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import AppLayout from '@/components/layout/AppLayout.vue'
import UserDashboardTrends from '@/components/user/dashboard/UserDashboardTrends.vue'
import UserDashboardStats from '@/components/user/dashboard/UserDashboardStats.vue'
import UserDashboardModels from '@/components/user/dashboard/UserDashboardModels.vue'
import { DashboardKind, defaultDashboardSections } from '@/components/user/dashboard/dashboardBoards'
import { loadDashboardDependency } from '@/components/user/dashboard/dashboardData'
import { useDashboardBoards } from '@/composables/useDashboardBoards'

const { sections, retry } = useDashboardBoards(defaultDashboardSections, loadDashboardDependency)
</script>
