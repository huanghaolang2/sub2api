<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DOMPurify from 'dompurify'
import AnnouncementCenter from '@/components/base/AnnouncementCenter.vue'
import LocaleSwitcher from '@/components/base/LocaleSwitcher.vue'
import OnboardingTour from '@/components/base/OnboardingTour.vue'
import ThemeSwitcher from '@/components/base/ThemeSwitcher.vue'
import {
  ConsoleAudience,
  ConsoleSection,
  SecondaryNavigationMode,
  consoleSections,
  matchesNavigationPath,
  type ConsoleSectionDefinition,
  type NavigationItem
} from '@/authz/navigation'
import { can } from '@/authz/permissions'
import { RouteFeature } from '@/router/contracts'
import { isRouteFeatureEnabled, prepareRouteFeature } from '@/router/features'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { OnboardingAudience, useOnboardingStore } from '@/stores/onboarding'

const auth = useAuthStore()
const app = useAppStore()
const adminSettings = useAdminSettingsStore()
const route = useRoute()
const router = useRouter()
const onboarding = useOnboardingStore()
const mobileNavigationOpen = ref(false)

function featureEnabled(feature: RouteFeature | undefined): boolean {
  return isRouteFeatureEnabled(feature)
}

const currentAudience = computed(() => {
  if (auth.isAdmin && !route.path.startsWith('/app/')) return ConsoleAudience.ADMIN
  return ConsoleAudience.USER
})

const accessibleSections = computed<ConsoleSectionDefinition[]>(() => consoleSections
  .filter((section) => section.audience === currentAudience.value)
  .map((section) => {
    const items = section.items.filter((item) =>
      can(auth.user?.role ?? null, item.permission) &&
      !(auth.isSimpleMode && item.hideInSimpleMode) &&
      featureEnabled(item.feature)
    )
    const dynamicItems = section.audience === ConsoleAudience.ADMIN && section.id === ConsoleSection.ADMIN_SYSTEM
      ? adminSettings.customMenuItems
          .filter((item) => item.visibility === 'admin')
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((item) => ({ label: item.label, iconSvg: item.icon_svg, to: `/custom/${item.id}`, permission: section.items[0].permission }))
      : section.audience === ConsoleAudience.USER && section.id === ConsoleSection.USER_ACCOUNT
        ? (app.cachedPublicSettings?.custom_menu_items ?? [])
            .filter((item) => item.visibility === 'user')
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((item) => ({ label: item.label, iconSvg: item.icon_svg, to: `/custom/${item.id}`, permission: section.items[0].permission }))
        : []
    return {
      ...section,
      mode: dynamicItems.length > 0 && section.mode === SecondaryNavigationMode.NONE
        ? SecondaryNavigationMode.SIDEBAR
        : section.mode,
      items: [...items, ...dynamicItems]
    }
  })
  .filter((section) => section.items.length > 0))

const currentSection = computed(() => accessibleSections.value.find((section) => section.items.some((item) => matchesNavigationPath(route.path, item))) ?? null)
const currentItems = computed(() => currentSection.value?.items ?? [])
const showContextSidebar = computed(() => currentSection.value?.mode === SecondaryNavigationMode.SIDEBAR && currentItems.value.length > 1)
const showContextTabs = computed(() => currentSection.value?.mode === SecondaryNavigationMode.TABS && currentItems.value.length > 1)
const accountName = computed(() => auth.user?.username.trim() || auth.user?.email.split('@')[0] || '用户')
const brandName = computed(() => app.siteName || 'Sub2API')
const brandLogo = computed(() => app.siteLogo?.trim() || '/logo.svg')
const brandUsesFallback = computed(() => !app.siteLogo?.trim())

function sectionTarget(section: ConsoleSectionDefinition): string {
  const activeItem = section.items.find((item) => matchesNavigationPath(route.path, item))
  if (activeItem) return activeItem.to
  return section.items[0].to
}

function isSectionActive(section: ConsoleSectionDefinition): boolean {
  return currentSection.value?.id === section.id
}

function isItemActive(item: NavigationItem): boolean {
  return matchesNavigationPath(route.path, item)
}

function safeCustomIcon(source: string | undefined): string {
  if (!source) return ''
  return DOMPurify.sanitize(source, { USE_PROFILES: { svg: true, svgFilters: true } })
}

async function signOut(): Promise<void> {
  await auth.logout()
  await router.replace('/login')
}

function replayGuide(): void {
  if (auth.user?.id == null) return
  onboarding.replay(auth.user.id, auth.isAdmin ? OnboardingAudience.ADMIN : OnboardingAudience.USER)
  mobileNavigationOpen.value = false
}

watch(() => route.fullPath, () => { mobileNavigationOpen.value = false })
watch(() => auth.isAdmin, (isAdmin) => {
  if (!isAdmin && route.path.startsWith('/admin')) void router.replace('/app/dashboard')
}, { immediate: true })
onMounted(() => {
  void app.fetchPublicSettings()
  void prepareRouteFeature(RouteFeature.BATCH_IMAGE)
  if (auth.isAdmin) void adminSettings.fetch()
})
</script>

<template>
  <div class="console-shell">
    <header class="console-header">
      <RouterLink class="console-brand" to="/" :aria-label="`${brandName} 首页`">
        <span class="console-brand__mark"><img :class="{ 'is-fallback': brandUsesFallback }" :src="brandLogo" alt=""></span>
        <span>{{ brandName }}</span>
      </RouterLink>

      <nav class="console-primary-nav" aria-label="控制台主导航">
        <RouterLink
          v-for="section in accessibleSections"
          :key="section.id"
          :to="sectionTarget(section)"
          :class="{ 'is-active': isSectionActive(section) }"
        >
          <span class="console-nav-label--full">{{ section.label }}</span>
          <span class="console-nav-label--short">{{ section.shortLabel }}</span>
        </RouterLink>
      </nav>

      <div class="console-header__actions">
        <RouterLink
          v-if="auth.isAdmin"
          class="console-workspace-link"
          :to="currentAudience === ConsoleAudience.ADMIN ? '/app/dashboard' : '/admin/dashboard'"
        >{{ currentAudience === ConsoleAudience.ADMIN ? '个人工作区' : '返回管理端' }}</RouterLink>
        <RouterLink class="console-balance" to="/app/subscriptions">
          <span>可用余额</span>
          <strong>${{ (auth.user?.balance ?? 0).toFixed(2) }}</strong>
        </RouterLink>
        <AnnouncementCenter />
        <LocaleSwitcher />
        <ThemeSwitcher />
        <RouterLink class="console-account" to="/app/profile">
          <span class="console-account__avatar">{{ accountName.slice(0, 2).toUpperCase() }}</span>
          <span class="console-account__copy"><strong>{{ accountName }}</strong><small>{{ auth.isAdmin ? '管理员' : '普通用户' }}</small></span>
        </RouterLink>
        <button type="button" class="console-guide" @click="replayGuide">使用指南</button>
        <button type="button" class="console-signout" @click="signOut">退出</button>
        <button
          type="button"
          class="console-menu-button"
          :aria-expanded="mobileNavigationOpen"
          aria-controls="console-mobile-navigation"
          @click="mobileNavigationOpen = !mobileNavigationOpen"
        >
          <span /><span /><span />
          <span class="sr-only">打开导航</span>
        </button>
      </div>
    </header>

    <nav
      v-if="mobileNavigationOpen"
      id="console-mobile-navigation"
      class="console-mobile-navigation"
      aria-label="移动端控制台导航"
    >
      <section v-for="section in accessibleSections" :key="section.id">
        <strong>{{ section.label }}</strong>
        <RouterLink
          v-for="item in section.items"
          :key="item.to"
          :to="item.to"
          :class="{ 'is-active': isItemActive(item) }"
        ><span v-if="item.iconSvg" class="console-custom-icon" aria-hidden="true" v-html="safeCustomIcon(item.iconSvg)" />{{ item.label }}</RouterLink>
      </section>
      <section class="console-mobile-account-section">
        <strong>账户</strong>
        <RouterLink to="/app/profile" :class="{ 'is-active': route.path === '/app/profile' }">个人设置</RouterLink>
        <RouterLink v-if="auth.isAdmin" :to="currentAudience === ConsoleAudience.ADMIN ? '/app/dashboard' : '/admin/dashboard'">
          {{ currentAudience === ConsoleAudience.ADMIN ? '个人工作区' : '返回管理端' }}
        </RouterLink>
        <div class="console-mobile-theme"><span>界面语言</span><LocaleSwitcher /></div>
        <div class="console-mobile-theme"><span>界面主题</span><ThemeSwitcher /></div>
        <button type="button" class="console-mobile-guide" @click="replayGuide">重新查看使用指南</button>
        <button type="button" @click="signOut">退出登录</button>
      </section>
    </nav>

    <div class="console-body" :class="{ 'console-body--with-sidebar': showContextSidebar }">
      <aside v-if="showContextSidebar" class="console-context-sidebar">
        <div><span>当前板块</span><strong>{{ currentSection?.label }}</strong></div>
        <nav :aria-label="`${currentSection?.label}二级导航`">
          <RouterLink
            v-for="item in currentItems"
            :key="item.to"
            :to="item.to"
            :class="{ 'is-active': isItemActive(item) }"
          >
            <span v-if="item.iconSvg" class="console-custom-icon" aria-hidden="true" v-html="safeCustomIcon(item.iconSvg)" />
            <span class="console-nav-label--full">{{ item.label }}</span>
            <span class="console-nav-label--short">{{ item.shortLabel ?? item.label }}</span>
          </RouterLink>
        </nav>
      </aside>

      <main id="main-content" class="console-main" tabindex="-1">
        <nav v-if="showContextTabs" class="console-context-tabs" :aria-label="`${currentSection?.label}二级导航`">
          <RouterLink
            v-for="item in currentItems"
            :key="item.to"
            :to="item.to"
            :class="{ 'is-active': isItemActive(item) }"
          ><span v-if="item.iconSvg" class="console-custom-icon" aria-hidden="true" v-html="safeCustomIcon(item.iconSvg)" />{{ item.label }}</RouterLink>
        </nav>
        <div class="console-content"><slot /></div>
      </main>
    </div>
    <OnboardingTour />
  </div>
</template>

<style scoped>
.console-shell { min-height: 100vh; display: block; color: var(--text-primary); background: var(--surface-canvas); }
.console-header {
  position: sticky;
  z-index: 50;
  top: 0;
  min-height: 72px;
  padding: 0 clamp(20px, 3vw, 46px);
  display: grid;
  grid-template-columns: auto minmax(390px, 1fr) auto;
  align-items: center;
  gap: clamp(22px, 3vw, 48px);
  background: color-mix(in srgb, var(--surface-raised) 94%, transparent);
  border-bottom: 1px solid var(--border-subtle);
  backdrop-filter: blur(16px);
}
.console-brand { display: inline-flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 790; letter-spacing: -.025em; }
.console-brand__mark { width: 34px; height: 34px; display: grid; place-items: center; background: var(--text-primary); border-radius: 10px; }
.console-brand img { width: 22px; height: 22px; object-fit: contain; }
.console-brand img.is-fallback { filter: brightness(0) invert(1); }
.console-primary-nav { min-width: 0; height: 72px; display: flex; align-items: stretch; gap: clamp(4px, 1vw, 16px); }
.console-primary-nav a { position: relative; padding: 0 clamp(8px, 1vw, 14px); display: inline-flex; align-items: center; color: var(--text-secondary); font-size: 13px; font-weight: 650; white-space: nowrap; }
.console-primary-nav a:hover, .console-primary-nav a.is-active { color: var(--text-primary); }
.console-primary-nav a.is-active::after { position: absolute; right: 8px; bottom: -1px; left: 8px; height: 3px; content: ''; background: var(--accent); border-radius: 3px 3px 0 0; }
.console-nav-label--short { display: none; }
.console-header__actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.console-workspace-link { min-height: 34px; padding: 0 10px; display: inline-flex; align-items: center; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; font-size: var(--font-meta); font-weight: 680; white-space: nowrap; }
.console-workspace-link:hover { color: var(--text-primary); border-color: var(--accent); }
.console-balance { padding-right: 14px; display: grid; gap: 2px; border-right: 1px solid var(--border-subtle); line-height: 1.15; }
.console-balance span { color: var(--text-secondary); font-size: var(--font-meta); }
.console-balance strong { font-size: 13px; font-variant-numeric: tabular-nums; }
.console-header :deep(.theme-switcher select) { width: 104px; min-height: 36px; padding-left: 9px; border-radius: 9px; font-size: var(--font-body-sm); }
.console-header :deep(.locale-switcher select) { width: 78px; min-height: 36px; padding-left: 9px; border-radius: 9px; font-size: var(--font-body-sm); }
.console-account { display: grid; grid-template-columns: 34px auto; align-items: center; gap: 9px; }
.console-account__avatar { width: 34px; height: 34px; display: grid; place-items: center; color: white; background: var(--accent); border-radius: 11px; font-size: var(--font-meta); font-weight: 800; }
.console-account__copy { min-width: 0; display: grid; gap: 1px; }
.console-account__copy strong { max-width: 82px; overflow: hidden; font-size: var(--font-body-sm); text-overflow: ellipsis; white-space: nowrap; }
.console-account__copy small { color: var(--text-secondary); font-size: var(--font-meta); }
.console-signout, .console-guide { min-height: 34px; padding: 0 9px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-body-sm); }
.console-guide:hover { color: var(--accent); background: var(--accent-soft); }
.console-signout:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); }
.console-menu-button { width: 38px; height: 38px; padding: 9px; display: none; align-content: center; gap: 4px; background: transparent; border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; }
.console-menu-button > span:not(.sr-only) { height: 1.5px; background: var(--text-primary); border-radius: 2px; }
.console-mobile-navigation { display: none; }
.console-body { min-height: calc(100vh - 72px); display: grid; grid-template-columns: minmax(0, 1fr); }
.console-body--with-sidebar { grid-template-columns: 208px minmax(0, 1fr); }
.console-context-sidebar { position: sticky; top: 72px; height: calc(100vh - 72px); padding: 30px 18px; background: var(--surface-raised); border-right: 1px solid var(--border-subtle); }
.console-context-sidebar > div { padding: 0 11px 20px; display: grid; gap: 4px; border-bottom: 1px solid var(--border-subtle); }
.console-context-sidebar > div span { color: var(--text-secondary); font-size: var(--font-meta); font-weight: 720; letter-spacing: .1em; }
.console-context-sidebar > div strong { font-size: 16px; letter-spacing: -.02em; }
.console-context-sidebar nav { margin-top: 18px; display: grid; gap: 4px; }
.console-context-sidebar nav a { min-height: 40px; padding: 0 11px; display: flex; align-items: center; color: var(--text-secondary); border-radius: 9px; font-size: 12px; font-weight: 620; }
.console-custom-icon { width: 17px; height: 17px; margin-right: 8px; display: inline-grid; flex: 0 0 auto; place-items: center; color: currentColor; }
.console-custom-icon :deep(svg) { width: 100%; height: 100%; display: block; fill: none; stroke: currentColor; }
.console-context-sidebar nav a:hover, .console-context-sidebar nav a.is-active { color: var(--text-primary); background: var(--accent-soft); }
.console-main { min-width: 0; }
.console-context-tabs { min-height: 54px; padding: 0 clamp(24px, 3vw, 42px); display: flex; align-items: flex-end; gap: 22px; background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle); }
.console-context-tabs a { position: relative; padding: 0 2px 15px; color: var(--text-secondary); font-size: 12px; font-weight: 650; }
.console-context-tabs a.is-active { color: var(--text-primary); }
.console-context-tabs a.is-active::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; content: ''; background: var(--accent); }
.console-content { width: 100%; padding: 42px clamp(24px, 3vw, 48px) 80px; }

@media (max-width: 1540px) {
  .console-header { grid-template-columns: auto minmax(290px, 1fr) auto; gap: 18px; }
  .console-primary-nav { gap: 1px; }
  .console-primary-nav a { padding-inline: 9px; }
  .console-nav-label--full { display: none; }
  .console-nav-label--short { display: inline; }
  .console-account__copy { display: none; }
  .console-account { grid-template-columns: 34px; }
  .console-body--with-sidebar { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); align-content: start; }
  .console-context-sidebar { position: sticky; z-index: 30; top: 72px; width: 100%; height: auto; padding: 0 clamp(24px, 3vw, 38px); display: flex; align-items: stretch; background: var(--surface-raised); border-right: 0; border-bottom: 1px solid var(--border-subtle); }
  .console-context-sidebar > div { display: none; }
  .console-context-sidebar nav { min-height: 50px; margin: 0; display: flex; align-items: stretch; gap: 18px; }
  .console-context-sidebar nav a { position: relative; min-height: 50px; padding: 0 2px; border-radius: 0; font-size: var(--font-body-sm); }
  .console-context-sidebar nav a:hover, .console-context-sidebar nav a.is-active { background: transparent; }
  .console-context-sidebar nav a.is-active::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; content: ''; background: var(--accent); }
}

@media (max-width: 1180px) {
  .console-workspace-link, .console-guide { display: none; }
}

@media (max-width: 900px) {
  .console-header { min-height: 64px; grid-template-columns: auto 1fr; }
  .console-primary-nav { display: none; }
  .console-header__actions { justify-self: end; }
  .console-workspace-link, .console-balance span, .console-account, .console-header :deep(.theme-switcher), .console-header :deep(.locale-switcher), .console-guide, .console-signout { display: none; }
  .console-menu-button { display: grid; }
  .console-mobile-navigation { position: fixed; z-index: 45; top: 64px; right: 0; bottom: 0; left: 0; padding: 18px 20px 42px; display: grid; align-content: start; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; overflow-y: auto; background: var(--surface-canvas); }
  .console-mobile-navigation section { padding: 15px; display: grid; align-content: start; gap: 3px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 13px; }
  .console-mobile-navigation section strong { margin-bottom: 7px; font-size: var(--font-body-sm); }
  .console-mobile-navigation a { min-height: 34px; padding: 0 9px; display: flex; align-items: center; color: var(--text-secondary); border-radius: 8px; font-size: var(--font-body-sm); }
  .console-mobile-navigation a.is-active { color: var(--text-primary); background: var(--accent-soft); }
  .console-mobile-account-section { gap: 6px !important; }
  .console-mobile-theme { min-height: 38px; padding: 0 9px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--text-secondary); font-size: var(--font-body-sm); }
  .console-mobile-theme :deep(.theme-switcher select) { width: 112px; min-height: 34px; padding: 0 28px 0 9px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: var(--font-body-sm); }
  .console-mobile-account-section > button { min-height: 36px; padding: 0 9px; color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-body-sm); font-weight: 650; text-align: left; }
  .console-mobile-account-section > .console-mobile-guide { color: var(--accent); background: var(--accent-soft); }
  .console-context-sidebar { top: 64px; padding-inline: 20px; overflow-x: auto; }
  .console-context-sidebar nav { gap: 16px; }
  .console-content { padding: 32px 20px 70px; }
}

@media (max-width: 560px) {
  .console-brand > span:last-child { display: none; }
  .console-mobile-navigation { grid-template-columns: 1fr; }
  .console-balance { padding-right: 8px; }
  .console-context-tabs { padding-inline: 20px; }
}
</style>
