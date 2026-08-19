let activeLocks = 0

export function acquireBodyScrollLock(): () => void {
  let released = false
  activeLocks += 1
  if (typeof document !== 'undefined') document.body.style.overflow = 'hidden'
  return () => {
    if (released) return
    released = true
    activeLocks = Math.max(0, activeLocks - 1)
    if (activeLocks === 0 && typeof document !== 'undefined') document.body.style.overflow = ''
  }
}
