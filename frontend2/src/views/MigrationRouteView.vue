<script setup lang="ts">
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PublicShell from '@/components/layout/PublicShell.vue'

defineProps<{
  title: string
  description: string
  publicPage?: boolean
}>()
</script>

<template>
  <component :is="publicPage ? PublicShell : ConsoleShell">
    <section class="console-page migration-route-state">
      <p class="eyebrow">SUB2API</p>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </section>
  </component>
</template>

<style scoped>
.migration-route-state {
  width: min(760px, 100%);
  margin: 0 auto;
  padding-block: clamp(56px, 8vw, 110px);
}
.migration-route-state p:last-child {
  max-width: 62ch;
  color: var(--text-secondary);
  line-height: 1.7;
}
</style>
