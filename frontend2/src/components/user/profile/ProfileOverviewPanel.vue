<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  bindEmailIdentity,
  sendEmailBindingCode,
  startOAuthBinding,
  unbindAuthIdentity,
  updateProfile
} from '@shared-api/user'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import {
  ProfileAuthProvider,
  bindingSummary,
  displayableProfileEmail,
  formatProfileDate,
  profileBindingDetails,
  profileBindingStatus,
  profileSourceHints,
  providerCapabilities,
  validateEmail,
  type BindableProfileProvider
} from '@/features/user/profile/model'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'

const props = defineProps<{
  user: User
  linuxdoEnabled: boolean
  dingtalkEnabled: boolean
  oidcEnabled: boolean
  oidcProviderName: string
  wechatEnabled: boolean
}>()

const auth = useAuthStore()
const app = useAppStore()
const route = useRoute()
const username = ref(props.user.username || '')
const avatarDraft = ref('')
const avatarBusy = ref(false)
const profileBusy = ref(false)
const emailExpanded = ref(false)
const sendingEmailCode = ref(false)
const bindingEmail = ref(false)
const unbinding = ref(false)
const unbindTarget = ref<{ provider: BindableProfileProvider; label: string } | null>(null)
const emailForm = reactive({ email: displayableProfileEmail(props.user), code: '', password: '' })

const labels: Record<ProfileAuthProvider, string> = {
  [ProfileAuthProvider.EMAIL]: '邮箱与密码',
  [ProfileAuthProvider.LINUXDO]: 'LinuxDo',
  [ProfileAuthProvider.DINGTALK]: '钉钉',
  [ProfileAuthProvider.OIDC]: props.oidcProviderName || 'OIDC',
  [ProfileAuthProvider.WECHAT]: '微信',
  [ProfileAuthProvider.GITHUB]: 'GitHub',
  [ProfileAuthProvider.GOOGLE]: 'Google'
}

const providers = computed(() => providerCapabilities({
  linuxdo: props.linuxdoEnabled,
  dingtalk: props.dingtalkEnabled,
  oidc: props.oidcEnabled,
  oidcName: props.oidcProviderName,
  wechat: props.wechatEnabled
}))
const sources = computed(() => profileSourceHints(props.user, labels))
const displayName = computed(() => props.user.username?.trim() || displayableProfileEmail(props.user) || '用户')
const avatar = computed(() => avatarDraft.value || props.user.avatar_url?.trim() || '')
const emailBound = computed(() => profileBindingStatus(props.user, ProfileAuthProvider.EMAIL))

watch(() => props.user.username, (value) => { username.value = value || '' })
watch(() => props.user.email, (value) => {
  if (!String(value || '').endsWith('.invalid')) emailForm.email = value || ''
})

function errorMessage(caught: unknown, fallback: string): string {
  const value = caught as { message?: string; response?: { data?: { detail?: string } } }
  return value.response?.data?.detail || value.message || fallback
}

function applyUser(user: User): void {
  auth.user = user
}

async function saveUsername(): Promise<void> {
  const value = username.value.trim()
  if (!value) { app.showError('用户名不能为空'); return }
  profileBusy.value = true
  try {
    applyUser(await updateProfile({ username: value }))
    app.showSuccess('用户名已更新')
  } catch (caught) {
    app.showError(errorMessage(caught, '用户名更新失败'))
  } finally { profileBusy.value = false }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = source
  })
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new Error('头像压缩失败'))
  }, 'image/webp', quality))
}

async function prepareAvatar(file: File): Promise<string> {
  const limit = 20 * 1024
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.type === 'image/gif') {
    if (file.size > limit) throw new Error('GIF 头像不能超过 20 KB')
    return readFile(file)
  }
  if (file.size <= limit) return readFile(file)
  const image = await loadImage(await readFile(file))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法处理头像')
  for (const scale of [1, .92, .84, .76, .68, .6, .52, .44, .36]) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [.92, .84, .76, .68, .6, .52, .44, .36]) {
      const blob = await canvasBlob(canvas, quality)
      if (blob.size <= limit) return readFile(new File([blob], 'avatar.webp', { type: 'image/webp' }))
    }
  }
  throw new Error('图片压缩后仍大于 20 KB，请更换图片')
}

async function selectAvatar(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try { avatarDraft.value = await prepareAvatar(file) }
  catch (caught) { app.showError(errorMessage(caught, '头像处理失败')) }
}

async function saveAvatar(value: string): Promise<void> {
  if (avatarBusy.value) return
  avatarBusy.value = true
  try {
    applyUser(await updateProfile({ avatar_url: value }))
    avatarDraft.value = ''
    app.showSuccess(value ? '头像已保存' : '头像已删除')
  } catch (caught) { app.showError(errorMessage(caught, '头像更新失败')) }
  finally { avatarBusy.value = false }
}

function bindable(provider: ProfileAuthProvider): provider is BindableProfileProvider {
  return [ProfileAuthProvider.LINUXDO, ProfileAuthProvider.DINGTALK, ProfileAuthProvider.OIDC, ProfileAuthProvider.WECHAT]
    .includes(provider)
}

function canBind(provider: ProfileAuthProvider, enabled: boolean): boolean {
  if (!bindable(provider) || !enabled || profileBindingStatus(props.user, provider)) return false
  return profileBindingDetails(props.user, provider)?.can_bind ?? true
}

function canUnbind(provider: ProfileAuthProvider): boolean {
  return bindable(provider)
    && profileBindingStatus(props.user, provider)
    && profileBindingDetails(props.user, provider)?.can_unbind === true
}

async function beginBinding(provider: ProfileAuthProvider): Promise<void> {
  if (!bindable(provider)) return
  await startOAuthBinding(provider, {
    redirectTo: route.fullPath || '/app/profile',
    wechatOAuthSettings: provider === ProfileAuthProvider.WECHAT ? app.cachedPublicSettings : null
  })
}

async function confirmUnbind(): Promise<void> {
  if (!unbindTarget.value) return
  unbinding.value = true
  try {
    applyUser(await unbindAuthIdentity(unbindTarget.value.provider))
    app.showSuccess(`${unbindTarget.value.label} 已解绑`)
    unbindTarget.value = null
  } catch (caught) { app.showError(errorMessage(caught, '解绑失败')) }
  finally { unbinding.value = false }
}

async function sendEmailCode(): Promise<void> {
  if (!validateEmail(emailForm.email)) { app.showError('请输入有效邮箱'); return }
  sendingEmailCode.value = true
  try {
    await sendEmailBindingCode(emailForm.email.trim())
    app.showSuccess(`验证码已发送至 ${emailForm.email.trim()}`)
  } catch (caught) { app.showError(errorMessage(caught, '验证码发送失败')) }
  finally { sendingEmailCode.value = false }
}

async function submitEmailBinding(): Promise<void> {
  if (!validateEmail(emailForm.email)) { app.showError('请输入有效邮箱'); return }
  if (emailForm.code.length !== 6) { app.showError('请输入 6 位验证码'); return }
  if (!emailForm.password || (!emailBound.value && emailForm.password.length < 6)) {
    app.showError(emailBound.value ? '请输入当前密码' : '请设置至少 6 位密码')
    return
  }
  bindingEmail.value = true
  try {
    applyUser(await bindEmailIdentity({
      email: emailForm.email.trim(), verify_code: emailForm.code, password: emailForm.password
    }))
    emailForm.code = ''
    emailForm.password = ''
    emailExpanded.value = false
    app.showSuccess(emailBound.value ? '邮箱已更换' : '邮箱身份已绑定')
  } catch (caught) { app.showError(errorMessage(caught, '邮箱绑定失败')) }
  finally { bindingEmail.value = false }
}
</script>

<template>
  <section class="profile-overview">
    <div class="profile-hero">
      <div class="profile-avatar profile-avatar--large">
        <img v-if="avatar" :src="avatar" :alt="displayName">
        <span v-else>{{ displayName.slice(0, 2).toUpperCase() }}</span>
      </div>
      <div class="profile-identity">
        <div><span class="profile-kicker">ACCOUNT IDENTITY</span><h2>{{ displayName }}</h2></div>
        <p>{{ displayableProfileEmail(user) || '尚未绑定可登录邮箱' }}</p>
        <div class="profile-badges"><span>{{ user.role === 'admin' ? '管理员' : '普通用户' }}</span><span :data-active="user.status === 'active'">{{ user.status === 'active' ? '账号正常' : '账号已停用' }}</span></div>
        <div v-if="sources.length" class="profile-sources"><span v-for="source in sources" :key="source.key">{{ source.text }}</span></div>
      </div>
      <dl class="profile-metrics">
        <div><dt>账户余额</dt><dd>${{ user.balance.toFixed(2) }}</dd></div>
        <div><dt>并发上限</dt><dd>{{ user.concurrency }}</dd></div>
        <div><dt>注册时间</dt><dd>{{ formatProfileDate(user.created_at) }}</dd></div>
      </dl>
    </div>

    <div class="profile-basics-grid">
      <article class="profile-card">
        <header><div><span>PROFILE IMAGE</span><h3>头像</h3></div><small>自动压缩至 20 KB 内</small></header>
        <div class="avatar-editor">
          <div class="profile-avatar"><img v-if="avatar" :src="avatar" :alt="displayName"><span v-else>{{ displayName.slice(0, 2).toUpperCase() }}</span></div>
          <div><label class="button button--secondary avatar-upload"><input type="file" accept="image/*" @change="selectAvatar">选择图片</label><button class="button button--primary" type="button" :disabled="!avatarDraft || avatarBusy" @click="saveAvatar(avatarDraft)">保存头像</button><button class="profile-danger-link" type="button" :disabled="avatarBusy || !avatar" @click="saveAvatar('')">删除</button></div>
        </div>
      </article>
      <article class="profile-card">
        <header><div><span>DISPLAY NAME</span><h3>基本资料</h3></div></header>
        <form class="profile-form" @submit.prevent="saveUsername">
          <label for="profile-username">用户名<input id="profile-username" v-model="username" maxlength="64" required></label>
          <label>主邮箱<input :value="displayableProfileEmail(user) || '未绑定'" disabled></label>
          <button class="button button--primary" :disabled="profileBusy">{{ profileBusy ? '保存中…' : '保存资料' }}</button>
        </form>
      </article>
    </div>

    <article class="profile-card identity-card">
      <header><div><span>SIGN-IN METHODS</span><h3>登录身份</h3><p>绑定多种登录方式，避免单一身份不可用时无法进入账号。</p></div></header>
      <div class="identity-list">
        <section v-for="item in providers" :key="item.provider" class="identity-row">
          <div class="identity-mark" :data-provider="item.provider">{{ item.provider === ProfileAuthProvider.EMAIL ? '@' : item.label.slice(0, 1) }}</div>
          <div class="identity-copy">
            <div><strong>{{ item.label }}</strong><span :data-bound="profileBindingStatus(user, item.provider)">{{ profileBindingStatus(user, item.provider) ? '已绑定' : item.enabled ? '未绑定' : '管理员未启用' }}</span></div>
            <p v-if="item.provider === ProfileAuthProvider.EMAIL">{{ displayableProfileEmail(user) || '绑定邮箱后可使用密码登录' }}</p>
            <p v-for="summary in bindingSummary(profileBindingDetails(user, item.provider))" :key="summary">{{ summary }}</p>
          </div>
          <div class="identity-actions">
            <button v-if="item.provider === ProfileAuthProvider.EMAIL" type="button" @click="emailExpanded = !emailExpanded">{{ emailExpanded ? '收起' : emailBound ? '更换邮箱' : '绑定邮箱' }}</button>
            <button v-if="canBind(item.provider, item.enabled)" type="button" @click="beginBinding(item.provider)">绑定</button>
            <button v-if="canUnbind(item.provider)" class="danger" type="button" @click="unbindTarget = { provider: item.provider as BindableProfileProvider, label: item.label }">解绑</button>
          </div>
          <form v-if="item.provider === ProfileAuthProvider.EMAIL && emailExpanded" class="email-binding-form" @submit.prevent="submitEmailBinding">
            <label>邮箱<input v-model.trim="emailForm.email" type="email" required></label>
            <button class="button button--secondary" type="button" :disabled="sendingEmailCode" @click="sendEmailCode">{{ sendingEmailCode ? '发送中…' : '发送验证码' }}</button>
            <label>验证码<input v-model.trim="emailForm.code" maxlength="6" inputmode="numeric" required></label>
            <label>{{ emailBound ? '当前密码' : '设置登录密码' }}<input v-model="emailForm.password" type="password" autocomplete="current-password" required></label>
            <button class="button button--primary" :disabled="bindingEmail">{{ bindingEmail ? '提交中…' : emailBound ? '确认更换' : '确认绑定' }}</button>
          </form>
        </section>
      </div>
    </article>

    <SurfaceDialog :show="Boolean(unbindTarget)" title="解绑登录身份" :description="`确认解绑 ${unbindTarget?.label || ''}？其他已绑定的登录方式不受影响。`" :width="DialogWidth.COMPACT" @close="unbindTarget = null">
      <p class="dialog-warning">解绑前请确保仍有其他可用登录方式。</p>
      <template #footer><button class="button button--secondary" type="button" @click="unbindTarget = null">取消</button><button class="button profile-danger-button" type="button" :disabled="unbinding" @click="confirmUnbind">{{ unbinding ? '解绑中…' : '确认解绑' }}</button></template>
    </SurfaceDialog>
  </section>
</template>

<style scoped>
.profile-overview { display: grid; gap: 14px; }.profile-hero { padding: 27px; display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(330px, .75fr); align-items: center; gap: 22px; overflow: hidden; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, var(--surface-raised)), var(--surface-raised) 52%, color-mix(in srgb, #f4b45c 9%, var(--surface-raised))); border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-subtle)); border-radius: 18px; }.profile-avatar { width: 74px; height: 74px; display: grid; place-items: center; overflow: hidden; color: white; background: var(--accent); border-radius: 21px; font-size: 18px; font-weight: 800; }.profile-avatar--large { width: 90px; height: 90px; border-radius: 26px; }.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }.profile-identity { min-width: 0; display: grid; gap: 6px; }.profile-kicker, .profile-card header span { color: var(--accent); font-size: var(--font-meta); font-weight: 760; letter-spacing: .12em; }.profile-identity h2 { margin: 3px 0 0; font-size: 27px; }.profile-identity > p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); }.profile-badges, .profile-sources { display: flex; flex-wrap: wrap; gap: 6px; }.profile-badges span, .profile-sources span { padding: 4px 7px; color: var(--text-secondary); background: color-mix(in srgb, var(--surface-raised) 80%, transparent); border: 1px solid var(--border-subtle); border-radius: 999px; font-size: var(--font-caption); }.profile-badges span[data-active="true"] { color: var(--success); }.profile-metrics { margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); background: color-mix(in srgb, var(--surface-raised) 72%, transparent); border: 1px solid var(--border-subtle); border-radius: 13px; }.profile-metrics div { min-width: 0; padding: 14px; border-right: 1px solid var(--border-subtle); }.profile-metrics div:last-child { border: 0; }.profile-metrics dt { color: var(--text-secondary); font-size: var(--font-caption); }.profile-metrics dd { margin: 5px 0 0; overflow-wrap: anywhere; font-size: var(--font-body-sm); font-weight: 730; }.profile-basics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }.profile-card { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }.profile-card > header { min-height: 72px; padding: 15px 18px; display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }.profile-card header h3 { margin: 4px 0 0; font-size: 18px; }.profile-card header p, .profile-card header small { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.6; }.avatar-editor { min-height: 165px; padding: 22px; display: flex; align-items: center; gap: 20px; }.avatar-editor > div:last-child { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }.avatar-upload { position: relative; cursor: pointer; }.avatar-upload input { position: absolute; width: 1px; height: 1px; opacity: 0; }.profile-danger-link { min-height: 35px; padding: 0 8px; color: var(--danger); background: transparent; border: 0; cursor: pointer; font-size: var(--font-meta); }.profile-form { padding: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.profile-form label, .email-binding-form label { display: grid; gap: 6px; color: var(--text-secondary); font-size: var(--font-meta); }.profile-form input, .email-binding-form input { width: 100%; min-height: 42px; padding: 0 11px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.profile-form button { grid-column: 1 / -1; justify-self: end; }.identity-card > header { min-height: 82px; }.identity-list { display: grid; }.identity-row { padding: 16px 18px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 13px; border-bottom: 1px solid var(--border-subtle); }.identity-row:last-child { border: 0; }.identity-mark { width: 40px; height: 40px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 12px; font-size: 12px; font-weight: 800; }.identity-mark[data-provider="wechat"] { color: #078846; background: color-mix(in srgb, #07c160 12%, transparent); }.identity-copy { min-width: 0; display: grid; gap: 4px; }.identity-copy > div { display: flex; align-items: center; gap: 8px; }.identity-copy strong { font-size: var(--font-body-sm); }.identity-copy span { padding: 3px 6px; color: var(--text-secondary); background: var(--surface-canvas); border-radius: 999px; font-size: var(--font-caption); }.identity-copy span[data-bound="true"] { color: var(--success); background: color-mix(in srgb, var(--success) 9%, transparent); }.identity-copy p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); }.identity-actions { display: flex; gap: 6px; }.identity-actions button { min-height: 33px; padding: 0 9px; color: var(--accent); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.identity-actions button.danger { color: var(--danger); }.email-binding-form { grid-column: 2 / -1; padding: 13px; display: grid; grid-template-columns: minmax(180px, 1fr) auto minmax(130px, .5fr) minmax(160px, .7fr) auto; align-items: end; gap: 8px; background: var(--surface-canvas); border-radius: 10px; }.email-binding-form .button { min-height: 42px; }.dialog-warning { margin: 0; color: var(--danger); font-size: var(--font-meta); }.profile-danger-button { color: white; background: var(--danger); border-color: var(--danger); }
@media (max-width: 1100px) { .profile-hero { grid-template-columns: auto 1fr; }.profile-metrics { grid-column: 1 / -1; }.email-binding-form { grid-template-columns: 1fr 1fr; }.email-binding-form .button { width: 100%; } }
@media (max-width: 760px) { .profile-hero { grid-template-columns: 1fr; }.profile-avatar--large { width: 74px; height: 74px; }.profile-basics-grid { grid-template-columns: 1fr; }.profile-metrics { grid-template-columns: 1fr; }.profile-metrics div { border-right: 0; border-bottom: 1px solid var(--border-subtle); }.profile-form { grid-template-columns: 1fr; }.identity-row { grid-template-columns: auto 1fr; }.identity-actions { grid-column: 2; }.email-binding-form { grid-column: 1 / -1; grid-template-columns: 1fr; } }
</style>
