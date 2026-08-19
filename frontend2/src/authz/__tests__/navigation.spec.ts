import { describe, expect, it } from 'vitest'
import { ConsoleSection, SecondaryNavigationMode, consoleSections, matchesNavigationPath } from '@/authz/navigation'

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
    const item = consoleSections.flatMap((section) => section.items).find((entry) => entry.to === '/app/usage')
    expect(item && matchesNavigationPath('/app/usage', item)).toBe(true)
    expect(item && matchesNavigationPath('/app/usage/details', item)).toBe(true)
    expect(item && matchesNavigationPath('/app/dashboard', item)).toBe(false)
  })
})
