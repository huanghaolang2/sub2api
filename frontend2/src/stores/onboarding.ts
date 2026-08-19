import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export enum OnboardingAudience {
  ADMIN = 'admin',
  USER = 'user',
}

const STORAGE_VERSION = 'v5_frontend2'

function storageKey(userId: number | string, audience: OnboardingAudience): string {
  const prefix = audience === OnboardingAudience.ADMIN ? 'admin_guide' : 'user_guide'
  return `${prefix}_${userId}_${audience}_${STORAGE_VERSION}`
}

export const useOnboardingStore = defineStore('onboarding', () => {
  const active = ref(false)
  const stepIndex = ref(0)
  const userId = ref<number | string>('guest')
  const audience = ref(OnboardingAudience.USER)
  const isFirstStep = computed(() => stepIndex.value === 0)

  function hasSeen(nextUserId: number | string, nextAudience: OnboardingAudience): boolean {
    return localStorage.getItem(storageKey(nextUserId, nextAudience)) === 'true'
  }

  function start(nextUserId: number | string, nextAudience: OnboardingAudience, force = false): void {
    if (
      !force
      && active.value
      && String(userId.value) === String(nextUserId)
      && audience.value === nextAudience
    ) return
    if (!force && hasSeen(nextUserId, nextAudience)) return
    userId.value = nextUserId
    audience.value = nextAudience
    stepIndex.value = 0
    active.value = true
  }

  function replay(nextUserId: number | string, nextAudience: OnboardingAudience): void {
    localStorage.removeItem(storageKey(nextUserId, nextAudience))
    start(nextUserId, nextAudience, true)
  }

  function previous(): void {
    stepIndex.value = Math.max(0, stepIndex.value - 1)
  }

  function next(totalSteps: number): void {
    if (stepIndex.value >= totalSteps - 1) {
      finish()
      return
    }
    stepIndex.value += 1
  }

  function finish(): void {
    localStorage.setItem(storageKey(userId.value, audience.value), 'true')
    active.value = false
    stepIndex.value = 0
  }

  return { active, stepIndex, audience, isFirstStep, hasSeen, start, replay, previous, next, finish }
})
