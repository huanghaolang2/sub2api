import { RouteFeature } from '@/router/contracts'
import { Permission } from './permissions'

export enum ConsoleAudience {
  USER = 'user',
  ADMIN = 'admin'
}

export enum ConsoleSection {
  USER_HOME = 'user_home',
  USER_DEVELOPMENT = 'user_development',
  USER_OBSERVABILITY = 'user_observability',
  USER_BILLING = 'user_billing',
  USER_ACCOUNT = 'user_account',
  ADMIN_OVERVIEW = 'admin_overview',
  ADMIN_USERS = 'admin_users',
  ADMIN_RESOURCES = 'admin_resources',
  ADMIN_COMMERCE = 'admin_commerce',
  ADMIN_SYSTEM = 'admin_system'
}

export enum SecondaryNavigationMode {
  NONE = 'none',
  SIDEBAR = 'sidebar',
  TABS = 'tabs'
}

export interface NavigationItem {
  label: string
  shortLabel?: string
  iconSvg?: string
  to: string
  permission: Permission
  feature?: RouteFeature
  hideInSimpleMode?: boolean
}

export interface ConsoleSectionDefinition {
  id: ConsoleSection
  audience: ConsoleAudience
  label: string
  shortLabel: string
  mode: SecondaryNavigationMode
  items: NavigationItem[]
}

export const consoleSections: ConsoleSectionDefinition[] = [
  {
    id: ConsoleSection.USER_HOME,
    audience: ConsoleAudience.USER,
    label: '工作台',
    shortLabel: '概览',
    mode: SecondaryNavigationMode.NONE,
    items: [
      { label: '我的概览', to: '/app/dashboard', permission: Permission.DASHBOARD_READ_SELF }
    ]
  },
  {
    id: ConsoleSection.USER_DEVELOPMENT,
    audience: ConsoleAudience.USER,
    label: '开发接入',
    shortLabel: '开发',
    mode: SecondaryNavigationMode.SIDEBAR,
    items: [
      { label: 'API Key', shortLabel: 'Key', to: '/app/keys', permission: Permission.KEY_READ_SELF },
      { label: '模型与价格', shortLabel: '模型价格', to: '/app/models', permission: Permission.MODEL_READ_SELF },
      {
        label: '可用模型',
        to: '/app/models/available',
        permission: Permission.MODEL_READ_SELF,
        feature: RouteFeature.AVAILABLE_CHANNELS,
        hideInSimpleMode: true
      },
      {
        label: '批量图片',
        to: '/app/batch-image',
        permission: Permission.BATCH_IMAGE_WRITE_SELF,
        feature: RouteFeature.BATCH_IMAGE,
        hideInSimpleMode: true
      }
    ]
  },
  {
    id: ConsoleSection.USER_OBSERVABILITY,
    audience: ConsoleAudience.USER,
    label: '用量与日志',
    shortLabel: '用量',
    mode: SecondaryNavigationMode.TABS,
    items: [
      { label: '用量明细', to: '/app/usage', permission: Permission.USAGE_READ_SELF, hideInSimpleMode: true },
      {
        label: '服务状态',
        to: '/app/monitor',
        permission: Permission.MONITOR_READ_SELF,
        feature: RouteFeature.CHANNEL_MONITOR
      }
    ]
  },
  {
    id: ConsoleSection.USER_BILLING,
    audience: ConsoleAudience.USER,
    label: '账务与权益',
    shortLabel: '账务',
    mode: SecondaryNavigationMode.SIDEBAR,
    items: [
      { label: '我的订阅', to: '/app/subscriptions', permission: Permission.BILLING_READ_SELF, hideInSimpleMode: true },
      {
        label: '购买与充值',
        to: '/app/purchase',
        permission: Permission.BILLING_WRITE_SELF,
        feature: RouteFeature.PAYMENT,
        hideInSimpleMode: true
      },
      {
        label: '我的订单',
        to: '/app/orders',
        permission: Permission.BILLING_READ_SELF,
        feature: RouteFeature.PAYMENT,
        hideInSimpleMode: true
      },
      { label: '兑换码', to: '/app/redeem', permission: Permission.BILLING_WRITE_SELF, hideInSimpleMode: true },
      {
        label: '邀请返利',
        to: '/app/affiliate',
        permission: Permission.AFFILIATE_READ_SELF,
        feature: RouteFeature.AFFILIATE,
        hideInSimpleMode: true
      }
    ]
  },
  {
    id: ConsoleSection.USER_ACCOUNT,
    audience: ConsoleAudience.USER,
    label: '账户与安全',
    shortLabel: '账户',
    mode: SecondaryNavigationMode.NONE,
    items: [
      { label: '个人设置', to: '/app/profile', permission: Permission.PROFILE_WRITE_SELF }
    ]
  },
  {
    id: ConsoleSection.ADMIN_OVERVIEW,
    audience: ConsoleAudience.ADMIN,
    label: '总览与运维',
    shortLabel: '总览',
    mode: SecondaryNavigationMode.TABS,
    items: [
      { label: '平台概览', to: '/admin/dashboard', permission: Permission.ADMIN_DASHBOARD_READ },
      { label: '实时运维', to: '/admin/ops', permission: Permission.OPS_READ, feature: RouteFeature.OPS_MONITORING }
    ]
  },
  {
    id: ConsoleSection.ADMIN_USERS,
    audience: ConsoleAudience.ADMIN,
    label: '用户与访问',
    shortLabel: '用户',
    mode: SecondaryNavigationMode.NONE,
    items: [
      { label: '用户管理', to: '/admin/users', permission: Permission.USER_READ, hideInSimpleMode: true }
    ]
  },
  {
    id: ConsoleSection.ADMIN_RESOURCES,
    audience: ConsoleAudience.ADMIN,
    label: '资源与调度',
    shortLabel: '资源',
    mode: SecondaryNavigationMode.SIDEBAR,
    items: [
      { label: '分组与定价', to: '/admin/groups', permission: Permission.GROUP_READ, hideInSimpleMode: true },
      { label: '渠道与价格', to: '/admin/channels/pricing', permission: Permission.CHANNEL_READ, hideInSimpleMode: true },
      {
        label: '渠道监控',
        to: '/admin/channels/monitor',
        permission: Permission.CHANNEL_READ,
        feature: RouteFeature.CHANNEL_MONITOR
      },
      { label: '上游账号', to: '/admin/accounts', permission: Permission.ACCOUNT_READ },
      { label: '代理资源', to: '/admin/proxies', permission: Permission.PROXY_READ }
    ]
  },
  {
    id: ConsoleSection.ADMIN_COMMERCE,
    audience: ConsoleAudience.ADMIN,
    label: '商业运营',
    shortLabel: '商业',
    mode: SecondaryNavigationMode.SIDEBAR,
    items: [
      { label: '用户订阅', to: '/admin/subscriptions', permission: Permission.SUBSCRIPTION_READ, hideInSimpleMode: true },
      { label: '支付概览', to: '/admin/orders/dashboard', permission: Permission.ORDER_READ, feature: RouteFeature.PAYMENT },
      { label: '订单管理', to: '/admin/orders', permission: Permission.ORDER_READ, feature: RouteFeature.PAYMENT, hideInSimpleMode: true },
      { label: '计划与支付', to: '/admin/orders/plans', permission: Permission.ORDER_WRITE, feature: RouteFeature.PAYMENT },
      { label: '兑换码', to: '/admin/redeem', permission: Permission.REDEEM_READ, hideInSimpleMode: true },
      { label: '促销码', to: '/admin/promo-codes', permission: Permission.PROMO_READ, hideInSimpleMode: true },
      { label: '邀请记录', to: '/admin/affiliates/invites', permission: Permission.AFFILIATE_READ, feature: RouteFeature.AFFILIATE, hideInSimpleMode: true },
      { label: '返利记录', to: '/admin/affiliates/rebates', permission: Permission.AFFILIATE_READ, feature: RouteFeature.AFFILIATE, hideInSimpleMode: true },
      { label: '转账记录', to: '/admin/affiliates/transfers', permission: Permission.AFFILIATE_READ, feature: RouteFeature.AFFILIATE, hideInSimpleMode: true }
    ]
  },
  {
    id: ConsoleSection.ADMIN_SYSTEM,
    audience: ConsoleAudience.ADMIN,
    label: '安全与系统',
    shortLabel: '系统',
    mode: SecondaryNavigationMode.SIDEBAR,
    items: [
      { label: '公告与内容', to: '/admin/announcements', permission: Permission.ANNOUNCEMENT_READ },
      { label: '用量审计', to: '/admin/usage', permission: Permission.ADMIN_USAGE_READ },
      { label: '操作审计', to: '/admin/audit-logs', permission: Permission.AUDIT_READ, hideInSimpleMode: true },
      { label: '内容风控', to: '/admin/risk-control', permission: Permission.RISK_CONTROL_READ, feature: RouteFeature.RISK_CONTROL },
      { label: '提示词审计', to: '/admin/prompt-audit', permission: Permission.RISK_CONTROL_READ, feature: RouteFeature.RISK_CONTROL },
      { label: '系统设置', to: '/admin/settings', permission: Permission.SETTING_READ },
      { label: '数据与备份', to: '/admin/data', permission: Permission.DATA_MANAGEMENT_READ }
    ]
  }
]

export function matchesNavigationPath(path: string, item: NavigationItem): boolean {
  return path === item.to || path.startsWith(`${item.to}/`)
}
