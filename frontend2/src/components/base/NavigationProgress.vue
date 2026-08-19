<script setup lang="ts">
import { useNavigationLoadingState } from '@shared-composables/useNavigationLoading'

const { isLoading } = useNavigationLoadingState()
</script>

<template>
  <Transition name="navigation-progress">
    <div
      v-if="isLoading"
      class="navigation-progress"
      role="progressbar"
      aria-label="页面正在加载"
      aria-valuemin="0"
      aria-valuemax="100"
    ><i /></div>
  </Transition>
</template>

<style scoped>
.navigation-progress { position: fixed; z-index: 2000; top: 0; right: 0; left: 0; height: 3px; overflow: hidden; pointer-events: none; }
.navigation-progress i { width: 48%; height: 100%; display: block; background: linear-gradient(90deg, transparent, var(--accent), transparent); animation: navigation-slide 1.05s ease-in-out infinite; }
.navigation-progress-enter-active, .navigation-progress-leave-active { transition: opacity .16s ease; }
.navigation-progress-enter-from, .navigation-progress-leave-to { opacity: 0; }
@keyframes navigation-slide { from { transform: translateX(-110%); } to { transform: translateX(220%); } }
@media (prefers-reduced-motion: reduce) { .navigation-progress i { width: 100%; animation: navigation-pulse 1.6s ease-in-out infinite; } @keyframes navigation-pulse { 50% { opacity: .45; } } }
</style>
