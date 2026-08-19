<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { OnboardingAudience, useOnboardingStore } from '@/stores/onboarding'
import { acquireBodyScrollLock } from '@/utils/bodyScrollLock'

interface TourStep {
  title: string
  description: string
  path?: string
  action?: string
}

const adminSteps: TourStep[] = [
  { title: '欢迎使用新版控制台', description: '管理能力按任务域重新组织。顶部切换工作域，板块内的二级入口始终保留，所有旧功能仍可到达。' },
  { title: '先看平台状态', description: '平台概览集中展示规模、收入、账号健康、实时负载与模型、用户、分组排行。', path: '/admin/dashboard', action: '打开平台概览' },
  { title: '配置分组与价格', description: '在分组管理中设置授权范围、模型价格、倍率、复合路由、用户覆盖和 RPM。', path: '/admin/groups', action: '打开分组管理' },
  { title: '接入上游账号', description: '账号管理包含创建、OAuth、凭据、批量操作、配额、测试、导入导出与平台专项工具。', path: '/admin/accounts', action: '打开账号管理' },
  { title: '管理用户与权限', description: '用户管理支持服务端筛选、分页、动态属性、Key、余额、分组、倍率与平台额度。', path: '/admin/users', action: '打开用户管理' },
  { title: '完成系统治理', description: '系统设置、数据备份、审计、风控与运维能力位于“安全与系统”和“总览与运维”。你随时可以从顶部重新打开本指南。', path: '/admin/settings', action: '打开系统设置' },
]

const userSteps: TourStep[] = [
  { title: '欢迎使用新版工作台', description: '高频任务集中在顶部工作域，当前板块的相关页面会显示在二级导航中。' },
  { title: '创建 API Key', description: '创建 Key、配置分组、IP 规则、额度、周期限制和到期时间，并查看各客户端接入方式。', path: '/app/keys', action: '打开 API Key' },
  { title: '查看用量与错误', description: '用量明细支持服务端筛选、排序、分页、CSV 导出和错误请求详情。', path: '/app/usage', action: '打开用量明细' },
  { title: '选择模型与价格', description: '模型页展示当前账号可用的模型、完整价格维度、倍率和官方参考价。', path: '/app/models', action: '打开模型与价格' },
  { title: '完善账户安全', description: '在个人设置中管理资料、通知邮箱、密码、第三方身份、TOTP、Passkey 和全部会话。', path: '/app/profile', action: '打开个人设置' },
]

const auth = useAuthStore()
const store = useOnboardingStore()
const router = useRouter()
const dialog = ref<HTMLElement | null>(null)
let autoStartTimer: number | null = null
let restoreFocusTo: HTMLElement | null = null
let releaseBodyScrollLock: (() => void) | null = null

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const audience = computed(() => auth.isAdmin ? OnboardingAudience.ADMIN : OnboardingAudience.USER)
const steps = computed(() => audience.value === OnboardingAudience.ADMIN ? adminSteps : userSteps)
const current = computed(() => steps.value[Math.min(store.stepIndex, steps.value.length - 1)])
const isLast = computed(() => store.stepIndex >= steps.value.length - 1)
const progress = computed(() => `${store.stepIndex + 1} / ${steps.value.length}`)

function focusableElements(): HTMLElement[] {
  return dialog.value
    ? [...dialog.value.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.hidden && element.offsetParent !== null)
    : []
}

async function focusTour(): Promise<void> {
  await nextTick()
  const [first] = focusableElements()
  ;(first || dialog.value)?.focus()
}

async function goNext(): Promise<void> {
  if (current.value.path) await router.push(current.value.path)
  store.next(steps.value.length)
  await nextTick()
  dialog.value?.focus()
}

function handleKeydown(event: KeyboardEvent): void {
  if (!store.active) return
  if (event.key === 'Escape') { event.preventDefault(); store.finish() }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); store.previous() }
  else if (event.key === 'ArrowRight') { event.preventDefault(); void goNext() }
  else if (event.key === 'Tab') {
    const elements = focusableElements()
    if (!elements.length) { event.preventDefault(); dialog.value?.focus(); return }
    const first = elements[0]
    const last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}

watch(() => store.active, async (active) => {
  if (active) {
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    releaseBodyScrollLock ||= acquireBodyScrollLock()
    await focusTour()
    return
  }
  releaseBodyScrollLock?.()
  releaseBodyScrollLock = null
  restoreFocusTo?.focus()
  restoreFocusTo = null
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  if (store.active) {
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    releaseBodyScrollLock ||= acquireBodyScrollLock()
    void focusTour()
  }
  if (!auth.isAdmin || auth.isSimpleMode) return
  autoStartTimer = window.setTimeout(() => {
    if (auth.user?.id != null) store.start(auth.user.id, OnboardingAudience.ADMIN)
  }, 1000)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  if (autoStartTimer) window.clearTimeout(autoStartTimer)
  releaseBodyScrollLock?.()
  releaseBodyScrollLock = null
})
</script>

<template>
  <Teleport to="body">
    <div v-if="store.active" class="onboarding-overlay" role="presentation" @mousedown.self="store.finish">
      <section ref="dialog" class="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" tabindex="-1">
        <header><span>快速上手 · {{ progress }}</span><button type="button" aria-label="关闭使用指南" @click="store.finish">×</button></header>
        <div class="onboarding-progress" aria-hidden="true"><i :style="{ width: `${((store.stepIndex + 1) / steps.length) * 100}%` }" /></div>
        <div class="onboarding-copy"><p>{{ audience === OnboardingAudience.ADMIN ? 'ADMIN CONSOLE' : 'USER CONSOLE' }}</p><h2 id="onboarding-title">{{ current.title }}</h2><span>{{ current.description }}</span></div>
        <footer><button type="button" class="button button--secondary" :disabled="store.isFirstStep" @click="store.previous">上一步</button><button type="button" class="onboarding-skip" @click="store.finish">不再提示</button><button type="button" class="button button--primary" @click="goNext">{{ isLast ? '完成指南' : current.action || '下一步' }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-overlay { position: fixed; z-index: 1000; inset: 0; padding: 24px; display: grid; place-items: center; background: color-mix(in srgb, #0e0d18 64%, transparent); backdrop-filter: blur(7px); }
.onboarding-dialog { width: min(540px, 100%); overflow: hidden; color: var(--text-primary); background: var(--surface-raised); border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border-subtle)); border-radius: 22px; box-shadow: 0 32px 90px rgba(8, 7, 16, .32); outline: none; }
.onboarding-dialog > header { min-height: 54px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; color: var(--text-secondary); font-size: var(--font-meta); font-weight: 720; letter-spacing: .08em; }
.onboarding-dialog > header button { width: 34px; height: 34px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 9px; cursor: pointer; font-size: 20px; }
.onboarding-dialog > header button:hover { color: var(--text-primary); background: var(--surface-canvas); }
.onboarding-progress { height: 3px; background: var(--border-subtle); }
.onboarding-progress i { height: 100%; display: block; background: var(--accent); transition: width .2s ease; }
.onboarding-copy { min-height: 230px; padding: 42px 38px; display: grid; align-content: center; gap: 12px; }
.onboarding-copy p { margin: 0; color: var(--accent); font-size: var(--font-meta); font-weight: 800; letter-spacing: .14em; }
.onboarding-copy h2 { margin: 0; font-size: clamp(26px, 4vw, 38px); letter-spacing: -.04em; }
.onboarding-copy span { max-width: 46ch; color: var(--text-secondary); font-size: 13px; line-height: 1.8; }
.onboarding-dialog > footer { padding: 16px 20px; display: flex; align-items: center; gap: 9px; background: var(--surface-canvas); border-top: 1px solid var(--border-subtle); }
.onboarding-dialog > footer .onboarding-skip { margin-left: auto; min-height: 36px; padding: 0 9px; color: var(--text-secondary); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }
@media (max-width: 560px) { .onboarding-overlay { padding: 12px; }.onboarding-copy { min-height: 250px; padding: 34px 24px; }.onboarding-dialog > footer { flex-wrap: wrap; }.onboarding-dialog > footer .onboarding-skip { order: 3; width: 100%; margin: 0; } }
@media (prefers-reduced-motion: reduce) { .onboarding-progress i { transition: none; } }
</style>
