<script setup lang="ts">
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import UsageBoardPanel from '@/components/usage-board/UsageBoardPanel.vue'
import { UsageBoardScope } from '@/api/usageBoard'
</script>
<template><ConsoleShell><UsageBoardPanel :scope="UsageBoardScope.SELF" /></ConsoleShell></template>
