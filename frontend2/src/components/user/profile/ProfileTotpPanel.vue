<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import QRCode from 'qrcode'
import { totpAPI } from '@shared-api/totp'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import {
  IdentityVerificationMethod,
  TotpSetupStep,
  formatProfileDate
} from '@/features/user/profile/model'
import { useAppStore } from '@/stores/app'
import type { TotpSetupResponse, TotpStatus } from '@/types'

enum TotpDialogMode {
  CLOSED = 'closed',
  ENABLE = 'enable',
  DISABLE = 'disable'
}

const app = useAppStore()
const status = ref<TotpStatus | null>(null)
const loading = ref(true)
const busy = ref(false)
const mode = ref(TotpDialogMode.CLOSED)
const method = ref(IdentityVerificationMethod.PASSWORD)
const step = ref(TotpSetupStep.VERIFY_IDENTITY)
const setup = ref<TotpSetupResponse | null>(null)
const qrData = ref('')
const cooldown = ref(0)
const verification = reactive({ password: '', emailCode: '', totpCode: '' })
let timer: number | null = null

const dialogTitle = computed(() => mode.value === TotpDialogMode.DISABLE ? '关闭动态验证' : '开启动态验证')
const dialogDescription = computed(() => mode.value === TotpDialogMode.DISABLE
  ? '验证账户身份后关闭 TOTP，之后登录将不再要求动态码。'
  : '先验证身份，再用身份验证器扫描二维码并输入 6 位动态码。')

function errorMessage(caught: unknown, fallback: string): string {
  const value = caught as { message?: string; response?: { data?: { detail?: string; message?: string } } }
  return value.response?.data?.detail || value.response?.data?.message || value.message || fallback
}

async function loadStatus(): Promise<void> {
  loading.value = true
  try { status.value = await totpAPI.getStatus() }
  catch (caught) { app.showError(errorMessage(caught, 'TOTP 状态加载失败')) }
  finally { loading.value = false }
}

function clearForm(): void {
  Object.assign(verification, { password: '', emailCode: '', totpCode: '' })
  setup.value = null
  qrData.value = ''
  step.value = TotpSetupStep.VERIFY_IDENTITY
  cooldown.value = 0
  if (timer != null) window.clearInterval(timer)
  timer = null
}

function close(): void {
  if (busy.value) return
  mode.value = TotpDialogMode.CLOSED
  clearForm()
}

async function open(nextMode: TotpDialogMode): Promise<void> {
  mode.value = nextMode
  clearForm()
  busy.value = true
  try {
    const result = await totpAPI.getVerificationMethod()
    method.value = result.method === IdentityVerificationMethod.EMAIL
      ? IdentityVerificationMethod.EMAIL
      : IdentityVerificationMethod.PASSWORD
  } catch (caught) {
    app.showError(errorMessage(caught, '无法确定身份验证方式'))
    mode.value = TotpDialogMode.CLOSED
  } finally { busy.value = false }
}

async function sendCode(): Promise<void> {
  busy.value = true
  try {
    await totpAPI.sendVerifyCode()
    cooldown.value = 60
    if (timer != null) window.clearInterval(timer)
    timer = window.setInterval(() => {
      cooldown.value = Math.max(0, cooldown.value - 1)
      if (cooldown.value === 0 && timer != null) { window.clearInterval(timer); timer = null }
    }, 1000)
    app.showSuccess('邮箱验证码已发送')
  } catch (caught) { app.showError(errorMessage(caught, '验证码发送失败')) }
  finally { busy.value = false }
}

function identityPayload(): { email_code?: string; password?: string } {
  return method.value === IdentityVerificationMethod.EMAIL
    ? { email_code: verification.emailCode }
    : { password: verification.password }
}

async function initiate(): Promise<void> {
  if (method.value === IdentityVerificationMethod.EMAIL && verification.emailCode.length !== 6) {
    app.showError('请输入 6 位邮箱验证码'); return
  }
  if (method.value === IdentityVerificationMethod.PASSWORD && !verification.password) {
    app.showError('请输入当前密码'); return
  }
  busy.value = true
  try {
    setup.value = await totpAPI.initiateSetup(identityPayload())
    qrData.value = await QRCode.toDataURL(setup.value.qr_code_url, { width: 240, margin: 2 })
    step.value = TotpSetupStep.SCAN_SECRET
  } catch (caught) { app.showError(errorMessage(caught, 'TOTP 配置创建失败')) }
  finally { busy.value = false }
}

async function enable(): Promise<void> {
  if (!setup.value || !/^\d{6}$/.test(verification.totpCode)) {
    app.showError('请输入身份验证器中的 6 位动态码'); return
  }
  busy.value = true
  try {
    await totpAPI.enable({ totp_code: verification.totpCode, setup_token: setup.value.setup_token })
    app.showSuccess('动态验证已开启')
    mode.value = TotpDialogMode.CLOSED
    clearForm()
    await loadStatus()
  } catch (caught) {
    verification.totpCode = ''
    app.showError(errorMessage(caught, '动态码验证失败'))
  } finally { busy.value = false }
}

async function disable(): Promise<void> {
  if (method.value === IdentityVerificationMethod.EMAIL && verification.emailCode.length !== 6) {
    app.showError('请输入 6 位邮箱验证码'); return
  }
  if (method.value === IdentityVerificationMethod.PASSWORD && !verification.password) {
    app.showError('请输入当前密码'); return
  }
  busy.value = true
  try {
    await totpAPI.disable(identityPayload())
    app.showSuccess('动态验证已关闭')
    mode.value = TotpDialogMode.CLOSED
    clearForm()
    await loadStatus()
  } catch (caught) { app.showError(errorMessage(caught, '关闭 TOTP 失败')) }
  finally { busy.value = false }
}

async function copySecret(): Promise<void> {
  if (!setup.value?.secret) return
  try { await navigator.clipboard.writeText(setup.value.secret); app.showSuccess('密钥已复制') }
  catch { app.showError('复制失败，请手动复制') }
}

onMounted(() => { void loadStatus() })
onUnmounted(() => { if (timer != null) window.clearInterval(timer) })
</script>

<template>
  <article class="security-card totp-card">
    <header><div><span>TWO-FACTOR AUTHENTICATION</span><h3>动态验证器·TOTP</h3><p>使用 Google Authenticator、1Password 等应用为登录增加第二层保护。</p></div></header>
    <div v-if="loading" class="security-state" role="status">正在读取 TOTP 状态…</div>
    <div v-else-if="status && !status.feature_enabled" class="security-state"><strong>管理员未启用 TOTP</strong><span>启用后用户才能在这里配置。</span></div>
    <div v-else class="security-action-row">
      <div class="security-icon" :data-enabled="status?.enabled">{{ status?.enabled ? '✓' : '2F' }}</div>
      <div><strong>{{ status?.enabled ? '已开启动态验证' : '尚未开启' }}</strong><span v-if="status?.enabled_at">开启于 {{ formatProfileDate(status.enabled_at) }}</span><span v-else>开启后，登录时需额外输入 6 位动态码。</span></div>
      <button v-if="status?.enabled" class="security-danger" type="button" @click="open(TotpDialogMode.DISABLE)">关闭 TOTP</button>
      <button v-else class="button button--primary" type="button" @click="open(TotpDialogMode.ENABLE)">开启 TOTP</button>
    </div>

    <SurfaceDialog :show="mode !== TotpDialogMode.CLOSED" :title="dialogTitle" :description="dialogDescription" :width="DialogWidth.STANDARD" @close="close">
      <div v-if="mode === TotpDialogMode.DISABLE" class="totp-dialog-form">
        <template v-if="method === IdentityVerificationMethod.EMAIL"><label>邮箱验证码<input v-model.trim="verification.emailCode" maxlength="6" inputmode="numeric"></label><button class="button button--secondary" type="button" :disabled="busy || cooldown > 0" @click="sendCode">{{ cooldown ? `${cooldown}s 后可重发` : '发送验证码' }}</button></template>
        <label v-else>当前密码<input v-model="verification.password" type="password" autocomplete="current-password"></label>
        <p class="danger-copy">关闭后将降低账户安全性。</p>
      </div>
      <div v-else-if="step === TotpSetupStep.VERIFY_IDENTITY" class="totp-dialog-form">
        <template v-if="method === IdentityVerificationMethod.EMAIL"><label>邮箱验证码<input v-model.trim="verification.emailCode" maxlength="6" inputmode="numeric"></label><button class="button button--secondary" type="button" :disabled="busy || cooldown > 0" @click="sendCode">{{ cooldown ? `${cooldown}s 后可重发` : '发送验证码' }}</button></template>
        <label v-else>当前密码<input v-model="verification.password" type="password" autocomplete="current-password"></label>
      </div>
      <div v-else-if="step === TotpSetupStep.SCAN_SECRET && setup" class="totp-setup">
        <div class="totp-qr"><img :src="qrData" alt="TOTP 配置二维码"></div>
        <div><strong>1. 扫描二维码</strong><p>在身份验证器中添加账户。无法扫码时可手动输入密钥。</p><code>{{ setup.secret }}</code><button type="button" @click="copySecret">复制密钥</button></div>
      </div>
      <div v-else class="totp-code-step"><strong>2. 输入动态码</strong><p>输入身份验证器当前显示的 6 位数字。</p><input v-model.trim="verification.totpCode" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="000000"></div>
      <template #footer>
        <button class="button button--secondary" type="button" :disabled="busy" @click="close">取消</button>
        <button v-if="mode === TotpDialogMode.DISABLE" class="button security-danger-button" type="button" :disabled="busy" @click="disable">{{ busy ? '关闭中…' : '确认关闭' }}</button>
        <button v-else-if="step === TotpSetupStep.VERIFY_IDENTITY" class="button button--primary" type="button" :disabled="busy" @click="initiate">{{ busy ? '验证中…' : '继续' }}</button>
        <button v-else-if="step === TotpSetupStep.SCAN_SECRET" class="button button--primary" type="button" @click="step = TotpSetupStep.VERIFY_CODE">已扫描，下一步</button>
        <button v-else class="button button--primary" type="button" :disabled="busy" @click="enable">{{ busy ? '开启中…' : '验证并开启' }}</button>
      </template>
    </SurfaceDialog>
  </article>
</template>

<style scoped>
.security-card { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }.security-card > header { min-height: 78px; padding: 16px 18px; border-bottom: 1px solid var(--border-subtle); }.security-card header span { color: var(--accent); font-size: var(--font-meta); font-weight: 760; letter-spacing: .12em; }.security-card h3 { margin: 4px 0 0; font-size: 18px; }.security-card header p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.security-state { min-height: 136px; display: grid; place-content: center; justify-items: center; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); text-align: center; }.security-state strong { color: var(--text-primary); font-size: 12px; }.security-action-row { min-height: 136px; padding: 19px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; }.security-icon { width: 48px; height: 48px; display: grid; place-items: center; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 14px; font-size: 12px; font-weight: 800; }.security-icon[data-enabled="true"] { color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); }.security-action-row > div:nth-child(2) { display: grid; gap: 4px; }.security-action-row strong { font-size: var(--font-body-sm); }.security-action-row span { color: var(--text-secondary); font-size: var(--font-meta); }.security-danger { min-height: 39px; padding: 0 11px; color: var(--danger); background: transparent; border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border-subtle)); border-radius: 9px; cursor: pointer; font-size: var(--font-meta); }.totp-dialog-form { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 10px; }.totp-dialog-form label { display: grid; gap: 7px; color: var(--text-secondary); font-size: var(--font-meta); }.totp-dialog-form input, .totp-code-step input { min-height: 44px; padding: 0 11px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.danger-copy { grid-column: 1 / -1; margin: 3px 0 0; color: var(--danger); font-size: var(--font-meta); }.totp-setup { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 22px; }.totp-qr { padding: 10px; background: white; border: 1px solid var(--border-subtle); border-radius: 12px; }.totp-qr img { width: 180px; height: 180px; }.totp-setup > div:last-child { min-width: 0; display: grid; gap: 8px; }.totp-setup strong, .totp-code-step strong { font-size: 13px; }.totp-setup p, .totp-code-step p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.6; }.totp-setup code { padding: 8px; overflow-wrap: anywhere; background: var(--surface-canvas); border-radius: 7px; font-size: var(--font-meta); }.totp-setup button { width: fit-content; padding: 0; color: var(--accent); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }.totp-code-step { display: grid; gap: 10px; }.totp-code-step input { width: 210px; font-size: 21px; letter-spacing: .22em; text-align: center; }.security-danger-button { color: white; background: var(--danger); border-color: var(--danger); }
@media (max-width: 620px) { .security-action-row { grid-template-columns: auto 1fr; }.security-action-row > button { grid-column: 1 / -1; width: 100%; }.totp-dialog-form { grid-template-columns: 1fr; }.totp-setup { grid-template-columns: 1fr; justify-items: center; }.totp-code-step input { width: 100%; } }
</style>
