import type { CreateProxyRequest, Proxy, ProxyProtocol, UpdateProxyRequest } from '@/types'

export enum ProxyFallbackMode { NONE = 'none', PROXY = 'proxy', DIRECT = 'direct' }
export enum ProxyBatchMode { CREATE = 'create', IMPORT = 'import' }

export interface ProxyDraft { name: string; protocol: ProxyProtocol; host: string; port: number; username: string; password: string; status: 'active' | 'inactive'; expires_at: string; fallback_mode: ProxyFallbackMode; backup_proxy_id: number | string; expiry_warn_days: number }

export function emptyProxyDraft(): ProxyDraft { return { name: '', protocol: 'http', host: '', port: 8080, username: '', password: '', status: 'active', expires_at: '', fallback_mode: ProxyFallbackMode.NONE, backup_proxy_id: '', expiry_warn_days: 7 } }
export function proxyToDraft(proxy: Proxy): ProxyDraft { return { name: proxy.name, protocol: proxy.protocol, host: proxy.host, port: proxy.port, username: proxy.username || '', password: '', status: proxy.status === 'active' ? 'active' : 'inactive', expires_at: proxy.expires_at ? new Date(proxy.expires_at).toISOString().slice(0, 16) : '', fallback_mode: proxy.fallback_mode as ProxyFallbackMode, backup_proxy_id: proxy.backup_proxy_id ?? '', expiry_warn_days: proxy.expiry_warn_days } }
export function proxyDraftToRequest(draft: ProxyDraft, editing: boolean): CreateProxyRequest | UpdateProxyRequest {
  if (!draft.name.trim() || !draft.host.trim()) throw new Error('代理名称和主机不能为空')
  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) throw new Error('端口必须在 1-65535 之间')
  if (!Number.isInteger(draft.expiry_warn_days) || draft.expiry_warn_days < 0) throw new Error('到期提醒天数必须是非负整数')
  const payload: CreateProxyRequest & UpdateProxyRequest = { name: draft.name.trim(), protocol: draft.protocol, host: draft.host.trim(), port: draft.port, username: draft.username.trim() || null, fallback_mode: draft.fallback_mode, backup_proxy_id: draft.fallback_mode === ProxyFallbackMode.PROXY && draft.backup_proxy_id !== '' ? Number(draft.backup_proxy_id) : null, expiry_warn_days: draft.expiry_warn_days, expires_at: draft.expires_at ? Math.floor(new Date(draft.expires_at).getTime() / 1000) : null }
  if (draft.password || !editing) payload.password = draft.password || null
  if (editing) payload.status = draft.status
  return payload
}

export interface BatchProxyDraft { protocol: string; host: string; port: number; username?: string; password?: string }

export function parseBatchProxies(input: string): BatchProxyDraft[] {
  const rows: BatchProxyDraft[] = []
  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue
    try {
      const normalized = line.includes('://') ? line : `http://${line}`
      const url = new URL(normalized)
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
      if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error()
      rows.push({ protocol: url.protocol.replace(':', ''), host: url.hostname, port, username: url.username ? decodeURIComponent(url.username) : undefined, password: url.password ? decodeURIComponent(url.password) : undefined })
    } catch { throw new Error(`第 ${index + 1} 行不是有效代理地址`) }
  }
  if (!rows.length) throw new Error('至少需要一条代理地址')
  return rows
}
