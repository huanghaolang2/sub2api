import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { acquireBodyScrollLock } from '@/utils/bodyScrollLock'

const FOCUSABLE_SELECTOR = [
  '[autofocus]',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function useModalInteraction(
  isOpen: () => boolean,
  root: Ref<HTMLElement | null>,
  onDismiss?: () => void,
  initialFocus?: () => HTMLElement | null
): void {
  let restoreFocusTo: HTMLElement | null = null
  let releaseBodyScrollLock: (() => void) | null = null

  function focusableElements(): HTMLElement[] {
    return root.value
      ? [...root.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
          .filter((element) => !element.hidden && element.offsetParent !== null)
      : []
  }

  async function focusInside(): Promise<void> {
    await nextTick()
    const target = initialFocus?.() || focusableElements()[0] || root.value
    target?.focus()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!isOpen()) return
    if (event.key === 'Escape' && onDismiss) {
      event.preventDefault()
      onDismiss()
      return
    }
    if (event.key !== 'Tab') return
    const elements = focusableElements()
    if (!elements.length) { event.preventDefault(); root.value?.focus(); return }
    const first = elements[0]
    const last = elements[elements.length - 1]
    if (event.shiftKey && (document.activeElement === first || !root.value?.contains(document.activeElement))) {
      event.preventDefault(); last?.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !root.value?.contains(document.activeElement))) {
      event.preventDefault(); first?.focus()
    }
  }

  watch(isOpen, (open) => {
    if (open) {
      restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      releaseBodyScrollLock ||= acquireBodyScrollLock()
      void focusInside()
      return
    }
    releaseBodyScrollLock?.()
    releaseBodyScrollLock = null
    if (restoreFocusTo?.isConnected) restoreFocusTo.focus()
    restoreFocusTo = null
  }, { immediate: true, flush: 'post' })

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown)
    releaseBodyScrollLock?.()
    releaseBodyScrollLock = null
  })
}
