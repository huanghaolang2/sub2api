<script setup lang="ts">
import AppLayout from '@/components/layout/AppLayout.vue'
import UsageBoardPanel from '@/components/usage-board/UsageBoardPanel.vue'
import { UsageBoardScope } from '@/api/usageBoard'
</script>
<template><AppLayout><UsageBoardPanel :scope="UsageBoardScope.SELF" /></AppLayout></template>
