<script setup lang="ts">
import PublicShell from '@/components/layout/PublicShell.vue'
import PricingExplorer from '@/features/pricing/PricingExplorer.vue'
</script>

<template>
  <PublicShell>
    <section class="page-intro pricing-intro">
      <p class="eyebrow">MODEL PRICING</p>
      <h1>透明定价，按实际用量付费。</h1>
      <p>搜索并比较当前开放模型的输入、输出和缓存价格。最终可用范围以控制台和账号分组为准。</p>
    </section>
    <PricingExplorer />
  </PublicShell>
</template>
