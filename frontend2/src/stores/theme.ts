import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'
import { THEME_STORAGE_KEY, ThemeMode } from '@/constants/theme'

function readThemeMode(): ThemeMode {
  const value = localStorage.getItem(THEME_STORAGE_KEY)
  return Object.values(ThemeMode).includes(value as ThemeMode) ? (value as ThemeMode) : ThemeMode.SYSTEM
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref(readThemeMode())
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(media.matches)
  const resolvedTheme = computed(() =>
    mode.value === ThemeMode.SYSTEM ? (systemDark.value ? ThemeMode.DARK : ThemeMode.LIGHT) : mode.value
  )

  function apply(): void {
    document.documentElement.dataset.theme = resolvedTheme.value
    document.documentElement.style.colorScheme = resolvedTheme.value
  }

  function setMode(value: ThemeMode): void {
    mode.value = value
    localStorage.setItem(THEME_STORAGE_KEY, value)
    apply()
  }

  const onSystemThemeChange = (event: MediaQueryListEvent): void => {
    systemDark.value = event.matches
    if (mode.value === ThemeMode.SYSTEM) apply()
  }
  media.addEventListener('change', onSystemThemeChange)
  onScopeDispose(() => media.removeEventListener('change', onSystemThemeChange))
  apply()

  return { mode, resolvedTheme, setMode }
})
