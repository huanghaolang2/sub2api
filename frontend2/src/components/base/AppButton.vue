<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'ghost'; disabled?: boolean }>(), {
  variant: 'primary',
  disabled: false
})
</script>

<template>
  <button class="button" :class="`button--${variant}`" :disabled="disabled"><slot /></button>
</template>
