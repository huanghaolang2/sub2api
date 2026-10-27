import type { AxiosAdapter } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { defaultDashboardSections, resolveDashboardDependencies, DashboardDataKind } from '../dashboardBoards'
import { loadDashboardDependency } from '../dashboardData'
vi.mock('@/i18n', () => ({ getLocale: () => 'zh-CN' }))
const originalAdapter = apiClient.defaults.adapter
const snapshot = { today: '2026-10-26', timezone: 'Asia/Taipei' }
describe('production dashboard data adapter', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
  afterEach(() => { apiClient.defaults.adapter = originalAdapter; vi.restoreAllMocks() })
  it('dispatches every dependency through real HTTP methods with correct scope and signal', async () => {
    const adapter = vi.fn<AxiosAdapter>().mockImplementation(async config => {
      const body = config.url?.includes('/models') ? { models: [{ model: 'free', total_tokens: 42, actual_cost: 0 }] } : config.url?.includes('/stats') ? { usage_board: { ranking: [] } } : { series: [], rows: [] }
      return { status: 200, data: { code: 0, data: body }, headers: {}, config, statusText: 'OK' }
    })
    apiClient.defaults.adapter = adapter
    const dependencies = resolveDashboardDependencies(defaultDashboardSections, snapshot)
    const controller = new AbortController()
    const results = await Promise.all(dependencies.map(dependency => loadDashboardDependency(dependency, controller.signal)))
    expect(results.map(result => result.kind)).toEqual(dependencies.map(dependency => dependency.kind))
    expect(adapter).toHaveBeenCalledTimes(6)
    const urls = adapter.mock.calls.map(([config]) => {
      expect(config.signal).toBe(controller.signal)
      return new URL(apiClient.getUri(config), 'https://local.test')
    })
    expect(urls.filter(url => url.pathname === '/api/v1/usage/board')).toHaveLength(2)
    expect(urls.filter(url => url.pathname === '/api/v1/usage/dashboard/stats')).toHaveLength(1)
    expect(urls.filter(url => url.pathname === '/api/v1/usage/dashboard/models')).toHaveLength(3)
    for (const url of urls) {
      expect(url.searchParams.has('user_id')).toBe(false)
      expect(url.searchParams.getAll('timezone')).toHaveLength(1)
      if (!url.pathname.endsWith('/stats')) expect(url.searchParams.get('timezone')).toBe(snapshot.timezone)
    }
    const lifetime = urls.find(url => url.searchParams.get('start_date') === '0001-01-01')!
    expect(lifetime.searchParams.get('end_date')).toBe(snapshot.today)
    expect(urls.filter(url=>url.pathname.endsWith('/models')).map(url=>url.searchParams.get('ranking_period'))).toEqual(['week','month','lifetime'])
    const model = results.find(result => result.kind === DashboardDataKind.MODELS)
    expect(model?.data.models[0]).toEqual({ model: 'free', total_tokens: 42, actual_cost: 0 })
  })
  it('rejects the original structured failure without substituting an empty result', async () => {
    apiClient.defaults.adapter = async config => ({ status: 200, data: { code: 501, message: '模型统计失败' }, headers: {}, config, statusText: 'OK' })
    const dependency = resolveDashboardDependencies(defaultDashboardSections, snapshot).find(item => item.kind === DashboardDataKind.MODELS)!
    await expect(loadDashboardDependency(dependency, new AbortController().signal)).rejects.toMatchObject({ code: 501, message: '模型统计失败' })
  })
})
