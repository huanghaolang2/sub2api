import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { getSetupStatus } from '@/api/setup'
import { useAdminComplianceStore } from '@/stores/adminCompliance'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { OAuthProvider } from '@/features/public/model'
import { useNavigationLoadingState } from '@shared-composables/useNavigationLoading'
import { RouteFeature } from './contracts'
import { isRouteFeatureEnabled, prepareRouteFeature } from './features'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    alias: '/home',
    name: 'home',
    component: () => import('@/views/public/HomeView.vue'),
    meta: { requiresAuth: false, title: '首页' }
  },
  {
    path: '/pricing',
    alias: '/model-plaza',
    name: 'pricing',
    component: () => import('@/views/public/PricingView.vue'),
    meta: { requiresAuth: false, title: '模型与价格', feature: RouteFeature.MODEL_PLAZA }
  },
  {
    path: '/setup',
    name: 'setup',
    component: () => import('@/views/public/SetupView.vue'),
    meta: { requiresAuth: false, title: '初始化安装' }
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { requiresAuth: false, title: '登录' }
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/auth/RegisterView.vue'),
    meta: { requiresAuth: false, title: '注册' }
  },
  {
    path: '/email-verify',
    name: 'email-verify',
    component: () => import('@/views/auth/EmailVerifyView.vue'),
    meta: { requiresAuth: false, title: '验证邮箱' }
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/views/auth/ForgotPasswordView.vue'),
    meta: { requiresAuth: false, title: '找回密码' }
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/views/auth/ResetPasswordView.vue'),
    meta: { requiresAuth: false, title: '重置密码' }
  },
  {
    path: '/auth/callback',
    alias: '/auth/oauth/callback',
    name: 'oauth-callback',
    component: () => import('@/views/auth/OAuthProviderCallbackView.vue'),
    meta: { requiresAuth: false, title: 'OAuth 回调' }
  },
  {
    path: '/auth/linuxdo/callback',
    name: 'linuxdo-callback',
    component: () => import('@/views/auth/OAuthProviderCallbackView.vue'),
    props: { provider: OAuthProvider.LINUXDO },
    meta: { requiresAuth: false, title: 'LinuxDo 回调' }
  },
  {
    path: '/auth/wechat/callback',
    name: 'wechat-callback',
    component: () => import('@/views/auth/OAuthProviderCallbackView.vue'),
    props: { provider: OAuthProvider.WECHAT },
    meta: { requiresAuth: false, title: '微信回调' }
  },
  {
    path: '/auth/wechat/payment/callback',
    name: 'wechat-payment-callback',
    component: () => import('@/views/auth/WechatPaymentCallbackView.vue'),
    meta: { requiresAuth: false, title: '微信支付回调' }
  },
  {
    path: '/auth/dingtalk/callback',
    name: 'dingtalk-callback',
    component: () => import('@/views/auth/OAuthProviderCallbackView.vue'),
    props: { provider: OAuthProvider.DINGTALK },
    meta: { requiresAuth: false, title: '钉钉回调' }
  },
  {
    path: '/auth/dingtalk/email-completion',
    name: 'dingtalk-email-completion',
    component: () => import('@/views/auth/OAuthProviderCallbackView.vue'),
    props: { provider: OAuthProvider.DINGTALK, forceCreate: true },
    meta: { requiresAuth: false, title: '补全邮箱' }
  },
  {
    path: '/auth/oidc/callback',
    name: 'oidc-callback',
    component: () => import('@/views/auth/OAuthProviderCallbackView.vue'),
    props: { provider: OAuthProvider.OIDC },
    meta: { requiresAuth: false, title: 'OIDC 回调' }
  },
  {
    path: '/key-usage',
    name: 'key-usage',
    component: () => import('@/views/public/KeyUsageView.vue'),
    meta: { requiresAuth: false, title: 'Key 用量' }
  },
  {
    path: '/legal/:documentId',
    name: 'legal-document',
    component: () => import('@/views/public/LegalDocumentView.vue'),
    meta: { requiresAuth: false, title: '法律文档' }
  },
  {
    path: '/payment/result',
    name: 'payment-result',
    component: () => import('@/views/user/PaymentResultView.vue'),
    meta: { requiresAuth: false, title: '支付结果' }
  },
  {
    path: '/payment/stripe',
    name: 'stripe-payment',
    component: () => import('@/views/user/StripePaymentView.vue'),
    meta: { requiresAuth: false, title: 'Stripe 支付' }
  },
  {
    path: '/payment/airwallex',
    name: 'airwallex-payment',
    component: () => import('@/views/user/AirwallexPaymentView.vue'),
    meta: { requiresAuth: false, title: 'Airwallex 支付' }
  },
  {
    path: '/payment/stripe-popup',
    name: 'stripe-popup',
    component: () => import('@/views/user/StripePopupView.vue'),
    meta: { requiresAuth: false, title: 'Stripe 支付窗口' }
  },

  {
    path: '/app/dashboard',
    alias: '/dashboard',
    name: 'app-dashboard',
    component: () => import('@/views/user/DashboardView.vue'),
    meta: { requiresAuth: true, title: '我的概览' }
  },
  {
    path: '/app/keys',
    alias: '/keys',
    name: 'app-keys',
    component: () => import('@/views/user/KeysView.vue'),
    meta: { requiresAuth: true, title: 'API Key' }
  },
  {
    path: '/app/batch-image',
    alias: ['/batch-image', '/docs/batch-image'],
    name: 'app-batch-image',
    component: () => import('@/views/user/BatchImageView.vue'),
    meta: { requiresAuth: true, title: '批量图片', feature: RouteFeature.BATCH_IMAGE, hideInSimpleMode: true }
  },
  {
    path: '/app/usage',
    alias: '/usage',
    name: 'app-usage',
    component: () => import('@/views/user/UsageView.vue'),
    meta: { requiresAuth: true, title: '用量明细', hideInSimpleMode: true }
  },
  {
    path: '/app/models',
    name: 'app-models',
    component: () => import('@/views/user/ModelsView.vue'),
    meta: { requiresAuth: true, title: '模型与价格' }
  },
  {
    path: '/app/models/available',
    alias: '/available-channels',
    name: 'app-models-available',
    component: () => import('@/views/user/AvailableChannelsView.vue'),
    meta: { requiresAuth: true, title: '可用模型', feature: RouteFeature.AVAILABLE_CHANNELS, hideInSimpleMode: true }
  },
  {
    path: '/app/monitor',
    alias: '/monitor',
    name: 'app-monitor',
    component: () => import('@/views/user/MonitorView.vue'),
    meta: { requiresAuth: true, title: '服务状态', feature: RouteFeature.CHANNEL_MONITOR }
  },
  {
    path: '/app/subscriptions',
    alias: '/subscriptions',
    name: 'app-subscriptions',
    component: () => import('@/views/user/BillingView.vue'),
    meta: { requiresAuth: true, title: '我的订阅', hideInSimpleMode: true }
  },
  { path: '/app/billing', redirect: '/app/subscriptions' },
  {
    path: '/app/purchase',
    alias: '/purchase',
    name: 'app-purchase',
    component: () => import('@/views/user/PaymentView.vue'),
    meta: { requiresAuth: true, title: '购买与充值', feature: RouteFeature.PAYMENT, hideInSimpleMode: true }
  },
  {
    path: '/app/orders',
    alias: '/orders',
    name: 'app-orders',
    component: () => import('@/views/user/UserOrdersView.vue'),
    meta: { requiresAuth: true, title: '我的订单', feature: RouteFeature.PAYMENT, hideInSimpleMode: true }
  },
  {
    path: '/payment/qrcode',
    name: 'payment-qrcode',
    component: () => import('@/views/user/PaymentQRCodeView.vue'),
    meta: { requiresAuth: true, title: '扫码支付', feature: RouteFeature.PAYMENT }
  },
  {
    path: '/app/redeem',
    alias: '/redeem',
    name: 'app-redeem',
    component: () => import('@/views/user/RedeemView.vue'),
    meta: { requiresAuth: true, title: '兑换码', hideInSimpleMode: true }
  },
  {
    path: '/app/affiliate',
    alias: '/affiliate',
    name: 'app-affiliate',
    component: () => import('@/views/user/AffiliateView.vue'),
    meta: { requiresAuth: true, title: '邀请返利', feature: RouteFeature.AFFILIATE, hideInSimpleMode: true }
  },
  {
    path: '/app/profile',
    alias: '/profile',
    name: 'app-profile',
    component: () => import('@/views/user/ProfileView.vue'),
    meta: { requiresAuth: true, title: '个人设置' }
  },
  {
    path: '/custom/:id',
    name: 'custom-page',
    component: () => import('@/views/user/CustomPageView.vue'),
    meta: { requiresAuth: true, title: '自定义页面' }
  },

  { path: '/admin', redirect: '/admin/dashboard' },
  {
    path: '/admin/dashboard',
    name: 'admin-dashboard',
    component: () => import('@/views/admin/DashboardView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '平台概览' }
  },
  {
    path: '/admin/ops',
    name: 'admin-ops',
    component: () => import('@/views/admin/OpsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '实时运维', feature: RouteFeature.OPS_MONITORING }
  },
  {
    path: '/admin/users',
    name: 'admin-users',
    component: () => import('@/views/admin/UsersView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '用户管理', hideInSimpleMode: true }
  },
  {
    path: '/admin/groups',
    name: 'admin-groups',
    component: () => import('@/views/admin/GroupsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '分组与定价', hideInSimpleMode: true }
  },
  { path: '/admin/channels', redirect: '/admin/channels/pricing' },
  {
    path: '/admin/channels/pricing',
    name: 'admin-channels',
    component: () => import('@/views/admin/ChannelsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '渠道与价格', hideInSimpleMode: true }
  },
  {
    path: '/admin/channels/monitor',
    name: 'admin-channel-monitor',
    component: () => import('@/views/admin/ChannelMonitorView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '渠道监控', feature: RouteFeature.CHANNEL_MONITOR }
  },
  {
    path: '/admin/accounts',
    name: 'admin-accounts',
    component: () => import('@/views/admin/AccountsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '上游账号' }
  },
  {
    path: '/admin/proxies',
    name: 'admin-proxies',
    component: () => import('@/views/admin/ProxiesView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '代理资源' }
  },
  {
    path: '/admin/subscriptions',
    name: 'admin-subscriptions',
    component: () => import('@/views/admin/SubscriptionsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '用户订阅', hideInSimpleMode: true }
  },
  {
    path: '/admin/orders/dashboard',
    name: 'admin-payment-dashboard',
    component: () => import('@/views/admin/PaymentDashboardView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '支付概览', feature: RouteFeature.PAYMENT }
  },
  {
    path: '/admin/orders',
    name: 'admin-orders',
    component: () => import('@/views/admin/OrdersView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '订单管理', feature: RouteFeature.PAYMENT, hideInSimpleMode: true }
  },
  {
    path: '/admin/orders/plans',
    name: 'admin-payment-plans',
    component: () => import('@/views/admin/PaymentSetupView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '计划与支付', feature: RouteFeature.PAYMENT }
  },
  {
    path: '/admin/redeem',
    name: 'admin-redeem',
    component: () => import('@/views/admin/RedeemCodesView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '兑换码管理', hideInSimpleMode: true }
  },
  {
    path: '/admin/promo-codes',
    name: 'admin-promo-codes',
    component: () => import('@/views/admin/PromoCodesView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '促销码管理', hideInSimpleMode: true }
  },
  { path: '/admin/affiliates', redirect: '/admin/affiliates/invites' },
  {
    path: '/admin/affiliates/invites',
    name: 'admin-affiliate-invites',
    component: () => import('@/views/admin/AffiliatesView.vue'),
    props: { kind: 'invites' },
    meta: { requiresAuth: true, requiresAdmin: true, title: '邀请记录', feature: RouteFeature.AFFILIATE, hideInSimpleMode: true }
  },
  {
    path: '/admin/affiliates/rebates',
    name: 'admin-affiliate-rebates',
    component: () => import('@/views/admin/AffiliatesView.vue'),
    props: { kind: 'rebates' },
    meta: { requiresAuth: true, requiresAdmin: true, title: '返利记录', feature: RouteFeature.AFFILIATE, hideInSimpleMode: true }
  },
  {
    path: '/admin/affiliates/transfers',
    name: 'admin-affiliate-transfers',
    component: () => import('@/views/admin/AffiliatesView.vue'),
    props: { kind: 'transfers' },
    meta: { requiresAuth: true, requiresAdmin: true, title: '转账记录', feature: RouteFeature.AFFILIATE, hideInSimpleMode: true }
  },
  {
    path: '/admin/announcements',
    name: 'admin-announcements',
    component: () => import('@/views/admin/AnnouncementsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '公告与内容' }
  },
  {
    path: '/admin/usage',
    name: 'admin-usage',
    component: () => import('@/views/admin/AdminUsageView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '用量审计' }
  },
  {
    path: '/admin/audit-logs',
    name: 'admin-audit-logs',
    component: () => import('@/views/admin/AuditLogsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '操作审计', hideInSimpleMode: true }
  },
  {
    path: '/admin/risk-control',
    name: 'admin-risk-control',
    component: () => import('@/views/admin/RiskControlView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '内容风控', feature: RouteFeature.RISK_CONTROL }
  },
  {
    path: '/admin/prompt-audit',
    name: 'admin-prompt-audit',
    component: () => import('@/views/admin/PromptAuditView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '提示词审计', feature: RouteFeature.RISK_CONTROL }
  },
  {
    path: '/admin/settings',
    name: 'admin-settings',
    component: () => import('@/views/admin/SettingsView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '系统设置' }
  },
  {
    path: '/admin/data',
    name: 'admin-data',
    component: () => import('@/views/admin/DataManagementView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '数据与备份' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { requiresAuth: false, title: '页面不存在' }
  }
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  }
})

const BACKEND_MODE_ALLOWED_PATHS = [
  '/login',
  '/key-usage',
  '/setup',
  '/payment/result',
  '/payment/airwallex',
  '/legal'
]
const BACKEND_MODE_CALLBACK_PATHS = [
  '/auth/callback',
  '/auth/oauth/callback',
  '/auth/linuxdo/callback',
  '/auth/dingtalk/callback',
  '/auth/dingtalk/email-completion',
  '/auth/oidc/callback',
  '/auth/wechat/callback',
  '/auth/wechat/payment/callback'
]
const BACKEND_MODE_PENDING_PATHS = ['/register', '/email-verify']

let authInitialized = false
let setupResolved = false
let setupRequired = false
const navigationLoading = useNavigationLoadingState()

function roleHome(isAdmin: boolean): string {
  return isAdmin ? '/admin/dashboard' : '/app/dashboard'
}

function backendPublicRouteAllowed(path: string, hasPendingAuthSession: boolean): boolean {
  if (BACKEND_MODE_ALLOWED_PATHS.some((allowed) => path === allowed || path.startsWith(allowed))) return true
  if (BACKEND_MODE_CALLBACK_PATHS.includes(path)) return true
  return hasPendingAuthSession && BACKEND_MODE_PENDING_PATHS.includes(path)
}

async function ensurePublicSettings(): Promise<ReturnType<typeof useAppStore>> {
  const app = useAppStore()
  if (!app.publicSettingsLoaded) await app.fetchPublicSettings()
  return app
}

router.beforeEach(async (to) => {
  navigationLoading.startNavigation()
  const auth = useAuthStore()
  if (!authInitialized) {
    auth.checkAuth()
    authInitialized = true
    // localStorage is origin-scoped, so frontend and frontend2 intentionally keep
    // independent sessions.  The cached user is only a boot hint, though: wait for
    // the backend to confirm email/role before using it for the first authorization
    // decision.  A transient network failure keeps the existing offline-tolerant
    // behaviour; a 401 is still cleared by the shared auth store/interceptor.
    if (auth.isAuthenticated) {
      try {
        await auth.refreshUser()
      } catch {
        // The shared auth store owns refresh and invalid-session semantics.
      }
    }
  }

  const app = useAppStore()
  document.title = `${String(to.meta.title || 'Sub2API')} · ${app.siteName}`

  if (!setupResolved || setupRequired || to.path === '/setup') {
    try {
      const status = await getSetupStatus()
      setupResolved = true
      setupRequired = status.needs_setup
      if (status.needs_setup && to.path !== '/setup') return '/setup'
      if (!status.needs_setup && to.path === '/setup') return roleHome(auth.isAdmin)
    } catch {
      // A transient setup endpoint failure must not make the rest of the console unreachable.
    }
  }

  if (to.meta.feature === RouteFeature.MODEL_PLAZA) {
    const settingsStore = await ensurePublicSettings()
    const settings = settingsStore.cachedPublicSettings
    if (settingsStore.publicSettingsLoaded && settings?.model_plaza_enabled === false) {
      return auth.isAuthenticated ? roleHome(auth.isAdmin) : '/'
    }
    if (settings?.model_plaza_require_auth === true && !auth.isAuthenticated) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }

  if (to.meta.requiresAuth === false) {
    if (auth.isAuthenticated && (to.path === '/login' || to.path === '/register')) {
      if (app.backendModeEnabled && !auth.isAdmin) return true
      return roleHome(auth.isAdmin)
    }
    if (app.backendModeEnabled && !auth.isAuthenticated) {
      if (!backendPublicRouteAllowed(to.path, auth.hasPendingAuthSession)) return '/login'
    }
    return true
  }

  if (!auth.isAuthenticated) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.meta.requiresAdmin && !auth.isAdmin) return '/app/dashboard'

  if (to.meta.requiresAdmin && auth.isAdmin) {
    const compliance = useAdminComplianceStore()
    if (!compliance.initialized) {
      try {
        await compliance.fetchStatus()
      } catch (error) {
        const structured = error as { status?: number; code?: string; metadata?: Record<string, string> }
        if (structured.status === 423 && structured.code === 'ADMIN_COMPLIANCE_ACK_REQUIRED') {
          compliance.requireAcknowledgement(structured.metadata)
        }
      }
    }
  }

  if (to.meta.feature) {
    const settingsStore = await ensurePublicSettings()
    await prepareRouteFeature(to.meta.feature)
    if (settingsStore.publicSettingsLoaded && !isRouteFeatureEnabled(to.meta.feature)) {
      return to.meta.feature === RouteFeature.RISK_CONTROL && auth.isAdmin
        ? '/admin/settings'
        : roleHome(auth.isAdmin)
    }
  }

  if (auth.isSimpleMode && to.meta.hideInSimpleMode) return roleHome(auth.isAdmin)

  if (app.backendModeEnabled && !auth.isAdmin) {
    if (!backendPublicRouteAllowed(to.path, auth.hasPendingAuthSession)) return '/login'
  }

  return true
})

router.afterEach(() => navigationLoading.endNavigation())

router.onError((error) => {
  navigationLoading.endNavigation()
  const message = error instanceof Error ? error.message : String(error)
  const chunkLoadFailed = message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Loading chunk') || message.includes('Loading CSS chunk') ||
    (error instanceof Error && error.name === 'ChunkLoadError')
  if (!chunkLoadFailed) return
  const key = 'frontend2_chunk_reload_attempted_at'
  const lastAttempt = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - lastAttempt <= 10_000) return
  sessionStorage.setItem(key, String(Date.now()))
  window.location.reload()
})

export default router
