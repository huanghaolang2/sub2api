import { defineStore } from 'pinia'
import { ref } from 'vue'

export enum ConfirmTone {
  DEFAULT = 'default',
  DANGER = 'danger'
}

export enum ConfirmDismissPolicy {
  EXPLICIT = 'explicit',
  ESCAPE_OR_EXPLICIT = 'escape_or_explicit'
}

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: ConfirmTone
  dismissPolicy?: ConfirmDismissPolicy
}

interface ConfirmDialogState extends Required<ConfirmOptions> {
  id: number
}

export const useConfirmStore = defineStore('confirm', () => {
  const current = ref<ConfirmDialogState | null>(null)
  let resolver: ((confirmed: boolean) => void) | null = null
  let nextId = 0

  function ask(options: ConfirmOptions): Promise<boolean> {
    if (resolver) resolver(false)
    current.value = {
      id: ++nextId,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? '确认',
      cancelText: options.cancelText ?? '取消',
      tone: options.tone ?? ConfirmTone.DEFAULT,
      dismissPolicy: options.dismissPolicy ?? ConfirmDismissPolicy.ESCAPE_OR_EXPLICIT
    }
    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  function settle(confirmed: boolean): void {
    const resolve = resolver
    resolver = null
    current.value = null
    resolve?.(confirmed)
  }

  function confirm(): void {
    settle(true)
  }

  function cancel(): void {
    settle(false)
  }

  return { current, ask, confirm, cancel }
})
