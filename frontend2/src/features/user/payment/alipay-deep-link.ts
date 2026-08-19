export enum AlipayDeepLinkState {
  IDLE = 'idle',
  LAUNCHING = 'launching',
  BACKGROUNDED = 'backgrounded',
  FALLBACK = 'fallback'
}

export const ALIPAY_DEEP_LINK_FALLBACK_DELAY_MS = 2200
export const ALIPAY_EMBEDDED_BROWSER_FALLBACK_DELAY_MS = 300
const ALIPAY_DEEP_LINK_PREFIX = 'alipays://platformapi/startapp?saId=10000007&qrcode='

type LifecycleListener = () => void

interface EventTargetLike {
  addEventListener(type: string, listener: LifecycleListener): void
  removeEventListener(type: string, listener: LifecycleListener): void
}

interface VisibilityDocumentLike extends EventTargetLike { readonly hidden: boolean }

export interface AlipayDeepLinkLauncher {
  launch(): void
  dispose(): void
}

export function buildAlipayDeepLink(qrCode: string): string {
  const dynamic = qrCode.trim()
  return dynamic ? `${ALIPAY_DEEP_LINK_PREFIX}${encodeURIComponent(dynamic)}` : ''
}

export function isAlipaySchemeRestrictedBrowser(userAgent: string): boolean {
  return /MicroMessenger|MQQBrowser|\bQQ\//i.test(userAgent)
}

export function createAlipayDeepLinkLauncher(options: {
  qrCode: string
  document: VisibilityDocumentLike
  lifecycleTarget: EventTargetLike
  userAgent: string
  assignLocation: (url: string) => void
  onStateChange: (state: AlipayDeepLinkState) => void
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}): AlipayDeepLinkLauncher {
  const setTimer = options.setTimer || setTimeout
  const clearTimer = options.clearTimer || clearTimeout
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const setState = (state: AlipayDeepLinkState) => { if (!disposed) options.onStateChange(state) }
  const clearFallback = () => { if (timer) { clearTimer(timer); timer = null } }
  const backgrounded = () => { clearFallback(); setState(AlipayDeepLinkState.BACKGROUNDED) }
  const visibility: LifecycleListener = () => { if (options.document.hidden) backgrounded() }
  const pageHide: LifecycleListener = () => backgrounded()
  options.document.addEventListener('visibilitychange', visibility)
  options.lifecycleTarget.addEventListener('pagehide', pageHide)
  return {
    launch() {
      if (disposed) return
      clearFallback()
      const url = buildAlipayDeepLink(options.qrCode)
      if (!url) { setState(AlipayDeepLinkState.FALLBACK); return }
      setState(AlipayDeepLinkState.LAUNCHING)
      try { options.assignLocation(url) } catch { setState(AlipayDeepLinkState.FALLBACK); return }
      const delay = isAlipaySchemeRestrictedBrowser(options.userAgent)
        ? ALIPAY_EMBEDDED_BROWSER_FALLBACK_DELAY_MS
        : ALIPAY_DEEP_LINK_FALLBACK_DELAY_MS
      timer = setTimer(() => {
        timer = null
        setState(options.document.hidden ? AlipayDeepLinkState.BACKGROUNDED : AlipayDeepLinkState.FALLBACK)
      }, delay)
    },
    dispose() {
      clearFallback()
      options.document.removeEventListener('visibilitychange', visibility)
      options.lifecycleTarget.removeEventListener('pagehide', pageHide)
      disposed = true
    }
  }
}
