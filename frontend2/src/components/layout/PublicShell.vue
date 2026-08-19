<script setup lang="ts">
import { computed, onMounted } from 'vue'
import LocaleSwitcher from '@/components/base/LocaleSwitcher.vue'
import ThemeSwitcher from '@/components/base/ThemeSwitcher.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const app = useAppStore()
const auth = useAuthStore()
const modelPlazaEnabled = computed(() => app.cachedPublicSettings?.model_plaza_enabled === true)
const registrationEnabled = computed(() => app.cachedPublicSettings?.registration_enabled === true)
const docUrl = computed(() => app.cachedPublicSettings?.doc_url || '')
const consolePath = computed(() => auth.isAuthenticated ? (auth.isAdmin ? '/admin/dashboard' : '/app/dashboard') : '/login')
onMounted(() => { void app.fetchPublicSettings() })
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <RouterLink class="brand" to="/" :aria-label="`${app.siteName} 首页`">
        <img :src="app.siteLogo || '/logo.svg'" :alt="`${app.siteName} 标志`" />
        <span>{{ app.siteName }}</span>
      </RouterLink>
      <nav aria-label="主导航">
        <RouterLink to="/">首页</RouterLink>
        <RouterLink v-if="modelPlazaEnabled" to="/pricing">模型与价格</RouterLink>
        <RouterLink to="/key-usage">Key 用量</RouterLink>
        <a v-if="docUrl" :href="docUrl" target="_blank" rel="noreferrer">文档</a>
        <RouterLink v-if="registrationEnabled && !auth.isAuthenticated" to="/register">注册</RouterLink>
        <RouterLink :to="consolePath">{{ auth.isAuthenticated ? '进入工作台' : '登录' }}</RouterLink>
      </nav>
      <div class="site-header__tools"><LocaleSwitcher /><ThemeSwitcher /></div>
    </header>
    <main id="main-content" tabindex="-1"><slot /></main>
  </div>
</template>
