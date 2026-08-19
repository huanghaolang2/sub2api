<script setup lang="ts">
import { computed } from 'vue'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import LegacyMonitorPanel from '@/components/user/monitor/LegacyMonitorPanel.vue'
import RealtimeMonitorPanel from '@/components/user/monitor/RealtimeMonitorPanel.vue'
import { getChannelMonitorMode } from '@/utils/featureFlags'

const mode = computed(() => getChannelMonitorMode())
</script>

<template>
  <ConsoleShell>
    <LegacyMonitorPanel v-if="mode === 'v1'" />
    <RealtimeMonitorPanel v-else />
  </ConsoleShell>
</template>
