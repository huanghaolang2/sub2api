<script setup lang="ts">
defineProps<{ loading?: boolean; error?: string; empty?: boolean; emptyText?: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <div v-if="loading" class="page-state" role="status">正在加载…</div>
  <div v-else-if="error" class="page-state page-state--error" role="alert"><p>{{ error }}</p><button class="button button--secondary" type="button" @click="$emit('retry')">重试</button></div>
  <div v-else-if="empty" class="page-state"><p>{{ emptyText || '暂无数据' }}</p><slot name="empty-action" /></div>
  <slot v-else />
</template>
