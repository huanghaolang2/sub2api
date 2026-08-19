import { describe, expect, it } from 'vitest'
import { can, Permission } from '@/authz/permissions'
import { Role } from '@/types/auth'

describe('permission matrix', () => {
  it('allows user self-service but denies admin data', () => {
    expect(can(Role.USER, Permission.KEY_WRITE_SELF)).toBe(true)
    expect(can(Role.USER, Permission.USER_READ)).toBe(false)
  })

  it('allows admin permissions', () => {
    expect(can(Role.ADMIN, Permission.USER_READ)).toBe(true)
    expect(can(Role.ADMIN, Permission.SETTING_WRITE)).toBe(true)
  })
})
