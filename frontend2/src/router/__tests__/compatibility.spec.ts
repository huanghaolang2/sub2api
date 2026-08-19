import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { router } from '@/router'

function declaredPaths(source: string): string[] {
  return [...source.matchAll(/\bpath:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

describe('legacy route compatibility', () => {
  it('keeps every path declared by the existing frontend router reachable', () => {
    const legacyRouterSource = readFileSync(join(process.cwd(), '..', 'frontend', 'src', 'router', 'index.ts'), 'utf8')
    const legacyPaths = [...new Set(declaredPaths(legacyRouterSource))]
    const reachablePaths = new Set(router.getRoutes().map((route) => route.path))
    const missing = legacyPaths.filter((path) => !reachablePaths.has(path))

    expect(legacyPaths.length).toBeGreaterThan(50)
    expect(missing).toEqual([])
  })

  it('does not route public or authentication paths through the migration placeholder', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'router', 'index.ts'), 'utf8')
    expect(source).not.toContain('MigrationRouteView')
    expect(source).not.toContain('pendingView')
    for (const view of [
      'SetupView.vue', 'RegisterView.vue', 'EmailVerifyView.vue', 'ForgotPasswordView.vue',
      'ResetPasswordView.vue', 'OAuthProviderCallbackView.vue', 'KeyUsageView.vue',
    ]) expect(source).toContain(view)
  })
})
