<script setup lang="ts">
import PublicShell from '@/components/layout/PublicShell.vue'

withDefaults(defineProps<{
  eyebrow?: string
  title: string
  description: string
  compact?: boolean
}>(), {
  eyebrow: 'SECURE ACCESS',
  compact: false,
})
</script>

<template>
  <PublicShell>
    <main :class="['public-auth', compact && 'public-auth--compact']">
      <aside class="public-auth__context">
        <p class="eyebrow">{{ eyebrow }}</p>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
        <div class="public-auth__trust" aria-label="安全说明">
          <span>端到端会话</span>
          <span>敏感值不回显</span>
          <span>异常可恢复</span>
        </div>
      </aside>
      <section class="public-auth__panel">
        <slot />
        <footer v-if="$slots.footer" class="public-auth__footer"><slot name="footer" /></footer>
      </section>
    </main>
  </PublicShell>
</template>
