<script setup lang="ts">
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
defineProps<{ title: string; description: string }>()
</script>

<template>
  <ConsoleShell>
    <section class="console-page">
      <p class="eyebrow">CONTROL CENTER</p>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </section>
  </ConsoleShell>
</template>
