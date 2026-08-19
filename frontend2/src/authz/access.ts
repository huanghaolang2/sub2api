import { Role } from '@/types/auth'

export enum RouteAccess {
  PUBLIC = 'public',
  AUTHENTICATED = 'authenticated',
  ADMIN = 'admin'
}

export enum AccessDecision {
  ALLOW = 'allow',
  REQUIRE_LOGIN = 'require_login',
  DENY_ADMIN = 'deny_admin'
}

export function decideAccess(access: RouteAccess, authenticated: boolean, role: Role | null): AccessDecision {
  if (access === RouteAccess.PUBLIC) return AccessDecision.ALLOW
  if (!authenticated) return AccessDecision.REQUIRE_LOGIN
  if (access === RouteAccess.ADMIN && role !== Role.ADMIN) return AccessDecision.DENY_ADMIN
  return AccessDecision.ALLOW
}
