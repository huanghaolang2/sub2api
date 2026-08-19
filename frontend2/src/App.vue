<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminComplianceDialog from '@/components/admin/AdminComplianceDialog.vue'
import AnnouncementDialog from '@/components/base/AnnouncementDialog.vue'
import ConfirmDialog from '@/components/base/ConfirmDialog.vue'
import NavigationProgress from '@/components/base/NavigationProgress.vue'
import ToastViewport from '@/components/base/ToastViewport.vue'
import { useAdminComplianceStore } from '@/stores/adminCompliance'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAnnouncementStore } from '@/stores/announcements'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useSubscriptionStore } from '@shared-stores/subscriptions'

const app = useAppStore()
const auth = useAuthStore()
const announcements = useAnnouncementStore()
const compliance = useAdminComplianceStore()
const subscriptions = useSubscriptionStore()
const adminSettings = useAdminSettingsStore()
const router = useRouter()
const route = useRoute()
let delayedAnnouncementTimer: number | null = null
let removeAfterEach: (() => void) | null = null
const initialNavigationReady = ref(false)

function safeBrandAsset(value: string): string {
  const candidate = value.trim()
  if (!candidate) return ''
  if (/^(?:\/|\.\/|\.\.\/)/.test(candidate)) return candidate
  try {
    const url = new URL(candidate, window.location.origin)
    return ['http:', 'https:'].includes(url.protocol) || (url.protocol === 'data:' && candidate.startsWith('data:image/')) ? candidate : ''
  } catch { return '' }
}

function updateFavicon(value: string): void {
  const href = safeBrandAsset(value)
  if (!href) return
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
  link.type = href.includes('.svg') ? 'image/svg+xml' : 'image/x-icon'
  link.href = href
}

function updateDocumentTitle(): void {
  const id = typeof route.params.id === 'string' ? route.params.id : ''
  const customItems = [
    ...(app.cachedPublicSettings?.custom_menu_items ?? []),
    ...(auth.isAdmin ? adminSettings.customMenuItems : [])
  ]
  const customTitle = route.name === 'custom-page' && id ? customItems.find((item) => String(item.id) === id)?.label : ''
  const routeTitle = customTitle || (typeof route.meta.title === 'string' ? route.meta.title : '')
  document.title = routeTitle ? `${routeTitle} · ${app.siteName}` : app.siteName
}

function handleComplianceRequired(event: Event): void {
  const detail = (event as CustomEvent<Record<string, string>>).detail
  compliance.requireAcknowledgement(detail)
}

watch(() => app.siteLogo, (logo) => { if (logo) updateFavicon(logo) }, { immediate: true })
watch([
  () => route.fullPath,
  () => app.siteName,
  () => app.cachedPublicSettings?.custom_menu_items,
  () => auth.isAdmin
], updateDocumentTitle, { deep: true, immediate: true })

function refreshVisibleData(): void {
  if (!auth.isAuthenticated || document.visibilityState !== 'visible') return
  void announcements.fetchAnnouncements()
  void subscriptions.fetchActiveSubscriptions()
}

function syncAuthenticatedData(authenticated: boolean, previous?: boolean): void {
  if (delayedAnnouncementTimer) { window.clearTimeout(delayedAnnouncementTimer); delayedAnnouncementTimer = null }
  if (authenticated) {
    void subscriptions.fetchActiveSubscriptions()
    subscriptions.startPolling()
    if (auth.isAdmin) void compliance.fetchStatus().catch(() => undefined)
    if (previous === false) delayedAnnouncementTimer = window.setTimeout(() => void announcements.fetchAnnouncements(true), 3000)
    else void announcements.fetchAnnouncements()
    document.addEventListener('visibilitychange', refreshVisibleData)
  } else {
    subscriptions.clear()
    announcements.reset()
    compliance.reset()
    document.removeEventListener('visibilitychange', refreshVisibleData)
  }
}

watch(() => auth.isAuthenticated, (authenticated, previous) => {
  // checkAuth() restores an origin-local cached user before /auth/me resolves.
  // Do not prefetch protected resources until the first router guard has
  // confirmed (or invalidated) that identity with the shared backend.
  if (!initialNavigationReady.value) return
  syncAuthenticatedData(authenticated, previous)
}, { immediate: true })

onMounted(() => {
  void app.fetchPublicSettings()
  window.addEventListener('admin-compliance-required', handleComplianceRequired)
  void router.isReady().then(() => {
    initialNavigationReady.value = true
    syncAuthenticatedData(auth.isAuthenticated)
  })
  removeAfterEach = router.afterEach(() => {
    updateDocumentTitle()
    if (auth.isAuthenticated) void announcements.fetchAnnouncements()
  })
})
onUnmounted(() => {
  if (delayedAnnouncementTimer) window.clearTimeout(delayedAnnouncementTimer)
  removeAfterEach?.()
  subscriptions.stopPolling()
  document.removeEventListener('visibilitychange', refreshVisibleData)
  window.removeEventListener('admin-compliance-required', handleComplianceRequired)
})
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <NavigationProgress />
  <RouterView />
  <ToastViewport />
  <AnnouncementDialog />
  <ConfirmDialog />
  <AdminComplianceDialog />
</template>
