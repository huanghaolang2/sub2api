import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.vue'].includes(extname(entry.name)) && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

describe('shared API ownership', () => {
  it('uses the shared client and limits direct endpoint calls to legacy OAuth gaps', () => {
    const sourceRoot = join(process.cwd(), 'src')
    const directRequestFiles = sourceFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return /apiClient\.(?:get|post|put|patch|delete)(?:<[^>]+>)?\s*\(/.test(source) ? [file] : []
    })
    expect(directRequestFiles.map((file) => file.slice(sourceRoot.length + 1)).sort()).toEqual([
      'views/auth/EmailVerifyView.vue',
      'views/auth/OAuthProviderCallbackView.vue',
    ])

    const emailVerify = readFileSync(join(sourceRoot, 'views/auth/EmailVerifyView.vue'), 'utf8')
    const oauthCallback = readFileSync(join(sourceRoot, 'views/auth/OAuthProviderCallbackView.vue'), 'utf8')
    expect(emailVerify).toContain("import { apiClient } from '@/api/client'")
    expect(emailVerify).toContain("'/auth/oauth/pending/create-account'")
    expect(oauthCallback).toContain("import { apiClient } from '@/api/client'")
    expect(oauthCallback).toContain('`/auth/oauth/${provider.value}/complete-registration`')
    expect(oauthCallback).toContain("'/auth/oauth/pending/create-account'")
    expect(oauthCallback).toContain("'/auth/oauth/pending/bind-login'")

    const forbidden = sourceFiles(sourceRoot).filter((file) => {
      const source = readFileSync(file, 'utf8')
      const ownsAxiosClient = /from ['"]axios['"]|axios\.create\s*\(/.test(source)
      const callsVersionedEndpointDirectly = /(?:apiClient\.(?:get|post|put|patch|delete)(?:<[^>]+>)?\s*\(|fetch\s*\()\s*['"`]\/api\/v\d/.test(source)
      return ownsAxiosClient || callsVersionedEndpointDirectly
    })
    expect(forbidden).toEqual([])
  })

  it('keeps the frontend2 build independent from legacy UI modules', () => {
    const sourceRoot = join(process.cwd(), 'src')
    const viteConfig = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8')
    const source = sourceFiles(sourceRoot)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    expect(viteConfig).not.toMatch(/sharedFrontendSource\}\/(?:components|views|styles|assets)/)
    expect(source).not.toMatch(/from\s+['"][^'"]*frontend\/src\/(?:components|views|styles|assets)/)
    expect(source).not.toContain('@shared-captcha')
  })
})
