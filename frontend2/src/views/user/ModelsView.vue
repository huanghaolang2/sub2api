<script setup lang="ts">
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PricingExplorer from '@/features/pricing/PricingExplorer.vue'
</script>
<template><ConsoleShell><div class="page-heading models-heading"><div><p>共享模型广场 · 当前账号可见范围</p><h1>模型与价格</h1><span>按分组呈现基准价、生效倍率、阶梯价和官方参考价，不遗漏任何计费字段。</span></div></div><PricingExplorer /></ConsoleShell></template>
<style scoped>.models-heading > div { max-width: 840px; }.models-heading h1 { font-size: clamp(38px, 5vw, 66px); }.models-heading span { display: block; margin-top: 11px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }</style>
