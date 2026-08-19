<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { buildApiUrl } from '@shared-api/client'
import { buildEmbeddedUrl, detectTheme } from '@shared-utils/embedded-url'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

interface TocItem {
  id: string
  text: string
  level: number
}

enum CustomPageMode {
  MARKDOWN = 'markdown',
  EMBED = 'embed',
  INVALID = 'invalid'
}

const route = useRoute()
const { locale } = useI18n()
const app = useAppStore()
const auth = useAuthStore()
const adminSettings = useAdminSettingsStore()
const loading = ref(false)
const error = ref('')
const renderedHtml = ref('')
const toc = ref<TocItem[]>([])
const settingsLoading = ref(false)
const tocVisible = ref(typeof window === 'undefined' || window.innerWidth > 760)
const activeHeading = ref('')
const content = ref<HTMLElement | null>(null)
const pageTheme = ref<'light' | 'dark'>('light')
let observer: MutationObserver | null = null
let scrollFrame = 0

const menuId = computed(() => String(route.params.id || ''))
const menuItem = computed(() => {
  const item = (app.cachedPublicSettings?.custom_menu_items || [])
    .find((candidate) => candidate.id === menuId.value && candidate.visibility === 'user')
  if (item) return item
  return auth.isAdmin
    ? adminSettings.customMenuItems.find((candidate) => candidate.id === menuId.value && candidate.visibility === 'admin') || null
    : null
})
const menuIcon = computed(() => DOMPurify.sanitize(menuItem.value?.icon_svg || '', {
  USE_PROFILES: { svg: true, svgFilters: true }
}))
const markdownSlug = computed(() => {
  if (!menuItem.value) return ''
  return menuItem.value.page_slug || (menuItem.value.url?.startsWith('md:') ? menuItem.value.url.slice(3) : '')
})
const embeddedUrl = computed(() => !menuItem.value || markdownSlug.value ? '' : buildEmbeddedUrl(
  menuItem.value.url,
  auth.user?.id,
  auth.token,
  pageTheme.value,
  locale.value
))
const mode = computed(() => {
  if (markdownSlug.value) return CustomPageMode.MARKDOWN
  if (embeddedUrl.value.startsWith('http://') || embeddedUrl.value.startsWith('https://')) return CustomPageMode.EMBED
  return CustomPageMode.INVALID
})

function headingId(text: string, index: number): string {
  const value = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
  return value ? `${value}-${index}` : `heading-${index}`
}

function relativeAsset(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('/')) return false
  const path = trimmed.split(/[?#]/, 1)[0] || ''
  return path.split('/').filter((part) => part && part !== '.').every((part) => part !== '..' && !part.includes('\\'))
}

function imageUrl(slug: string, source: string): string {
  const match = source.trim().match(/^([^?#]*)(.*)$/)
  const path = match?.[1] || ''
  const suffix = match?.[2] || ''
  const encoded = path.split('/').filter((part) => part && part !== '.').map(encodeURIComponent).join('/')
  return buildApiUrl(`/pages/${encodeURIComponent(slug)}/images/${encoded}${suffix}`)
}

async function renderMarkdown(slug: string): Promise<void> {
  loading.value = true
  error.value = ''
  toc.value = []
  activeHeading.value = ''
  let rendered = false
  try {
    const response = await fetch(buildApiUrl(`/pages/${encodeURIComponent(slug)}`), {
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {}
    })
    if (!response.ok) throw new Error(response.status === 404 ? '页面内容不存在' : '页面内容加载失败')
    const raw = (await response.text()).replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (match, alt: string, source: string) => relativeAsset(source) ? `![${alt}](${imageUrl(slug, source)})` : match
    )
    const clean = DOMPurify.sanitize(marked.parse(raw) as string, {
      ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'frameborder', 'src']
    })
    let index = 0
    const entries: TocItem[] = []
    renderedHtml.value = clean.replace(/<(h[1-4])[^>]*>(.*?)<\/h[1-4]>/gi, (_, tag: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim()
      const id = headingId(text, index++)
      entries.push({ id, text, level: Number(tag[1]) })
      return `<${tag} id="${id}">${inner}</${tag}>`
    })
    toc.value = entries
    rendered = true
  } catch (caught) {
    error.value = (caught as { message?: string }).message || '页面内容加载失败'
    renderedHtml.value = ''
  } finally { loading.value = false }
  if (rendered) {
    await nextTick()
    installCopyButtons()
  }
}

function installCopyButtons(): void {
  content.value?.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.custom-copy-button')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'custom-copy-button'
    button.textContent = '复制'
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent || '')
        button.textContent = '已复制'
        window.setTimeout(() => { button.textContent = '复制' }, 1500)
      } catch { button.textContent = '复制失败' }
    })
    pre.appendChild(button)
  })
}

function scrollTo(id: string): void {
  const element = content.value?.querySelector(`#${CSS.escape(id)}`)
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeHeading.value = id
  if (window.innerWidth <= 640) tocVisible.value = false
}

function updateActiveHeading(): void {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    if (!content.value) return
    const top = content.value.getBoundingClientRect().top
    let current = ''
    toc.value.forEach((entry) => {
      const element = content.value?.querySelector(`#${CSS.escape(entry.id)}`)
      if (element && element.getBoundingClientRect().top - top <= 100) current = entry.id
    })
    activeHeading.value = current
  })
}

async function initialize(): Promise<void> {
  settingsLoading.value = true
  error.value = ''
  try {
    if (!app.publicSettingsLoaded) await app.fetchPublicSettings()
    if (auth.isAdmin && !adminSettings.loaded) await adminSettings.fetch()
  } catch (caught) {
    error.value = (caught as { message?: string }).message || '页面配置加载失败'
  } finally {
    settingsLoading.value = false
  }
}

watch(markdownSlug, (value) => {
  if (value) void renderMarkdown(value)
  else { renderedHtml.value = ''; toc.value = []; error.value = '' }
}, { immediate: true })
watch(menuItem, (value) => {
  if (value?.label) document.title = `${value.label} · ${app.siteName}`
}, { immediate: true })
onMounted(() => {
  pageTheme.value = detectTheme()
  observer = new MutationObserver(() => { pageTheme.value = detectTheme() })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  void initialize()
})
onUnmounted(() => {
  observer?.disconnect()
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
})
</script>

<template>
  <ConsoleShell>
    <div class="custom-page">
      <header class="custom-heading"><div class="custom-heading__identity"><span v-if="menuIcon" class="custom-heading__icon" aria-hidden="true" v-html="menuIcon" /><div><p>CUSTOM CONTENT</p><h1>{{ menuItem?.label || '自定义页面' }}</h1><span v-if="menuItem">{{ mode === CustomPageMode.MARKDOWN ? '站内文档' : '嵌入式应用' }}</span></div></div><a v-if="mode === CustomPageMode.EMBED" class="button button--secondary" :href="embeddedUrl" target="_blank" rel="noopener noreferrer">新窗口打开</a></header>
      <section v-if="settingsLoading || loading" class="custom-state" role="status">正在加载页面…</section>
      <section v-else-if="error" class="custom-state custom-state--error" role="alert"><strong>{{ error }}</strong><button class="button button--secondary" type="button" @click="initialize">重试</button></section>
      <section v-else-if="!menuItem" class="custom-state"><strong>页面不存在或对当前用户不可见</strong><span>请从导航中重新选择自定义页面。</span></section>
      <section v-else-if="mode === CustomPageMode.MARKDOWN" class="markdown-layout">
        <aside v-if="tocVisible && toc.length"><header><strong>本页目录</strong><button type="button" aria-label="收起目录" @click="tocVisible = false">×</button></header><nav><button v-for="item in toc" :key="item.id" type="button" :class="[`level-${item.level}`, { active: activeHeading === item.id }]" @click="scrollTo(item.id)">{{ item.text }}</button></nav></aside>
        <button v-else-if="toc.length" class="toc-toggle" type="button" @click="tocVisible = true">打开目录</button>
        <article ref="content" class="markdown-content" @scroll="updateActiveHeading" v-html="renderedHtml" />
      </section>
      <section v-else-if="mode === CustomPageMode.EMBED" class="embed-shell"><iframe :src="embeddedUrl" :title="menuItem.label" allowfullscreen /></section>
      <section v-else class="custom-state"><strong>页面尚未配置</strong><span>管理员需要配置 HTTPS 地址或 Markdown 页面标识。</span></section>
    </div>
  </ConsoleShell>
</template>

<style scoped>
.custom-page { width: min(1440px, 100%); min-height: calc(100vh - 190px); margin: 0 auto; display: grid; grid-template-rows: auto minmax(560px, 1fr); }.custom-heading { margin-bottom: 18px; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }.custom-heading__identity { min-width: 0; display: flex; align-items: center; gap: 14px; }.custom-heading__icon { width: 48px; height: 48px; display: grid; flex: 0 0 auto; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 14px; }.custom-heading__icon :deep(svg) { width: 25px; height: 25px; display: block; fill: none; stroke: currentColor; }.custom-heading p { margin: 0 0 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .1em; }.custom-heading h1 { font-size: clamp(38px, 4vw, 58px); }.custom-heading__identity > div > span { margin-top: 9px; display: block; color: var(--text-secondary); font-size: var(--font-meta); }.custom-state { min-height: 520px; display: grid; place-content: center; justify-items: center; gap: 9px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; font-size: var(--font-meta); text-align: center; }.custom-state strong { color: var(--text-primary); font-size: 14px; }.custom-state--error strong { color: var(--danger); }.markdown-layout { min-height: 0; display: grid; grid-template-columns: 230px minmax(0, 1fr); overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }.markdown-layout > aside { min-height: 0; display: grid; grid-template-rows: auto 1fr; border-right: 1px solid var(--border-subtle); }.markdown-layout aside header { min-height: 60px; padding: 0 17px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); }.markdown-layout aside header strong { font-size: var(--font-meta); }.markdown-layout aside header button { color: var(--text-secondary); background: transparent; border: 0; cursor: pointer; }.markdown-layout aside nav { padding: 12px; display: grid; align-content: start; gap: 2px; overflow-y: auto; }.markdown-layout aside nav button { min-height: 33px; padding: 0 8px; overflow: hidden; color: var(--text-secondary); background: transparent; border: 0; border-radius: 7px; cursor: pointer; font-size: var(--font-meta); text-align: left; text-overflow: ellipsis; white-space: nowrap; }.markdown-layout aside nav button:hover, .markdown-layout aside nav button.active { color: var(--text-primary); background: var(--accent-soft); }.markdown-layout aside nav button.level-2 { padding-left: 15px; }.markdown-layout aside nav button.level-3 { padding-left: 23px; }.markdown-layout aside nav button.level-4 { padding-left: 31px; }.toc-toggle { position: absolute; z-index: 3; margin: 14px; min-height: 34px; padding: 0 9px; color: var(--accent); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.markdown-content { min-width: 0; padding: clamp(28px, 5vw, 72px); overflow: auto; font-size: 12px; line-height: 1.75; }.markdown-content :deep(h1), .markdown-content :deep(h2), .markdown-content :deep(h3), .markdown-content :deep(h4) { scroll-margin-top: 20px; letter-spacing: -.03em; }.markdown-content :deep(h1) { margin: 0 0 26px; font-size: 36px; }.markdown-content :deep(h2) { margin: 42px 0 15px; padding-top: 10px; border-top: 1px solid var(--border-subtle); font-size: 24px; }.markdown-content :deep(h3) { margin: 30px 0 12px; font-size: 18px; }.markdown-content :deep(a) { color: var(--accent); text-decoration: underline; }.markdown-content :deep(code) { padding: 2px 5px; background: var(--surface-canvas); border-radius: 4px; font-size: .9em; }.markdown-content :deep(pre) { position: relative; padding: 20px; overflow-x: auto; color: #f7f7fb; background: #17151e; border-radius: 11px; }.markdown-content :deep(pre code) { padding: 0; background: transparent; }.markdown-content :deep(.custom-copy-button) { position: absolute; top: 8px; right: 8px; min-height: 28px; padding: 0 7px; color: #d9d7e2; background: #2a2733; border: 1px solid #3b3746; border-radius: 6px; cursor: pointer; font-size: var(--font-caption); }.markdown-content :deep(img) { max-width: 100%; height: auto; border-radius: 10px; }.markdown-content :deep(table) { width: 100%; border-collapse: collapse; }.markdown-content :deep(th), .markdown-content :deep(td) { padding: 9px; border: 1px solid var(--border-subtle); text-align: left; }.embed-shell { min-height: 640px; overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 16px; }.embed-shell iframe { width: 100%; height: 100%; min-height: 640px; border: 0; }
@media (max-width: 760px) { .custom-page { grid-template-rows: auto minmax(480px, 1fr); }.custom-heading { align-items: stretch; flex-direction: column; }.custom-heading a { justify-content: center; }.markdown-layout { grid-template-columns: 1fr; }.markdown-layout > aside { position: absolute; z-index: 4; width: min(280px, calc(100vw - 40px)); height: 70vh; margin: 12px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 12px; box-shadow: 0 20px 50px rgb(10 8 18 / 18%); }.markdown-content { padding: 62px 22px 34px; } }
</style>
