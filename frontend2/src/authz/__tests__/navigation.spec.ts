import { describe, expect, it } from 'vitest'
import { ConsoleAudience, ConsoleSection, SecondaryNavigationMode, consoleSections, matchesNavigationPath } from '@/authz/navigation'

describe('console navigation model', () => {
  it('separates user development from admin resource management', () => {
    const development = consoleSections.find((section) => section.id === ConsoleSection.USER_DEVELOPMENT)
    const resources = consoleSections.find((section) => section.id === ConsoleSection.ADMIN_RESOURCES)
    expect(development?.mode).toBe(SecondaryNavigationMode.SIDEBAR)
    expect(development?.items.map((item) => item.to)).toContain('/app/keys')
    expect(resources?.mode).toBe(SecondaryNavigationMode.SIDEBAR)
    expect(resources?.items.map((item) => item.to)).toContain('/admin/channels/pricing')
    expect(resources?.items.map((item) => item.to)).not.toContain('/app/keys')
  })

  it('matches an item path without activating sibling routes', () => {
    const item = consoleSections.flatMap((section) => section.items).find((entry) => entry.to === '/app/usage-board')
    expect(item && matchesNavigationPath('/app/usage-board', item)).toBe(true)
    expect(item && matchesNavigationPath('/app/usage-board/details', item)).toBe(true)
    expect(item && matchesNavigationPath('/app/dashboard', item)).toBe(false)
  })

  it('exposes the board as an independent user menu without usage records', () => {
    const userItems = consoleSections.filter((section) => section.audience === ConsoleAudience.USER).flatMap((section) => section.items)
    expect(userItems.map((item) => item.to)).toContain('/app/usage-board')
    expect(userItems.map((item) => item.to)).not.toContain('/app/usage')
    expect(consoleSections.find((section) => section.id === ConsoleSection.USER_USAGE_BOARD)?.mode).toBe(SecondaryNavigationMode.NONE)
  })
})
