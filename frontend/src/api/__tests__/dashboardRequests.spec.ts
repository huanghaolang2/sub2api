import axios, { type AxiosAdapter } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, RequestTimezonePolicy } from '../client'
import { getDashboardModels, getDashboardStats, UsageRankingPeriod } from '../usage'
vi.mock('@/i18n', () => ({ getLocale: () => 'zh-CN' }))
const originalAdapter = apiClient.defaults.adapter
const response: AxiosAdapter = async config => ({ status: 200, data: { code: 0, data: { models: [] } }, headers: {}, config, statusText: 'OK' })
describe('dashboard request transport', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
  afterEach(() => { apiClient.defaults.adapter = originalAdapter; vi.restoreAllMocks() })
  it('preserves explicit model date/timezone and cancellation in the final adapter', async () => {
    const adapter = vi.fn(response)
    apiClient.defaults.adapter = adapter
    const controller = new AbortController()
    await getDashboardModels({ ranking_period: UsageRankingPeriod.LIFETIME, start_date: '0001-01-01', end_date: '2026-03-08', timezone: 'America/New_York', model_source: 'requested' }, { signal: controller.signal, timezonePolicy: RequestTimezonePolicy.EXPLICIT })
    const config = adapter.mock.calls[0][0]
    const url = new URL(apiClient.getUri(config), 'https://local.test')
    expect(url.pathname).toBe('/api/v1/usage/dashboard/models')
    expect(url.searchParams.getAll('timezone')).toEqual(['America/New_York'])
    expect(url.searchParams.get('start_date')).toBe('0001-01-01')
    expect(url.searchParams.get('end_date')).toBe('2026-03-08')
    expect(url.searchParams.get('model_source')).toBe('requested')
    expect(url.searchParams.get('ranking_period')).toBe('lifetime')
    expect(url.searchParams.has('user_id')).toBe(false)
    expect(config.signal).toBe(controller.signal)
    expect(config.timeout).toBe(30000)
  })
  it('keeps old call forms and propagates API message objects', async () => {
    const adapter = vi.fn(response)
    apiClient.defaults.adapter = adapter
    await getDashboardStats()
    await getDashboardModels()
    expect(adapter.mock.calls.every(([config])=>!config.params?.ranking_period)).toBe(true)
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual(['/usage/dashboard/stats', '/usage/dashboard/models'])
    apiClient.defaults.adapter = async config => ({ status: 200, data: { code: 700, message: '统计暂不可用' }, headers: {}, config, statusText: 'OK' })
    await expect(getDashboardStats()).rejects.toMatchObject({ code: 700, message: '统计暂不可用' })
  })
  it('delivers an in-flight abort to the actual adapter and preserves cancellation', async () => {
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    apiClient.defaults.adapter = config => new Promise((_resolve, reject) => {
      config.signal?.addEventListener?.('abort', () => reject(new axios.CanceledError('aborted')))
      started()
    })
    const controller = new AbortController()
    const request = getDashboardStats({ signal: controller.signal })
    await ready
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  })
})
