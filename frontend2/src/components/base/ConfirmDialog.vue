<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ConfirmDismissPolicy, ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { acquireBodyScrollLock } from '@/utils/bodyScrollLock'

const dialog = useConfirmStore()
const cancelButton = ref<HTMLButtonElement | null>(null)
const dialogElement = ref<HTMLElement | null>(null)
let restoreFocusTo: HTMLElement | null = null
let releaseBodyScrollLock: (() => void) | null = null

function handleKeydown(event: KeyboardEvent): void {
  if (
    event.key === 'Escape' &&
    dialog.current?.dismissPolicy === ConfirmDismissPolicy.ESCAPE_OR_EXPLICIT
  ) {
    event.preventDefault()
    dialog.cancel()
    return
  }
  if (event.key !== 'Tab' || !dialog.current) return
  const buttons = [...(dialogElement.value?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])]
  if (!buttons.length) { event.preventDefault(); dialogElement.value?.focus(); return }
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

watch(() => dialog.current?.id, async (id) => {
  if (id) {
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    releaseBodyScrollLock ||= acquireBodyScrollLock()
    await nextTick()
    cancelButton.value?.focus()
  } else {
    releaseBodyScrollLock?.()
    releaseBodyScrollLock = null
    restoreFocusTo?.focus()
    restoreFocusTo = null
  }
})

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  if (!dialog.current) return
  restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  releaseBodyScrollLock = acquireBodyScrollLock()
  void nextTick(() => cancelButton.value?.focus())
})
onUnmounted(() => {
  releaseBodyScrollLock?.()
  releaseBodyScrollLock = null
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog.current" class="confirm-backdrop" role="presentation">
      <section
        ref="dialogElement"
        class="confirm-dialog"
        :class="{ 'confirm-dialog--danger': dialog.current.tone === ConfirmTone.DANGER }"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="global-confirm-title"
        aria-describedby="global-confirm-message"
        tabindex="-1"
      >
        <span class="confirm-dialog__mark" aria-hidden="true">!</span>
        <div class="confirm-dialog__copy">
          <p>操作确认</p>
          <h2 id="global-confirm-title">{{ dialog.current.title }}</h2>
          <div id="global-confirm-message">{{ dialog.current.message }}</div>
        </div>
        <footer>
          <button ref="cancelButton" type="button" class="button button--secondary" @click="dialog.cancel">
            {{ dialog.current.cancelText }}
          </button>
          <button
            type="button"
            class="button"
            :class="dialog.current.tone === ConfirmTone.DANGER ? 'button--danger' : 'button--primary'"
            @click="dialog.confirm"
          >
            {{ dialog.current.confirmText }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop { position: fixed; z-index: 110; inset: 0; padding: 24px; display: grid; place-items: center; background: color-mix(in srgb, #08070d 68%, transparent); backdrop-filter: blur(8px); }
.confirm-dialog { width: min(470px, 100%); padding: 26px; display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 16px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 18px; box-shadow: 0 28px 76px rgba(7, 6, 12, .3); }
.confirm-dialog__mark { width: 38px; height: 38px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 11px; font-size: 16px; font-weight: 850; }
.confirm-dialog--danger .confirm-dialog__mark { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
.confirm-dialog__copy > p { margin: 1px 0 6px; color: var(--text-secondary); font-size: var(--font-meta); font-weight: 780; letter-spacing: .12em; text-transform: uppercase; }
.confirm-dialog h2 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: -.035em; }
.confirm-dialog__copy > div { margin-top: 10px; color: var(--text-secondary); font-size: 12px; line-height: 1.7; white-space: pre-line; }
.confirm-dialog footer { grid-column: 1 / -1; margin-top: 8px; display: flex; justify-content: flex-end; gap: 9px; }
.confirm-dialog footer .button { min-width: 94px; }
.button--danger { color: white; background: var(--danger); border-color: var(--danger); }
@media (max-width: 520px) { .confirm-dialog { padding: 22px; grid-template-columns: 1fr; } .confirm-dialog footer { display: grid; grid-template-columns: 1fr 1fr; } }
</style>
