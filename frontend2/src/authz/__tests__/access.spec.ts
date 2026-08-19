import { describe, expect, it } from 'vitest'
import { AccessDecision, decideAccess, RouteAccess } from '@/authz/access'
import { Role } from '@/types/auth'

describe('route access', () => {
  it('requires login before protected routes', () => {
    expect(decideAccess(RouteAccess.AUTHENTICATED, false, null)).toBe(AccessDecision.REQUIRE_LOGIN)
    expect(decideAccess(RouteAccess.ADMIN, false, null)).toBe(AccessDecision.REQUIRE_LOGIN)
  })

  it('denies regular users before admin route components load', () => {
    expect(decideAccess(RouteAccess.ADMIN, true, Role.USER)).toBe(AccessDecision.DENY_ADMIN)
  })

  it('allows admins and regular self-service access', () => {
    expect(decideAccess(RouteAccess.ADMIN, true, Role.ADMIN)).toBe(AccessDecision.ALLOW)
    expect(decideAccess(RouteAccess.AUTHENTICATED, true, Role.USER)).toBe(AccessDecision.ALLOW)
  })
})
