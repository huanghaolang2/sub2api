<script setup lang="ts">
import { ThemeMode } from '@/constants/theme'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const options = [
  { value: ThemeMode.LIGHT, label: '亮色' },
  { value: ThemeMode.DARK, label: '暗色' },
  { value: ThemeMode.SYSTEM, label: '跟随系统' }
]
</script>

<template>
  <label class="theme-switcher">
    <span class="sr-only">界面主题</span>
    <select :value="theme.mode" aria-label="界面主题" @change="theme.setMode(($event.target as HTMLSelectElement).value as ThemeMode)">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </label>
</template>
