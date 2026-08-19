import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { OnboardingAudience, useOnboardingStore } from '../onboarding'

function createStorageMock(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

describe('onboarding store', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: createStorageMock() })
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('persists completion per user and role while allowing an explicit replay', () => {
    const store = useOnboardingStore()
    store.start(7, OnboardingAudience.ADMIN)
    expect(store.active).toBe(true)
    store.next(2)
    store.next(2)
    expect(store.active).toBe(false)
    expect(store.hasSeen(7, OnboardingAudience.ADMIN)).toBe(true)
    expect(store.hasSeen(7, OnboardingAudience.USER)).toBe(false)

    store.start(7, OnboardingAudience.ADMIN)
    expect(store.active).toBe(false)
    store.replay(7, OnboardingAudience.ADMIN)
    expect(store.active).toBe(true)
    expect(store.stepIndex).toBe(0)
  })
})
