<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { DialogWidth } from './dialog'
import { acquireBodyScrollLock } from '@/utils/bodyScrollLock'

const props = withDefaults(defineProps<{
  show: boolean
  title: string
  description?: string
  width?: DialogWidth
}>(), { description: '', width: DialogWidth.STANDARD })

const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement | null>(null)
const titleId = `surface-dialog-${useId()}`
let restoreFocusTo: HTMLElement | null = null
let releaseBodyScrollLock: (() => void) | null = null

const focusableSelector = [
  '[autofocus]',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusableElements(): HTMLElement[] {
  return dialog.value
    ? [...dialog.value.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.hidden && element.offsetParent !== null)
    : []
}

function lockBody(): void {
  releaseBodyScrollLock ||= acquireBodyScrollLock()
}

function unlockBody(): void {
  releaseBodyScrollLock?.()
  releaseBodyScrollLock = null
}

async function focusDialog(): Promise<void> {
  await nextTick()
  const [first] = focusableElements()
  ;(first || dialog.value)?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.show) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const elements = focusableElements()
  if (!elements.length) { event.preventDefault(); dialog.value?.focus(); return }
  const first = elements[0]
  const last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

watch(() => props.show, async (show) => {
  if (show) {
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    lockBody()
    await focusDialog()
  } else {
    unlockBody()
    restoreFocusTo?.focus()
    restoreFocusTo = null
  }
})
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (!props.show) return
  restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  lockBody()
  void focusDialog()
})
onUnmounted(() => {
  unlockBody()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="surface-dialog-backdrop" role="presentation" @mousedown.self="emit('close')">
      <section
        ref="dialog"
        class="surface-dialog"
        :class="`surface-dialog--${width}`"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <header>
          <div>
            <h2 :id="titleId">{{ title }}</h2>
            <p v-if="description">{{ description }}</p>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="surface-dialog__body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.surface-dialog-backdrop { position: fixed; z-index: 105; inset: 0; padding: 24px; display: grid; place-items: center; background: color-mix(in srgb, #08070d 68%, transparent); backdrop-filter: blur(8px); }
.surface-dialog { width: min(620px, 100%); max-height: calc(100vh - 48px); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 19px; box-shadow: 0 30px 82px rgba(7, 6, 12, .3); }
.surface-dialog--compact { width: min(460px, 100%); }
.surface-dialog--wide { width: min(940px, 100%); }
.surface-dialog > header { padding: 22px 24px 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }
.surface-dialog h2 { margin: 0; font-size: 23px; letter-spacing: -.035em; }
.surface-dialog header p { margin: 7px 0 0; color: var(--text-secondary); font-size: var(--font-body-sm); line-height: 1.55; }
.surface-dialog header button { width: 34px; height: 34px; flex: 0 0 auto; color: var(--text-secondary); background: var(--surface-canvas); border: 0; border-radius: 9px; cursor: pointer; font-size: 20px; }
.surface-dialog__body { padding: 24px; overflow-y: auto; }
.surface-dialog > footer { padding: 16px 24px; display: flex; justify-content: flex-end; gap: 9px; border-top: 1px solid var(--border-subtle); }
@media (max-width: 620px) { .surface-dialog-backdrop { padding: 0; align-items: end; } .surface-dialog { max-height: 94vh; border-radius: 19px 19px 0 0; } .surface-dialog__body { padding: 20px; } }
</style>
