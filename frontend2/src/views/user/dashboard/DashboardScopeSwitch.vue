<script setup lang="ts">
defineProps<{ isAdmin: boolean }>()
</script>

<template>
  <div v-if="isAdmin" class="dashboard-scope-switch" aria-label="数据范围">
    <RouterLink to="/app/dashboard" class="is-active">我的概览</RouterLink>
    <RouterLink to="/admin/dashboard">平台概览</RouterLink>
  </div>
  <span v-else class="dashboard-scope-label">我的概览</span>
</template>

<style scoped>
.dashboard-scope-switch { padding: 3px; display: inline-flex; gap: 2px; background: color-mix(in srgb, var(--border-subtle) 58%, transparent); border-radius: 10px; }
.dashboard-scope-switch a { min-height: 32px; padding: 0 13px; display: inline-flex; align-items: center; color: var(--text-secondary); border-radius: 8px; font-size: var(--font-body-sm); font-weight: 680; }
.dashboard-scope-switch a.is-active { color: var(--text-primary); background: var(--surface-raised); box-shadow: 0 1px 3px rgba(24, 20, 34, .08); }
.dashboard-scope-label { padding: 7px 10px; color: var(--accent); background: var(--accent-soft); border-radius: 8px; font-size: var(--font-body-sm); font-weight: 700; }
</style>
