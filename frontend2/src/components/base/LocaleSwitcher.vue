<script setup lang="ts">
import { ref } from 'vue'
import { availableLocales, getLocale, setLocale } from '@/i18n'

const locale = ref(getLocale())

async function changeLocale(): Promise<void> {
  await setLocale(locale.value)
}
</script>

<template>
  <label class="locale-switcher">
    <span class="sr-only">界面语言</span>
    <select v-model="locale" aria-label="界面语言" @change="changeLocale">
      <option v-for="item in availableLocales" :key="item.code" :value="item.code">
        {{ item.name }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.locale-switcher select {
  min-height: 36px;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
}
.locale-switcher select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
