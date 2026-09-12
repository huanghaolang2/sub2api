import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder, type UsageBoardResponse } from '../../api/usageBoard'
import { UsageBoardChartType, UsageBoardChoiceKind, UsageBoardLoadState, UsageBoardValidation } from '../../utils/usageBoard'
import { useUsageBoard } from '../useUsageBoard'

const api = vi.hoisted(() => ({ get: vi.fn(), keys: vi.fn(), groups: vi.fn(), adminKeys: vi.fn(), adminGroups: vi.fn() }))
vi.mock('../../api/usageBoard', async () => ({ ...await vi.importActual<typeof import('../../api/usageBoard')>('../../api/usageBoard'), getUsageBoard: api.get }))
vi.mock('../../api/keys', () => ({ list: api.keys }))
vi.mock('../../api/groups', () => ({ getAvailable: api.groups }))
vi.mock('../../api/admin/usage', () => ({ searchApiKeys: api.adminKeys }))
vi.mock('../../api/admin/groups', () => ({ list: api.adminGroups }))

function response(value = 100): UsageBoardResponse {
  const point = { period_start: '2026-09-07', total_tokens: value, record_count: 1, data_state: UsageBoardDataState.OBSERVED }
  return { granularity: UsageBoardGranularity.DAY, timezone: 'UTC', start_date: '2026-09-07', end_date: '2026-09-07',
    periods: [{ start: '2026-09-07', end: '2026-09-07', label: '2026-09-07', coverage: UsageBoardCoverage.FULL }],
    series: [{ api_key_id: 11, api_key_name: '项目接口', points: [point] }],
    rows: [{ ...point, api_key_id: 11, api_key_name: '项目接口', period_label: '2026-09-07', coverage: UsageBoardCoverage.FULL }],
    pagination: { page: 1, page_size: 20, total: 1, pages: 1 } }
}
function harness(scope = UsageBoardScope.SELF) {
  let model: ReturnType<typeof useUsageBoard> | undefined
  const wrapper = mount(defineComponent({ setup() { model = useUsageBoard(scope); return () => h('div') } }))
  if (!model) throw new Error('Missing mounted model')
  return { model, wrapper }
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

describe('usage board state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockResolvedValue(response())
    api.keys.mockResolvedValue({ items: [{ id: 11, name: '项目接口', key: 'must-not-expose' }], total: 1 })
    api.groups.mockResolvedValue([{ id: 4, name: '分组 A' }])
    api.adminKeys.mockResolvedValue([{ id: 11, name: '项目接口', user_id: 1 }])
    api.adminGroups.mockResolvedValue({ items: [], total: 0 })
  })
  afterEach(() => vi.useRealTimers())
  it('loads defaults, reloads combined filters, and switches chart type without resetting or fetching', async () => {
    const { model, wrapper } = harness(); await flushPromises()
    expect(model.state.value).toBe(UsageBoardLoadState.READY)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(model.lookups.key.options[0]).toEqual({ id: 11, label: '项目接口' })
    model.selectedKeys.value = [{ id: 11, label: '项目接口' }, { id: 12, label: '项目二' }]
    model.selectedGroups.value = [{ id: 4, label: '分组 A' }]
    await nextTick(); await flushPromises()
    expect(api.get.mock.lastCall?.[1]).toMatchObject({ api_key_ids: [11, 12], group_ids: [4], sort_order: UsageBoardSortOrder.DESC })
    const count = api.get.mock.calls.length
    model.chartType.value = UsageBoardChartType.BAR; await nextTick()
    expect(api.get).toHaveBeenCalledTimes(count)
    model.toggleSort(); await nextTick(); await flushPromises()
    expect(api.get.mock.lastCall?.[1]).toMatchObject({ api_key_ids: [11, 12], group_ids: [4], sort_order: UsageBoardSortOrder.ASC })
    wrapper.unmount()
  })
  it('converts date and month controls and rejects reversed dates without requesting', async () => {
    const { model, wrapper } = harness(); await flushPromises()
    model.filters.startDate = '2024-02-03'; model.filters.endDate = '2024-03-04'
    model.setGranularity(UsageBoardGranularity.MONTH); await nextTick(); await flushPromises()
    expect(api.get.mock.lastCall?.[1]).toMatchObject({ start_month: '2024-02', end_month: '2024-03' })
    expect(api.get.mock.lastCall?.[1]).not.toHaveProperty('start_date')
    model.setGranularity(UsageBoardGranularity.WEEK); await nextTick(); await flushPromises()
    expect(api.get.mock.lastCall?.[1]).toMatchObject({ start_date: '2024-02-01', end_date: '2024-03-31' })
    const calls = api.get.mock.calls.length
    model.filters.startDate = '2024-04-01'; await nextTick()
    expect(model.validation.value).toBe(UsageBoardValidation.REVERSED)
    expect(api.get).toHaveBeenCalledTimes(calls); expect(model.data.value).toBeNull()
    wrapper.unmount()
  })
  it('ignores stale successes and stale failures and preserves current errors as errors', async () => {
    const first = deferred<UsageBoardResponse>(), second = deferred<UsageBoardResponse>()
    api.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { model, wrapper } = harness()
    model.selectedKeys.value = [{ id: 11, label: '项目接口' }]; await nextTick()
    second.resolve(response(200)); await flushPromises()
    first.resolve(response(10)); await flushPromises()
    expect(model.data.value?.rows[0].total_tokens).toBe(200)
    const stale = deferred<UsageBoardResponse>()
    api.get.mockReturnValueOnce(stale.promise)
    void model.reload()
    api.get.mockResolvedValueOnce(response(300)); await model.reload()
    stale.reject(new Error('stale failure')); await flushPromises()
    expect(model.state.value).toBe(UsageBoardLoadState.READY)
    expect(model.data.value?.rows[0].total_tokens).toBe(300)
    api.get.mockRejectedValueOnce(new Error('database unavailable')); await model.reload()
    expect(model.state.value).toBe(UsageBoardLoadState.ERROR); expect(model.data.value).toBeNull()
    await model.reload(); expect(model.state.value).toBe(UsageBoardLoadState.READY)
    wrapper.unmount()
  })
  it('loads subsequent candidate pages without changing selected objects', async () => {
    api.keys.mockResolvedValueOnce({ items: [{ id: 11, name: 'one' }], total: 2 }).mockResolvedValueOnce({ items: [{ id: 12, name: 'two' }], total: 2 })
    const { model, wrapper } = harness(); await flushPromises()
    model.selectedKeys.value = [{ id: 11, label: 'one' }]
    await model.loadChoices(UsageBoardChoiceKind.KEY, true)
    expect(model.lookups.key.options.map((option) => option.id)).toEqual([11, 12])
    expect(model.selectedKeys.value).toEqual([{ id: 11, label: 'one' }])
    wrapper.unmount()
  })
})
