<script setup lang="ts">
import { useAppStore } from '@/stores/app'

const app = useAppStore()
</script>

<template>
  <div class="toast-viewport" aria-live="polite" aria-relevant="additions removals">
    <article v-for="toast in app.toasts" :key="toast.id" :class="['toast-item', `toast-item--${toast.type}`]">
      <p>{{ toast.message }}</p>
      <button type="button" aria-label="关闭消息" @click="app.hideToast(toast.id)">×</button>
    </article>
  </div>
</template>

<style scoped>
.toast-viewport {
  position: fixed;
  z-index: 80;
  top: 88px;
  right: 18px;
  width: min(380px, calc(100vw - 36px));
  display: grid;
  gap: 9px;
  pointer-events: none;
}
.toast-item {
  min-height: 52px;
  padding: 13px 12px 13px 15px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--surface-raised) 96%, transparent);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--accent);
  border-radius: 12px;
  box-shadow: 0 16px 38px color-mix(in srgb, var(--text-primary) 12%, transparent);
  backdrop-filter: blur(16px);
  pointer-events: auto;
}
.toast-item--success { border-left-color: var(--success); }
.toast-item--error { border-left-color: var(--danger); }
.toast-item p { margin: 0; font-size: 12px; line-height: 1.55; }
.toast-item button { width: 26px; height: 26px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 7px; cursor: pointer; font-size: 18px; line-height: 1; }
.toast-item button:hover { color: var(--text-primary); background: var(--surface-canvas); }
@media (max-width: 640px) { .toast-viewport { top: 74px; } }
</style>
