<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { passkeyAPI, type PasskeyCredentialSummary } from '@shared-api/passkey'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { formatProfileDate } from '@/features/user/profile/model'
import { useAppStore } from '@/stores/app'

enum PasskeyDialogMode {
  CLOSED = 'closed',
  ADD = 'add',
  RENAME = 'rename',
  REMOVE = 'remove'
}

const props = defineProps<{ enabled: boolean }>()
const app = useAppStore()
const supported = passkeyAPI.isSupported()
const loading = ref(false)
const busy = ref(false)
const credentials = ref<PasskeyCredentialSummary[]>([])
const mode = ref(PasskeyDialogMode.CLOSED)
const target = ref<PasskeyCredentialSummary | null>(null)
const name = ref('')
const password = ref('')

const dialogTitle = computed(() => mode.value === PasskeyDialogMode.ADD
  ? '添加 Passkey'
  : mode.value === PasskeyDialogMode.RENAME ? '重命名 Passkey' : '删除 Passkey')
const dialogDescription = computed(() => mode.value === PasskeyDialogMode.ADD
  ? '验证当前密码后，浏览器将启动系统级 Passkey 创建流程。'
  : mode.value === PasskeyDialogMode.RENAME
    ? '名称仅用于识别这枚凭据。'
    : '删除需验证当前密码，操作完成后该凭据不再可用于登录。')

function message(caught: unknown, fallback: string): string {
  const value = caught as { message?: string; reason?: string }
  return value.message || fallback
}

async function load(): Promise<void> {
  if (!props.enabled) { credentials.value = []; return }
  loading.value = true
  try { credentials.value = await passkeyAPI.list() }
  catch (caught) {
    if ((caught as { reason?: string }).reason !== 'PASSKEY_DISABLED') {
      app.showError(message(caught, 'Passkey 列表加载失败'))
    }
  } finally { loading.value = false }
}

function close(): void {
  if (busy.value) return
  mode.value = PasskeyDialogMode.CLOSED
  target.value = null
  name.value = ''
  password.value = ''
}

function openAdd(): void {
  target.value = null
  name.value = ''
  password.value = ''
  mode.value = PasskeyDialogMode.ADD
}

function openRename(item: PasskeyCredentialSummary): void {
  target.value = item
  name.value = item.name
  password.value = ''
  mode.value = PasskeyDialogMode.RENAME
}

function openRemove(item: PasskeyCredentialSummary): void {
  target.value = item
  name.value = ''
  password.value = ''
  mode.value = PasskeyDialogMode.REMOVE
}

async function submit(): Promise<void> {
  if (mode.value === PasskeyDialogMode.ADD) {
    if (!password.value) { app.showError('请输入当前密码'); return }
    busy.value = true
    try {
      await passkeyAPI.register(name.value.trim(), password.value)
      app.showSuccess('Passkey 已添加')
      closeAfterBusy()
      await load()
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'NotAllowedError')) {
        app.showError(message(caught, 'Passkey 创建失败'))
      }
    } finally { busy.value = false }
    return
  }
  if (mode.value === PasskeyDialogMode.RENAME && target.value) {
    const nextName = name.value.trim()
    if (!nextName) { app.showError('名称不能为空'); return }
    busy.value = true
    try {
      await passkeyAPI.rename(target.value.id, nextName)
      target.value.name = nextName
      app.showSuccess('Passkey 已重命名')
      closeAfterBusy()
    } catch (caught) { app.showError(message(caught, '重命名失败')) }
    finally { busy.value = false }
    return
  }
  if (mode.value === PasskeyDialogMode.REMOVE && target.value) {
    if (!password.value) { app.showError('请输入当前密码'); return }
    busy.value = true
    try {
      await passkeyAPI.remove(target.value.id, password.value)
      credentials.value = credentials.value.filter((item) => item.id !== target.value?.id)
      app.showSuccess('Passkey 已删除')
      closeAfterBusy()
    } catch (caught) { app.showError(message(caught, 'Passkey 删除失败')) }
    finally { busy.value = false }
  }
}

function closeAfterBusy(): void {
  mode.value = PasskeyDialogMode.CLOSED
  target.value = null
  name.value = ''
  password.value = ''
}

watch(() => props.enabled, () => { void load() }, { immediate: true })
</script>

<template>
  <article class="security-card passkey-card">
    <header><div><span>PASSKEYS</span><h3>通行密钥</h3><p>使用指纹、面容或设备 PIN 完成抗钓鱼登录。</p></div><button v-if="enabled && supported" class="button button--primary" type="button" @click="openAdd">添加 Passkey</button></header>
    <div v-if="!enabled" class="security-state"><strong>管理员未启用 Passkey</strong><span>功能开启后可在这里管理凭据。</span></div>
    <div v-else-if="!supported" class="security-state"><strong>当前浏览器不支持 Passkey</strong><span>请使用新版 Chrome、Safari、Edge 或 Firefox。</span></div>
    <div v-else-if="loading" class="security-state" role="status">正在读取 Passkey…</div>
    <div v-else-if="!credentials.length" class="security-state"><strong>还没有 Passkey</strong><span>添加后可作为密码登录的安全替代方式。</span></div>
    <div v-else class="passkey-list">
      <section v-for="item in credentials" :key="item.id">
        <div class="passkey-mark">PK</div><div><strong>{{ item.name || '未命名 Passkey' }} <span v-if="item.backup">已同步</span></strong><p>创建 {{ formatProfileDate(item.created_at) }}<template v-if="item.last_used_at"> · 最近使用 {{ formatProfileDate(item.last_used_at) }}</template></p></div><div><button type="button" @click="openRename(item)">重命名</button><button class="danger" type="button" @click="openRemove(item)">删除</button></div>
      </section>
    </div>

    <SurfaceDialog :show="mode !== PasskeyDialogMode.CLOSED" :title="dialogTitle" :description="dialogDescription" :width="DialogWidth.COMPACT" @close="close">
      <form class="passkey-form" @submit.prevent="submit">
        <label v-if="mode !== PasskeyDialogMode.REMOVE">Passkey 名称<input v-model="name" maxlength="100" :placeholder="mode === PasskeyDialogMode.ADD ? '例如：MacBook Touch ID' : ''" required></label>
        <label v-if="mode !== PasskeyDialogMode.RENAME">当前密码<input v-model="password" type="password" autocomplete="current-password" required></label>
        <p v-if="mode === PasskeyDialogMode.REMOVE" class="danger-copy">即将删除“{{ target?.name }}”，此操作不可撤销。</p>
      </form>
      <template #footer><button class="button button--secondary" type="button" :disabled="busy" @click="close">取消</button><button class="button" :class="mode === PasskeyDialogMode.REMOVE ? 'security-danger-button' : 'button--primary'" type="button" :disabled="busy" @click="submit">{{ busy ? '处理中…' : mode === PasskeyDialogMode.ADD ? '继续创建' : mode === PasskeyDialogMode.RENAME ? '保存名称' : '确认删除' }}</button></template>
    </SurfaceDialog>
  </article>
</template>

<style scoped>
.security-card { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 15px; }.security-card > header { min-height: 78px; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--border-subtle); }.security-card header span { color: var(--accent); font-size: var(--font-meta); font-weight: 760; letter-spacing: .12em; }.security-card h3 { margin: 4px 0 0; font-size: 18px; }.security-card header p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.security-state { min-height: 136px; display: grid; place-content: center; justify-items: center; gap: 5px; color: var(--text-secondary); font-size: var(--font-meta); text-align: center; }.security-state strong { color: var(--text-primary); font-size: 12px; }.passkey-list { display: grid; }.passkey-list section { min-height: 71px; padding: 12px 18px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--border-subtle); }.passkey-list section:last-child { border: 0; }.passkey-mark { width: 42px; height: 42px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 12px; font-size: var(--font-meta); font-weight: 800; }.passkey-list section > div:nth-child(2) { display: grid; gap: 4px; }.passkey-list strong { font-size: var(--font-meta); }.passkey-list strong span { padding: 3px 6px; color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); border-radius: 999px; font-size: var(--font-caption); }.passkey-list p { margin: 0; color: var(--text-secondary); font-size: var(--font-caption); }.passkey-list section > div:last-child { display: flex; gap: 6px; }.passkey-list button:not(.button) { min-height: 32px; padding: 0 8px; color: var(--accent); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: var(--font-caption); }.passkey-list button.danger { color: var(--danger); }.passkey-form { display: grid; gap: 12px; }.passkey-form label { display: grid; gap: 7px; color: var(--text-secondary); font-size: var(--font-meta); }.passkey-form input { min-height: 44px; padding: 0 11px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; }.danger-copy { margin: 0; color: var(--danger); font-size: var(--font-meta); line-height: 1.6; }.security-danger-button { color: white; background: var(--danger); border-color: var(--danger); } @media (max-width: 620px) { .security-card > header { align-items: stretch; flex-direction: column; }.security-card > header > button { width: 100%; }.passkey-list section { grid-template-columns: auto 1fr; }.passkey-list section > div:last-child { grid-column: 2; } }
</style>
