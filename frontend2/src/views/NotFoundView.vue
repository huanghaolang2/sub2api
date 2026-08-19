<script setup lang="ts">
import { computed } from 'vue'
import PublicShell from '@/components/layout/PublicShell.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const app = useAppStore()
const auth = useAuthStore()
const returnPath = computed(() => auth.isAuthenticated ? (auth.isAdmin ? '/admin/dashboard' : '/app/dashboard') : '/')
const returnLabel = computed(() => auth.isAuthenticated ? (auth.isAdmin ? '返回平台概览' : '返回我的概览') : '返回首页')
</script>

<template>
  <PublicShell>
    <main class="not-found-page"><div><p class="eyebrow">404 · {{ app.siteName }}</p><h1>这条路径<br />没有对应页面。</h1><p>地址可能已经变更，或当前账号没有可用的深链入口。你可以回到已知页面继续，不会丢失登录状态。</p><div class="hero__actions"><RouterLink class="button button--primary" :to="returnPath">{{ returnLabel }}</RouterLink><button class="button button--secondary" @click="$router.back()">返回上一页</button></div></div><span aria-hidden="true">404</span></main>
  </PublicShell>
</template>
