<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import {
  getProfile,
  removeNotifyEmail,
  sendNotifyEmailCode,
  toggleNotifyEmail,
  updateProfile,
  verifyNotifyEmail
} from '@shared-api/user'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { NotifyEmailEntry, User } from '@/types'

interface PendingEmail {
  email: string
  code: string
  codeSent: boolean
  busy: boolean
  remaining: number
}

const props = defineProps<{
  user: User
  systemDefaultThreshold: number
}>()

const MAX_EMAILS = 3
const auth = useAuthStore()
const app = useAppStore()
const enabled = ref(props.user.balance_notify_enabled ?? true)
const threshold = ref<number | null>(props.user.balance_notify_threshold)
const entries = ref<NotifyEmailEntry[]>([...(props.user.balance_notify_extra_emails || [])])
const pending = ref<PendingEmail[]>([])
const newEmail = ref(entries.value.length ? '' : props.user.email || '')
const thresholdBusy = ref(false)
const toggleBusy = ref(false)
const savedVerification = reactive({ email: '', code: '', busy: false, remaining: 0 })
let timer: number | null = null

const canAdd = computed(() => entries.value.length + pending.value.length < MAX_EMAILS)

watch(() => props.user.balance_notify_enabled, (value) => { enabled.value = value ?? true })
watch(() => props.user.balance_notify_threshold, (value) => { threshold.value = value })
watch(() => props.user.balance_notify_extra_emails, (value) => { entries.value = [...(value || [])] })

function errorMessage(caught: unknown, fallback: string): string {
  const value = caught as { message?: string; response?: { data?: { detail?: string } } }
  return value.response?.data?.detail || value.message || fallback
}

function apply(user: User): void {
  auth.user = user
  entries.value = [...(user.balance_notify_extra_emails || [])]
}

function ensureTimer(): void {
  if (timer != null) return
  timer = window.setInterval(() => {
    pending.value.forEach((item) => { item.remaining = Math.max(0, item.remaining - 1) })
    savedVerification.remaining = Math.max(0, savedVerification.remaining - 1)
    if (!pending.value.some((item) => item.remaining > 0) && savedVerification.remaining <= 0) {
      if (timer != null) window.clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function toggleEnabled(): Promise<void> {
  if (toggleBusy.value) return
  toggleBusy.value = true
  const next = !enabled.value
  enabled.value = next
  try { apply(await updateProfile({ balance_notify_enabled: next })) }
  catch (caught) {
    enabled.value = !next
    app.showError(errorMessage(caught, '通知开关保存失败'))
  } finally { toggleBusy.value = false }
}

async function saveThreshold(): Promise<void> {
  thresholdBusy.value = true
  try {
    apply(await updateProfile({ balance_notify_threshold: Number(threshold.value || 0) > 0 ? Number(threshold.value) : 0 }))
    app.showSuccess('余额阈值已保存')
  } catch (caught) { app.showError(errorMessage(caught, '阈值保存失败')) }
  finally { thresholdBusy.value = false }
}

async function toggleEntry(entry: NotifyEmailEntry): Promise<void> {
  try { apply(await toggleNotifyEmail(entry.email, !entry.disabled)) }
  catch (caught) { app.showError(errorMessage(caught, '邮箱状态更新失败')) }
}

function addEmail(): void {
  const email = newEmail.value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { app.showError('请输入有效邮箱'); return }
  if ([...entries.value, ...pending.value].some((item) => item.email.toLowerCase() === email.toLowerCase())) {
    app.showError('该邮箱已在通知列表中'); return
  }
  pending.value.push({ email, code: '', codeSent: false, busy: false, remaining: 0 })
  newEmail.value = ''
}

async function sendPendingCode(item: PendingEmail): Promise<void> {
  item.busy = true
  try {
    await sendNotifyEmailCode(item.email)
    item.codeSent = true
    item.remaining = 60
    ensureTimer()
    app.showSuccess('验证码已发送')
  } catch (caught) { app.showError(errorMessage(caught, '验证码发送失败')) }
  finally { item.busy = false }
}

async function verifyPending(item: PendingEmail): Promise<void> {
  if (item.code.length !== 6) { app.showError('请输入 6 位验证码'); return }
  item.busy = true
  try {
    await verifyNotifyEmail(item.email, item.code)
    pending.value = pending.value.filter((candidate) => candidate !== item)
    apply(await getProfile())
    app.showSuccess('通知邮箱已验证')
  } catch (caught) { app.showError(errorMessage(caught, '邮箱验证失败')) }
  finally { item.busy = false }
}

async function sendSavedCode(entry: NotifyEmailEntry): Promise<void> {
  savedVerification.busy = true
  try {
    await sendNotifyEmailCode(entry.email)
    savedVerification.email = entry.email
    savedVerification.code = ''
    savedVerification.remaining = 60
    ensureTimer()
    app.showSuccess('验证码已发送')
  } catch (caught) { app.showError(errorMessage(caught, '验证码发送失败')) }
  finally { savedVerification.busy = false }
}

async function verifySaved(): Promise<void> {
  if (savedVerification.code.length !== 6) return
  savedVerification.busy = true
  try {
    await verifyNotifyEmail(savedVerification.email, savedVerification.code)
    savedVerification.email = ''
    apply(await getProfile())
    app.showSuccess('通知邮箱已验证')
  } catch (caught) { app.showError(errorMessage(caught, '邮箱验证失败')) }
  finally { savedVerification.busy = false }
}

async function removeEntry(entry: NotifyEmailEntry): Promise<void> {
  try {
    await removeNotifyEmail(entry.email)
    apply(await getProfile())
    app.showSuccess('通知邮箱已移除')
  } catch (caught) { app.showError(errorMessage(caught, '邮箱移除失败')) }
}

onUnmounted(() => { if (timer != null) window.clearInterval(timer) })
</script>

<template>
  <article class="notify-card">
    <header>
      <div><span>BALANCE ALERT</span><h3>余额不足通知</h3><p>余额低于阈值时向已验证且启用的邮箱发送提醒。</p></div>
      <button class="notify-switch" type="button" role="switch" :aria-checked="enabled" :disabled="toggleBusy" @click="toggleEnabled"><span /></button>
    </header>
    <div v-if="enabled" class="notify-body">
      <section class="threshold-row">
        <label for="notify-threshold"><span>自定义阈值（USD）</span><div><strong>$</strong><input id="notify-threshold" v-model.number="threshold" min="0" step="0.01" type="number" :placeholder="systemDefaultThreshold > 0 ? `系统默认 $${systemDefaultThreshold}` : '输入阈值'"></div><small>设为 0 时使用系统默认阈值。</small></label>
        <button class="button button--primary" :disabled="thresholdBusy" @click="saveThreshold">{{ thresholdBusy ? '保存中…' : '保存阈值' }}</button>
      </section>
      <section class="notify-emails">
        <header><div><strong>通知邮箱</strong><span>最多 {{ MAX_EMAILS }} 个，未验证邮箱不会收到通知。</span></div><em>{{ entries.length + pending.length }} / {{ MAX_EMAILS }}</em></header>
        <div v-for="entry in entries" :key="entry.email" class="email-row">
          <button class="mini-switch" type="button" role="switch" :aria-checked="!entry.disabled" @click="toggleEntry(entry)"><span /></button>
          <div><strong>{{ entry.email || user.email }}</strong><span :data-verified="entry.verified">{{ entry.verified ? '已验证' : '待验证' }}</span></div>
          <template v-if="!entry.verified && savedVerification.email === entry.email"><input v-model.trim="savedVerification.code" maxlength="6" inputmode="numeric" placeholder="6 位验证码"><button type="button" :disabled="savedVerification.busy" @click="verifySaved">确认</button><small v-if="savedVerification.remaining">{{ savedVerification.remaining }}s</small></template>
          <button v-else-if="!entry.verified" type="button" :disabled="savedVerification.busy" @click="sendSavedCode(entry)">验证</button>
          <button v-if="entry.email" class="danger" type="button" @click="removeEntry(entry)">移除</button>
        </div>
        <div v-for="item in pending" :key="item.email" class="email-row email-row--pending">
          <div class="email-pending-mark">+</div><div><strong>{{ item.email }}</strong><span>尚未加入</span></div>
          <template v-if="item.codeSent"><input v-model.trim="item.code" maxlength="6" inputmode="numeric" placeholder="6 位验证码"><button type="button" :disabled="item.busy" @click="verifyPending(item)">验证并添加</button><button v-if="item.remaining === 0" type="button" :disabled="item.busy" @click="sendPendingCode(item)">重发</button><small v-else>{{ item.remaining }}s</small></template>
          <button v-else type="button" :disabled="item.busy" @click="sendPendingCode(item)">发送验证码</button>
          <button class="danger" type="button" @click="pending = pending.filter(candidate => candidate !== item)">取消</button>
        </div>
        <div v-if="canAdd" class="add-email"><input v-model.trim="newEmail" type="email" placeholder="name@example.com" @keyup.enter="addEmail"><button class="button button--secondary" type="button" @click="addEmail">添加邮箱</button></div>
        <p v-else class="email-limit">已达到通知邮箱数量上限。</p>
      </section>
    </div>
    <div v-else class="notify-disabled"><strong>通知已关闭</strong><span>保留当前阈值和邮箱配置，重新开启后继续使用。</span></div>
  </article>
</template>

<style scoped>
.notify-card { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }.notify-card > header { min-height: 86px; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }.notify-card header > div { min-width: 0; }.notify-card header > div > span:first-child { color: var(--accent); font-size: var(--font-meta); font-weight: 760; letter-spacing: .12em; }.notify-card h3 { margin: 4px 0 0; font-size: 18px; }.notify-card header p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.notify-switch, .mini-switch { position: relative; width: 43px; height: 24px; padding: 2px; flex: 0 0 auto; background: var(--border-strong); border: 0; border-radius: 999px; cursor: pointer; }.notify-switch span, .mini-switch span { width: 20px; height: 20px; display: block; background: white; border-radius: 50%; transition: transform .18s ease; box-shadow: 0 2px 6px rgb(0 0 0 / 14%); }.notify-switch[aria-checked="true"], .mini-switch[aria-checked="true"] { background: var(--accent); }.notify-switch[aria-checked="true"] span { transform: translateX(19px); }.mini-switch { width: 34px; height: 20px; }.mini-switch span { width: 16px; height: 16px; }.mini-switch[aria-checked="true"] span { transform: translateX(14px); }.notify-body { display: grid; grid-template-columns: minmax(250px, .38fr) minmax(0, 1fr); }.threshold-row { padding: 19px; display: grid; align-content: start; gap: 13px; border-right: 1px solid var(--border-subtle); }.threshold-row label { display: grid; gap: 7px; color: var(--text-secondary); font-size: var(--font-meta); }.threshold-row label > div { display: grid; grid-template-columns: auto 1fr; align-items: center; overflow: hidden; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.threshold-row strong { padding-left: 11px; }.threshold-row input, .add-email input, .email-row input { min-width: 0; min-height: 42px; padding: 0 10px; color: var(--text-primary); background: transparent; border: 0; outline: 0; }.threshold-row small { color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.5; }.notify-emails { padding: 18px; display: grid; align-content: start; gap: 8px; }.notify-emails > header { display: flex; justify-content: space-between; gap: 16px; }.notify-emails > header div { display: grid; gap: 3px; }.notify-emails > header strong { font-size: var(--font-body-sm); }.notify-emails > header span { color: var(--text-secondary); font-size: var(--font-caption); }.notify-emails > header em { color: var(--text-secondary); font-size: var(--font-meta); font-style: normal; }.email-row { min-height: 51px; padding: 7px 9px; display: flex; align-items: center; gap: 8px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.email-row > div:nth-child(2) { min-width: 0; margin-right: auto; display: grid; gap: 3px; }.email-row strong { overflow: hidden; font-size: var(--font-meta); text-overflow: ellipsis; }.email-row span { color: var(--warning); font-size: var(--font-caption); }.email-row span[data-verified="true"] { color: var(--success); }.email-row button:not(.mini-switch) { min-height: 30px; padding: 0 7px; color: var(--accent); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; font-size: var(--font-caption); }.email-row button.danger { color: var(--danger); }.email-row input { width: 112px; min-height: 30px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; }.email-row small { color: var(--text-secondary); font-size: var(--font-caption); }.email-row--pending { border-color: color-mix(in srgb, var(--warning) 28%, var(--border-subtle)); }.email-pending-mark { width: 34px; height: 34px; display: grid !important; place-items: center; flex: 0 0 auto; color: var(--warning); background: color-mix(in srgb, var(--warning) 10%, transparent); border-radius: 50%; }.add-email { display: grid; grid-template-columns: 1fr auto; gap: 8px; }.add-email input { background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.email-limit, .notify-disabled { color: var(--text-secondary); font-size: var(--font-meta); }.notify-disabled { min-height: 130px; display: grid; place-content: center; justify-items: center; gap: 6px; text-align: center; }.notify-disabled strong { color: var(--text-primary); font-size: 13px; }
@media (max-width: 900px) { .notify-body { grid-template-columns: 1fr; }.threshold-row { border-right: 0; border-bottom: 1px solid var(--border-subtle); }.email-row { flex-wrap: wrap; }.email-row > div:nth-child(2) { min-width: calc(100% - 50px); }.add-email { grid-template-columns: 1fr; } }
</style>
