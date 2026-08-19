<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useAnnouncementStore } from '@/stores/announcements'
import { acquireBodyScrollLock } from '@/utils/bodyScrollLock'

const announcements = useAnnouncementStore()
const dialog = ref<HTMLElement | null>(null)
const dismissButton = ref<HTMLButtonElement | null>(null)
let restoreFocusTo: HTMLElement | null = null
let releaseBodyScrollLock: (() => void) | null = null
const publishedAt = computed(() => {
  const value = announcements.currentPopup?.created_at
  if (!value) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
})
const renderedContent = computed(() => DOMPurify.sanitize(marked.parse(announcements.currentPopup?.content || '', { gfm: true, breaks: true }) as string))

function focusableButtons(): HTMLButtonElement[] {
  return [...(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])]
}

function handleKeydown(event: KeyboardEvent): void {
  if (!announcements.currentPopup) return
  if (event.key === 'Escape') { event.preventDefault(); void announcements.dismissPopup(); return }
  if (event.key !== 'Tab') return
  const buttons = focusableButtons()
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (!first || !last) { event.preventDefault(); dialog.value?.focus(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

watch(() => announcements.currentPopup?.id, async (id) => {
  if (id) {
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    releaseBodyScrollLock ||= acquireBodyScrollLock()
    await nextTick()
    dismissButton.value?.focus()
  } else {
    releaseBodyScrollLock?.()
    releaseBodyScrollLock = null
    restoreFocusTo?.focus()
    restoreFocusTo = null
  }
})

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  if (!announcements.currentPopup) return
  restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  releaseBodyScrollLock = acquireBodyScrollLock()
  void nextTick(() => dismissButton.value?.focus())
})
onUnmounted(() => {
  releaseBodyScrollLock?.()
  releaseBodyScrollLock = null
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="announcements.currentPopup" class="announcement-backdrop" role="presentation">
      <section
        ref="dialog"
        class="announcement-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-dialog-title"
        tabindex="-1"
      >
        <header>
          <div><span>站内公告</span><time v-if="publishedAt">{{ publishedAt }}</time></div>
          <button ref="dismissButton" type="button" aria-label="关闭公告" @click="announcements.dismissPopup">×</button>
        </header>
        <h2 id="announcement-dialog-title">{{ announcements.currentPopup.title }}</h2>
        <div class="announcement-dialog__content" v-html="renderedContent" />
        <footer>
          <button type="button" class="button button--primary" @click="announcements.dismissPopup">我知道了</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.announcement-backdrop { position: fixed; z-index: 100; inset: 0; padding: 24px; display: grid; place-items: center; background: color-mix(in srgb, #08070d 65%, transparent); backdrop-filter: blur(7px); }
.announcement-dialog { width: min(620px, 100%); max-height: min(720px, calc(100vh - 48px)); padding: clamp(24px, 4vw, 38px); overflow-y: auto; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 20px; box-shadow: 0 28px 78px rgba(7, 6, 12, .3); }
.announcement-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.announcement-dialog header > div { display: flex; align-items: center; gap: 10px; color: var(--text-secondary); font-size: var(--font-meta); }
.announcement-dialog header span { color: var(--accent); font-weight: 780; letter-spacing: .1em; }
.announcement-dialog header button { width: 34px; height: 34px; color: var(--text-secondary); background: var(--surface-canvas); border: 0; border-radius: 10px; cursor: pointer; font-size: 20px; }
.announcement-dialog h2 { margin: 22px 0 16px; font-size: clamp(26px, 4vw, 38px); line-height: 1.12; letter-spacing: -.045em; }
.announcement-dialog__content { color: var(--text-secondary); font-size: 13px; line-height: 1.85; overflow-wrap: anywhere; }
.announcement-dialog__content :deep(h1), .announcement-dialog__content :deep(h2), .announcement-dialog__content :deep(h3) { margin: 1.25em 0 .55em; color: var(--text-primary); line-height: 1.25; }
.announcement-dialog__content :deep(h1) { font-size: 1.55em; }.announcement-dialog__content :deep(h2) { font-size: 1.35em; }.announcement-dialog__content :deep(h3) { font-size: 1.15em; }
.announcement-dialog__content :deep(p), .announcement-dialog__content :deep(ul), .announcement-dialog__content :deep(ol), .announcement-dialog__content :deep(blockquote), .announcement-dialog__content :deep(pre), .announcement-dialog__content :deep(table) { margin: .8em 0; }
.announcement-dialog__content :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }.announcement-dialog__content :deep(img) { max-width: 100%; height: auto; border-radius: 10px; }.announcement-dialog__content :deep(blockquote) { padding-left: 14px; border-left: 3px solid var(--accent); }.announcement-dialog__content :deep(code) { padding: .15em .35em; background: var(--surface-canvas); border-radius: 5px; }.announcement-dialog__content :deep(pre) { padding: 12px; overflow-x: auto; background: var(--surface-canvas); border-radius: 9px; }.announcement-dialog__content :deep(pre code) { padding: 0; background: transparent; }.announcement-dialog__content :deep(table) { width: 100%; border-collapse: collapse; }.announcement-dialog__content :deep(th), .announcement-dialog__content :deep(td) { padding: 8px 10px; border: 1px solid var(--border-subtle); text-align: left; }
.announcement-dialog footer { margin-top: 28px; display: flex; justify-content: flex-end; }
</style>
