import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../client'
import { getUsageBoard, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder } from '../usageBoard'

describe('usage board request contract', () => {
  afterEach(() => vi.restoreAllMocks())
  it('serializes multiple IDs as repeated parameters and carries cancellation', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { series: [] } })
    const controller = new AbortController()
    await getUsageBoard(UsageBoardScope.SELF, { granularity: UsageBoardGranularity.DAY, start_date: '2026-09-07', end_date: '2026-09-09', timezone: 'Asia/Taipei', api_key_ids: [11, 12], group_ids: [4, 5], sort_order: UsageBoardSortOrder.DESC, page: 1, page_size: 20 }, controller.signal)
    const [path, config] = get.mock.calls[0]
    const url = new URL(path, 'https://board.test')
    expect(url.pathname).toBe('/usage/board')
    expect(url.searchParams.getAll('api_key_ids')).toEqual(['11', '12'])
    expect(url.searchParams.getAll('group_ids')).toEqual(['4', '5'])
    expect(url.searchParams.get('timezone')).toBe('Asia/Taipei')
    expect(config?.signal).toBe(controller.signal)
    expect(url.searchParams.has('user_id')).toBe(false)
  })
  it('uses the management endpoint and monthly fields without empty ID parameters', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: {} })
    await getUsageBoard(UsageBoardScope.ADMIN, { granularity: UsageBoardGranularity.MONTH, start_month: '2026-01', end_month: '2026-02', timezone: 'UTC', api_key_ids: [], group_ids: [], sort_order: UsageBoardSortOrder.ASC, page: 2, page_size: 30 })
    const url = new URL(get.mock.calls[0][0], 'https://board.test')
    expect(url.pathname).toBe('/admin/usage/board')
    expect(url.searchParams.get('start_month')).toBe('2026-01')
    expect(url.searchParams.has('api_key_ids')).toBe(false)
    expect(url.searchParams.has('start_date')).toBe(false)
  })
})
