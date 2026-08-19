<script setup lang="ts">
import { computed, ref } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { UserAnnouncement } from '@/types'
import SurfaceDialog from './SurfaceDialog.vue'
import { DialogWidth } from './dialog'
import { useAnnouncementStore } from '@/stores/announcements'
import { useAppStore } from '@/stores/app'

const announcements = useAnnouncementStore()
const app = useAppStore()
const open = ref(false)
const selected = ref<UserAnnouncement | null>(null)
const renderedContent = computed(() => DOMPurify.sanitize(marked.parse(selected.value?.content || '', { gfm: true, breaks: true }) as string))

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

async function showCenter(): Promise<void> {
  selected.value = null
  open.value = true
  await announcements.fetchAnnouncements(true)
}

async function showDetail(item: UserAnnouncement): Promise<void> {
  selected.value = item
  if (!item.read_at) {
    try { await announcements.markAsRead(item.id) }
    catch (caught) { app.showError((caught as { message?: string }).message || '公告已打开，但标记已读失败') }
  }
}

async function markAll(): Promise<void> {
  try { await announcements.markAllAsRead(); app.showSuccess('全部公告已标记为已读') }
  catch (caught) { app.showError((caught as { message?: string }).message || '标记全部已读失败') }
}

function close(): void { open.value = false; selected.value = null }
</script>

<template>
  <button type="button" class="announcement-trigger" :aria-label="`公告中心，${announcements.unreadCount} 条未读`" @click="showCenter">
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
    <span v-if="announcements.unreadCount" class="announcement-trigger__badge">{{ announcements.unreadCount > 99 ? '99+' : announcements.unreadCount }}</span>
  </button>

  <SurfaceDialog :show="open" :title="selected ? selected.title : '公告中心'" :description="selected ? formatDate(selected.created_at) : `${announcements.unreadCount} 条未读 · 最近 ${announcements.announcements.length} 条`" :width="DialogWidth.WIDE" @close="close">
    <template v-if="selected">
      <button type="button" class="announcement-back" @click="selected = null">← 返回公告列表</button>
      <article class="announcement-center__content" v-html="renderedContent" />
    </template>
    <div v-else-if="announcements.loading" class="announcement-center__state" role="status">正在加载公告…</div>
    <div v-else-if="!announcements.announcements.length" class="announcement-center__state"><strong>暂无公告</strong><span>新的站内通知会显示在这里。</span></div>
    <div v-else class="announcement-center__list">
      <button v-for="item in announcements.announcements" :key="item.id" type="button" :class="{ 'is-unread': !item.read_at }" @click="showDetail(item)">
        <span class="announcement-center__mark" aria-hidden="true">{{ item.read_at ? '✓' : '!' }}</span>
        <span><strong>{{ item.title }}</strong><small>{{ formatDate(item.created_at) }}</small></span>
        <em v-if="!item.read_at">未读</em><i aria-hidden="true">→</i>
      </button>
    </div>
    <template #footer><button v-if="!selected && announcements.unreadCount" type="button" class="button button--secondary" :disabled="announcements.loading" @click="markAll">全部标记已读</button><button type="button" class="button button--primary" @click="selected ? (selected = null) : close()">{{ selected ? '返回列表' : '关闭' }}</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.announcement-trigger { position: relative; width: 36px; height: 36px; padding: 8px; display: grid; place-items: center; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 9px; cursor: pointer; }.announcement-trigger:hover { color: var(--text-primary); background: var(--surface-canvas); border-color: var(--border-subtle); }.announcement-trigger svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }.announcement-trigger__badge { position: absolute; top: -3px; right: -5px; min-width: 17px; height: 17px; padding: 0 4px; display: grid; place-items: center; color: white; background: var(--danger); border: 2px solid var(--surface-raised); border-radius: 9px; font-size: var(--font-caption); font-weight: 800; }.announcement-back { margin-bottom: 16px; padding: 0; color: var(--accent); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }.announcement-center__state { min-height: 250px; display: grid; place-content: center; gap: 7px; color: var(--text-secondary); text-align: center; }.announcement-center__state strong { color: var(--text-primary); font-size: 17px; }.announcement-center__list { display: grid; }.announcement-center__list > button { min-height: 72px; padding: 13px 9px; display: grid; grid-template-columns: 38px minmax(0, 1fr) auto auto; align-items: center; gap: 11px; color: var(--text-primary); text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--border-subtle); cursor: pointer; }.announcement-center__list > button:hover { background: var(--surface-canvas); }.announcement-center__list > button.is-unread { background: color-mix(in srgb, var(--accent) 5%, transparent); }.announcement-center__mark { width: 36px; height: 36px; display: grid; place-items: center; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 10px; font-size: var(--font-body-sm); font-weight: 800; }.is-unread .announcement-center__mark { color: white; background: var(--accent); }.announcement-center__list button > span:nth-child(2) { min-width: 0; display: grid; gap: 5px; }.announcement-center__list strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.announcement-center__list small { color: var(--text-secondary); font-size: var(--font-meta); }.announcement-center__list em { color: var(--accent); font-size: var(--font-meta); font-style: normal; font-weight: 750; }.announcement-center__list i { color: var(--text-secondary); font-size: 15px; font-style: normal; }.announcement-center__content { min-height: 240px; color: var(--text-secondary); font-size: 13px; line-height: 1.85; overflow-wrap: anywhere; }.announcement-center__content :deep(h1), .announcement-center__content :deep(h2), .announcement-center__content :deep(h3) { margin: 1.2em 0 .5em; color: var(--text-primary); line-height: 1.25; }.announcement-center__content :deep(a) { color: var(--accent); text-decoration: underline; }.announcement-center__content :deep(img) { max-width: 100%; border-radius: 10px; }.announcement-center__content :deep(pre) { padding: 12px; overflow-x: auto; background: var(--surface-canvas); border-radius: 9px; }.announcement-center__content :deep(code) { padding: .15em .35em; background: var(--surface-canvas); border-radius: 5px; }.announcement-center__content :deep(pre code) { padding: 0; }.announcement-center__content :deep(table) { width: 100%; border-collapse: collapse; }.announcement-center__content :deep(th), .announcement-center__content :deep(td) { padding: 8px 10px; border: 1px solid var(--border-subtle); text-align: left; }
@media (max-width: 560px) { .announcement-center__list > button { grid-template-columns: 34px minmax(0, 1fr) auto; }.announcement-center__list em { display: none; } }
</style>
