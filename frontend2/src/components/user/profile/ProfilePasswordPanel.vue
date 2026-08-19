<script setup lang="ts">
import { reactive, ref } from 'vue'
import { changePassword } from '@shared-api/user'
import { useAppStore } from '@/stores/app'

const app = useAppStore()
const busy = ref(false)
const form = reactive({ current: '', next: '', confirm: '' })

function message(caught: unknown): string {
  const value = caught as { message?: string; response?: { data?: { detail?: string } } }
  return value.response?.data?.detail || value.message || '密码修改失败'
}

async function submit(): Promise<void> {
  if (form.next.length < 8) { app.showError('新密码至少需要 8 位'); return }
  if (form.next !== form.confirm) { app.showError('两次输入的新密码不一致'); return }
  busy.value = true
  try {
    await changePassword(form.current, form.next)
    Object.assign(form, { current: '', next: '', confirm: '' })
    app.showSuccess('登录密码已更新')
  } catch (caught) { app.showError(message(caught)) }
  finally { busy.value = false }
}
</script>

<template>
  <article class="security-card password-card">
    <header><div><span>PASSWORD</span><h3>登录密码</h3><p>修改后请在其他设备上使用新密码登录。</p></div></header>
    <form @submit.prevent="submit">
      <label for="current-password">当前密码<input id="current-password" v-model="form.current" type="password" required autocomplete="current-password"></label>
      <label for="new-password">新密码<input id="new-password" v-model="form.next" type="password" minlength="8" required autocomplete="new-password"><small>至少 8 位，建议使用独立密码。</small></label>
      <label for="confirm-password">确认新密码<input id="confirm-password" v-model="form.confirm" type="password" minlength="8" required autocomplete="new-password"></label>
      <button class="button button--primary" :disabled="busy">{{ busy ? '更新中…' : '更新密码' }}</button>
    </form>
  </article>
</template>

<style scoped>
.security-card { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }.security-card > header { min-height: 78px; padding: 16px 18px; border-bottom: 1px solid var(--border-subtle); }.security-card header span { color: var(--accent); font-size: var(--font-meta); font-weight: 760; letter-spacing: .12em; }.security-card h3 { margin: 4px 0 0; font-size: 18px; }.security-card header p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.password-card form { padding: 18px; display: grid; grid-template-columns: repeat(3, 1fr); align-items: end; gap: 11px; }.password-card label { display: grid; gap: 6px; color: var(--text-secondary); font-size: var(--font-meta); }.password-card input { min-height: 42px; padding: 0 11px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.password-card small { min-height: 16px; color: var(--text-secondary); font-size: var(--font-caption); }.password-card button { grid-column: 1 / -1; justify-self: end; } @media (max-width: 760px) { .password-card form { grid-template-columns: 1fr; }.password-card button { width: 100%; } }
</style>
