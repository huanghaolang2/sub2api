<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { sanitizeUrl } from '@shared-utils/url'
import PublicShell from '@/components/layout/PublicShell.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const app = useAppStore()
const auth = useAuthStore()
const settings = computed(() => app.cachedPublicSettings)
const siteName = computed(() => settings.value?.site_name || app.siteName || 'Sub2API')
const subtitle = computed(() => settings.value?.site_subtitle || '统一、安全、可观测的 AI API 网关')
const homeContent = computed(() => settings.value?.home_content?.trim() || '')
const customUrl = computed(() => {
  const value = homeContent.value
  return value.startsWith('https://') || value.startsWith('http://') ? sanitizeUrl(value) : ''
})
const compact = computed(() => settings.value?.compact_home_enabled === true)
const dashboardPath = computed(() => auth.isAdmin ? '/admin/dashboard' : '/app/dashboard')
const primaryPath = computed(() => auth.isAuthenticated ? dashboardPath.value : '/login')
const primaryLabel = computed(() => auth.isAuthenticated ? '进入工作台' : '开始使用')
const docUrl = computed(() => sanitizeUrl(settings.value?.doc_url || app.docUrl || ''))
const apiBase = computed(() => settings.value?.api_base_url || app.apiBaseUrl || `${window.location.origin}/v1`)
const capabilities = computed(() => [
  { label: '模型与价格', detail: '按分组、平台与计费模式比较', enabled: settings.value?.model_plaza_enabled === true, path: '/pricing' },
  { label: 'Key 用量', detail: '无需登录即可验证额度与调用统计', enabled: true, path: '/key-usage' },
  { label: '支付与订阅', detail: '余额、套餐、兑换与订单统一管理', enabled: settings.value?.payment_enabled === true, path: auth.isAuthenticated ? '/app/purchase' : '/login' },
  { label: '渠道状态', detail: '查看可用性、延迟与模型覆盖', enabled: settings.value?.channel_monitor_enabled === true, path: auth.isAuthenticated ? '/app/monitor' : '/login' },
].filter((item) => item.enabled))

onMounted(() => { if (!app.publicSettingsLoaded) void app.fetchPublicSettings() })
</script>

<template>
  <iframe v-if="customUrl" class="custom-home-frame" :src="customUrl" title="自定义首页" allowfullscreen />
  <!-- home_content is an administrator-only trusted customization surface.
       Keep the existing frontend's rendering contract so replacement does not
       strip configured embeds or event attributes. -->
  <main v-else-if="homeContent" class="custom-home-content" v-html="homeContent" />
  <PublicShell v-else-if="compact">
    <section class="compact-home">
      <img :src="app.siteLogo || '/logo.svg'" :alt="`${siteName} 标志`" />
      <p class="eyebrow">AI GATEWAY</p><h1>{{ siteName }}</h1><p>{{ subtitle }}</p>
      <div class="hero__actions"><RouterLink class="button button--primary" :to="primaryPath">{{ primaryLabel }}</RouterLink><a v-if="docUrl" class="button button--secondary" :href="docUrl" target="_blank" rel="noreferrer">阅读文档</a></div>
    </section>
  </PublicShell>
  <PublicShell v-else>
    <section class="home-hero">
      <div class="home-hero__copy">
        <p class="eyebrow">UNIFIED AI GATEWAY</p>
        <h1>{{ siteName }}<br /><span>{{ subtitle }}</span></h1>
        <p>用一套 API 接入多种模型，同时管理密钥、路由、用量、费用和团队权限。所有能力都在同一个工作台下钻完成。</p>
        <div class="hero__actions"><RouterLink class="button button--primary" :to="primaryPath">{{ primaryLabel }}</RouterLink><RouterLink v-if="settings?.model_plaza_enabled" class="button button--secondary" to="/pricing">查看模型价格</RouterLink><RouterLink v-if="!auth.isAuthenticated && settings?.registration_enabled" class="button button--ghost" to="/register">创建账号</RouterLink></div>
      </div>
      <aside class="gateway-code" aria-label="API 接入示例"><header><span /><span /><span /><strong>quickstart.sh</strong></header><pre><code><b>curl</b> {{ apiBase }}/chat/completions \
  -H <i>"Authorization: Bearer $API_KEY"</i> \
  -d '{ "model": "your-model", ... }'</code></pre><footer><span>统一鉴权</span><span>自动路由</span><span>实时计费</span></footer></aside>
    </section>

    <section class="home-capabilities">
      <header><p class="eyebrow">WHAT YOU CAN DO</p><h2>从接入到治理，一条路径完成</h2><p>入口随管理员配置显示，不展示尚未开放的业务能力。</p></header>
      <div class="home-capability-grid"><RouterLink v-for="(item, index) in capabilities" :key="item.label" :to="item.path"><span>0{{ index + 1 }}</span><h3>{{ item.label }}</h3><p>{{ item.detail }}</p><strong>打开 →</strong></RouterLink></div>
    </section>

    <section class="home-operating-strip"><div><span>API Base</span><strong>{{ apiBase }}</strong></div><div><span>当前版本</span><strong>{{ settings?.version || '由服务端管理' }}</strong></div><div><span>支持入口</span><strong>{{ settings?.contact_info || '请联系平台管理员' }}</strong></div><a v-if="docUrl" :href="docUrl" target="_blank" rel="noreferrer">打开开发文档 ↗</a></section>
  </PublicShell>
</template>
