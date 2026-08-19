import { describe, expect, it } from 'vitest'
import { ProxyFallbackMode, emptyProxyDraft, parseBatchProxies, proxyDraftToRequest } from '../proxy'

describe('admin proxy request model', () => {
  it('parses authenticated and plain proxy rows for the shared batch endpoint', () => {
    expect(parseBatchProxies('http://user:pass@10.0.0.1:8080\nhttps://proxy.example.test:443')).toEqual([
      { protocol: 'http', host: '10.0.0.1', port: 8080, username: 'user', password: 'pass' },
      { protocol: 'https', host: 'proxy.example.test', port: 443, username: undefined, password: undefined }
    ])
  })

  it('keeps fallback and expiry fields while preserving an existing password on blank edit', () => {
    const draft = emptyProxyDraft()
    Object.assign(draft, {
      name: '主代理',
      host: 'proxy.example.test',
      port: 8443,
      protocol: 'https',
      password: '',
      fallback_mode: ProxyFallbackMode.PROXY,
      backup_proxy_id: 9,
      expiry_warn_days: 14,
      status: 'inactive'
    })

    const request = proxyDraftToRequest(draft, true)
    expect(request).toMatchObject({ fallback_mode: ProxyFallbackMode.PROXY, backup_proxy_id: 9, expiry_warn_days: 14, status: 'inactive' })
    expect(request).not.toHaveProperty('password')
  })

  it('rejects invalid ports and invalid batch rows', () => {
    const draft = emptyProxyDraft()
    Object.assign(draft, { name: '代理', host: '127.0.0.1', port: 70000 })
    expect(() => proxyDraftToRequest(draft, false)).toThrow('1-65535')
    expect(() => parseBatchProxies('not a proxy')).toThrow('第 1 行')
  })
})
