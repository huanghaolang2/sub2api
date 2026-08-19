<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { isWeChatWebOAuthEnabled, revokeAllSessions } from '@shared-api/auth'
import ConsoleShell from '@/components/layout/ConsoleShell.vue'
import PageState from '@/components/base/PageState.vue'
import ProfileBalanceNotifyPanel from '@/components/user/profile/ProfileBalanceNotifyPanel.vue'
import ProfileOverviewPanel from '@/components/user/profile/ProfileOverviewPanel.vue'
import ProfilePasskeyPanel from '@/components/user/profile/ProfilePasskeyPanel.vue'
import ProfilePasswordPanel from '@/components/user/profile/ProfilePasswordPanel.vue'
import ProfileTotpPanel from '@/components/user/profile/ProfileTotpPanel.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'

enum ProfileSection {
  IDENTITY = 'identity',
  SECURITY = 'security'
}

const auth = useAuthStore()
const app = useAppStore()
const confirmDialog = useConfirmStore()
const router = useRouter()
const loading = ref(true)
const revokingSessions = ref(false)
const error = ref('')
const activeSection = ref(ProfileSection.IDENTITY)

const settings = computed(() => app.cachedPublicSettings)
const contactInfo = computed(() => settings.value?.contact_info?.trim() || '')
const linuxdoEnabled = computed(() => settings.value?.linuxdo_oauth_enabled === true)
const dingtalkEnabled = computed(() => settings.value?.dingtalk_oauth_enabled === true)
const oidcEnabled = computed(() => settings.value?.oidc_oauth_enabled === true)
const oidcName = computed(() => settings.value?.oidc_oauth_provider_name?.trim() || 'OIDC')
const wechatEnabled = computed(() => isWeChatWebOAuthEnabled(settings.value))
const passkeyEnabled = computed(() => settings.value?.passkey_enabled === true)
const notifyEnabled = computed(() => settings.value?.balance_low_notify_enabled === true)
const defaultThreshold = computed(() => Number(settings.value?.balance_low_notify_threshold || 0))

async function initialize(): Promise<void> {
  loading.value = true
  error.value = ''
  const [profileResult, settingsResult] = await Promise.allSettled([
    auth.refreshUser(),
    app.fetchPublicSettings()
  ])
  if (profileResult.status === 'rejected' && !auth.user) {
    error.value = (profileResult.reason as { message?: string }).message || '个人资料加载失败'
  } else if (settingsResult.status === 'rejected') {
    error.value = (settingsResult.reason as { message?: string }).message || '账户安全配置加载失败'
  }
  loading.value = false
}

async function revokeSessions(): Promise<void> {
  const confirmed = await confirmDialog.ask({
    title: '退出所有设备',
    message: '所有设备上的登录会话都会立即失效，包括当前设备。完成后需要重新登录。',
    confirmText: '吊销全部会话',
    tone: ConfirmTone.DANGER,
  })
  if (!confirmed) return
  revokingSessions.value = true
  try {
    await revokeAllSessions()
    await auth.logout()
    app.showSuccess('全部登录会话已吊销')
    await router.replace('/login')
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '会话吊销失败，请稍后重试')
  } finally {
    revokingSessions.value = false
  }
}

onMounted(() => { void initialize() })
</script>

<template>
  <ConsoleShell>
    <div class="profile-page">
      <header class="profile-heading">
        <div><p>账户 / 身份与安全</p><h1>个人设置</h1><span>管理对外展示身份、登录方式、通知与二次验证。</span></div>
        <nav aria-label="个人设置分区"><button type="button" :class="{ active: activeSection === ProfileSection.IDENTITY }" @click="activeSection = ProfileSection.IDENTITY">资料与身份</button><button type="button" :class="{ active: activeSection === ProfileSection.SECURITY }" @click="activeSection = ProfileSection.SECURITY">安全与通知</button></nav>
      </header>

      <PageState :loading="loading" :error="error" @retry="initialize">
        <template v-if="auth.user">
          <ProfileOverviewPanel
            v-if="activeSection === ProfileSection.IDENTITY"
            :user="auth.user"
            :linuxdo-enabled="linuxdoEnabled"
            :dingtalk-enabled="dingtalkEnabled"
            :oidc-enabled="oidcEnabled"
            :oidc-provider-name="oidcName"
            :wechat-enabled="wechatEnabled"
          />

          <div v-else class="security-layout">
            <div v-if="contactInfo" class="support-note"><span>SUPPORT</span><div><strong>需要帮助？</strong><p>{{ contactInfo }}</p></div></div>
            <ProfilePasswordPanel />
            <article class="session-card">
              <div><span>SESSIONS</span><h3>登录会话</h3><p>发现陌生设备或凭据泄露时，可一次性让所有设备重新登录。</p></div>
              <button class="button button--danger" :disabled="revokingSessions" @click="revokeSessions">{{ revokingSessions ? '正在吊销…' : '退出所有设备' }}</button>
            </article>
            <ProfileBalanceNotifyPanel v-if="notifyEnabled" :user="auth.user" :system-default-threshold="defaultThreshold" />
            <div v-else class="feature-note"><strong>余额不足邮件通知未开启</strong><span>该功能由管理员在系统设置中统一控制。</span></div>
            <div class="security-grid"><ProfileTotpPanel /><ProfilePasskeyPanel :enabled="passkeyEnabled" /></div>
          </div>
        </template>
      </PageState>
    </div>
  </ConsoleShell>
</template>

<style scoped>
.profile-page { width: min(1320px, 100%); margin: 0 auto; padding-bottom: 58px; }.profile-heading { margin-bottom: 22px; display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; }.profile-heading > div > p { margin: 0 0 7px; color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .1em; text-transform: uppercase; }.profile-heading h1 { font-size: clamp(40px, 5vw, 64px); }.profile-heading > div > span { margin-top: 11px; display: block; color: var(--text-secondary); font-size: var(--font-body-sm); }.profile-heading nav { padding: 4px; display: flex; gap: 3px; background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 11px; }.profile-heading nav button { min-height: 36px; padding: 0 13px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 8px; cursor: pointer; font-size: var(--font-meta); }.profile-heading nav button.active { color: white; background: var(--accent); }.security-layout { display: grid; gap: 14px; }.security-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }.support-note, .feature-note { min-height: 74px; padding: 15px 18px; display: flex; align-items: center; gap: 15px; background: color-mix(in srgb, var(--accent) 7%, var(--surface-raised)); border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border-subtle)); border-radius: 13px; }.support-note > span { color: var(--accent); font-size: var(--font-meta); font-weight: 760; letter-spacing: .12em; }.support-note div, .feature-note { display: grid; gap: 4px; }.support-note strong, .feature-note strong { font-size: var(--font-meta); }.support-note p, .feature-note span { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); }
.session-card { min-height: 92px; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 20px; background: color-mix(in srgb, var(--danger) 4%, var(--surface-raised)); border: 1px solid color-mix(in srgb, var(--danger) 22%, var(--border-subtle)); border-radius: 15px; }.session-card > div { display: grid; gap: 4px; }.session-card span { color: var(--danger); font-size: var(--font-meta); font-weight: 760; letter-spacing: .12em; }.session-card h3 { margin: 0; font-size: 18px; }.session-card p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); }
@media (max-width: 900px) { .profile-heading { align-items: stretch; flex-direction: column; }.profile-heading nav { width: 100%; }.profile-heading nav button { flex: 1; }.security-grid { grid-template-columns: 1fr; } }
@media (max-width: 620px) { .session-card { align-items: stretch; flex-direction: column; }.session-card button { width: 100%; } }
</style>
