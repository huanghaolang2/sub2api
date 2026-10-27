<template>
  <DashboardRankingSection class="dashboard-user-stats" :section="section" @retry="$emit('retry', $event)" />
</template>

<script setup lang="ts">
import DashboardRankingSection from './DashboardRankingSection.vue'
import type { DashboardRankingSectionModel } from './dashboardBoards'

defineProps<{ section: DashboardRankingSectionModel }>()
defineEmits<{ (event: 'retry', dependencyKey: string): void }>()
</script>
