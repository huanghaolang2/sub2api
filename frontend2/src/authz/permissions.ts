import { Role } from '@/types/auth'

export enum Permission {
  DASHBOARD_READ_SELF = 'dashboard:read:self',
  KEY_READ_SELF = 'key:read:self',
  KEY_WRITE_SELF = 'key:write:self',
  MODEL_READ_SELF = 'model:read:self',
  USAGE_READ_SELF = 'usage:read:self',
  MONITOR_READ_SELF = 'monitor:read:self',
  BATCH_IMAGE_WRITE_SELF = 'batch-image:write:self',
  BILLING_READ_SELF = 'billing:read:self',
  BILLING_WRITE_SELF = 'billing:write:self',
  AFFILIATE_READ_SELF = 'affiliate:read:self',
  PROFILE_WRITE_SELF = 'profile:write:self',
  ADMIN_DASHBOARD_READ = 'admin:dashboard:read',
  OPS_READ = 'ops:read',
  USER_READ = 'user:read',
  USER_WRITE = 'user:write',
  GROUP_READ = 'group:read',
  GROUP_WRITE = 'group:write',
  CHANNEL_READ = 'channel:read',
  CHANNEL_WRITE = 'channel:write',
  ACCOUNT_READ = 'account:read',
  ACCOUNT_WRITE = 'account:write',
  PROXY_READ = 'proxy:read',
  PROXY_WRITE = 'proxy:write',
  SUBSCRIPTION_READ = 'subscription:read',
  SUBSCRIPTION_WRITE = 'subscription:write',
  ORDER_READ = 'order:read',
  ORDER_WRITE = 'order:write',
  REDEEM_READ = 'redeem:read',
  PROMO_READ = 'promo:read',
  AFFILIATE_READ = 'affiliate:read',
  ANNOUNCEMENT_READ = 'announcement:read',
  ADMIN_USAGE_READ = 'admin:usage:read',
  AUDIT_READ = 'audit:read',
  RISK_CONTROL_READ = 'risk-control:read',
  SETTING_READ = 'setting:read',
  SETTING_WRITE = 'setting:write',
  DATA_MANAGEMENT_READ = 'data-management:read'
}

const userPermissions = new Set<Permission>([
  Permission.DASHBOARD_READ_SELF,
  Permission.KEY_READ_SELF,
  Permission.KEY_WRITE_SELF,
  Permission.MODEL_READ_SELF,
  Permission.USAGE_READ_SELF,
  Permission.MONITOR_READ_SELF,
  Permission.BATCH_IMAGE_WRITE_SELF,
  Permission.BILLING_READ_SELF,
  Permission.BILLING_WRITE_SELF,
  Permission.AFFILIATE_READ_SELF,
  Permission.PROFILE_WRITE_SELF
])

const adminPermissions = new Set<Permission>([
  ...userPermissions,
  Permission.ADMIN_DASHBOARD_READ,
  Permission.OPS_READ,
  Permission.USER_READ,
  Permission.USER_WRITE,
  Permission.GROUP_READ,
  Permission.GROUP_WRITE,
  Permission.CHANNEL_READ,
  Permission.CHANNEL_WRITE,
  Permission.ACCOUNT_READ,
  Permission.ACCOUNT_WRITE,
  Permission.PROXY_READ,
  Permission.PROXY_WRITE,
  Permission.SUBSCRIPTION_READ,
  Permission.SUBSCRIPTION_WRITE,
  Permission.ORDER_READ,
  Permission.ORDER_WRITE,
  Permission.REDEEM_READ,
  Permission.PROMO_READ,
  Permission.AFFILIATE_READ,
  Permission.ANNOUNCEMENT_READ,
  Permission.ADMIN_USAGE_READ,
  Permission.AUDIT_READ,
  Permission.RISK_CONTROL_READ,
  Permission.SETTING_READ,
  Permission.SETTING_WRITE,
  Permission.DATA_MANAGEMENT_READ
])

export function can(role: Role | string | null, permission: Permission): boolean {
  if (!role) return false
  return (role === Role.ADMIN ? adminPermissions : userPermissions).has(permission)
}
