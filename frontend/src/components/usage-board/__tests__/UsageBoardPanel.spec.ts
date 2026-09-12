import { createI18n } from 'vue-i18n'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zh from '@/i18n/locales/zh'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder, type UsageBoardResponse } from '@/api/usageBoard'
import UsageBoardPanel from '../UsageBoardPanel.vue'

// Match the JIT flag used by the production Vite configuration.
vi.hoisted(() => { vi.stubGlobal('__INTLIFY_JIT_COMPILATION__', true) })

const api = vi.hoisted(() => ({ board: vi.fn(), keys: vi.fn(), groups: vi.fn(), adminKeys: vi.fn(), adminGroups: vi.fn() }))
vi.mock('@/api/usageBoard', async () => ({ ...await vi.importActual<typeof import('@/api/usageBoard')>('@/api/usageBoard'), getUsageBoard: api.board }))
vi.mock('@/api/keys', () => ({ list: api.keys }))
vi.mock('@/api/groups', () => ({ getAvailable: api.groups }))
vi.mock('@/api/admin/usage', () => ({ searchApiKeys: api.adminKeys }))
vi.mock('@/api/admin/groups', () => ({ list: api.adminGroups }))

function boardResponse(): UsageBoardResponse {
  const periods = ['07', '08', '09'].map((day) => ({ start: `2026-09-${day}`, end: `2026-09-${day}`, label: `2026-09-${day}`, coverage: UsageBoardCoverage.FULL }))
  const points = periods.map((period, index) => ({ period_start: period.start, total_tokens: index === 0 ? 120 : 0, record_count: index === 2 ? 0 : 1, data_state: index === 2 ? UsageBoardDataState.MISSING : UsageBoardDataState.OBSERVED }))
  return { granularity: UsageBoardGranularity.DAY, timezone: 'Asia/Taipei', start_date: periods[0].start, end_date: periods[2].end, periods,
    series: [{ api_key_id: 11, api_key_name: '项目接口', points }],
    rows: points.map((point, index) => ({ ...point, period_label: periods[index].label, coverage: UsageBoardCoverage.FULL, api_key_id: 11, api_key_name: '项目接口' })),
    pagination: { page: 1, page_size: 20, total: 3, pages: 1 } }
}
function render(scope = UsageBoardScope.SELF) {
  return mount(UsageBoardPanel, { props: { scope }, global: { stubs: { teleport: true }, plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })] } })
}
describe('UsageBoardPanel', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ matches: true, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }))
    vi.clearAllMocks()
    api.board.mockResolvedValue(boardResponse())
    api.keys.mockResolvedValue({ items: [{ id: 11, name: '项目接口' }, { id: 12, name: '另一个接口' }], total: 2 })
    api.groups.mockResolvedValue([{ id: 4, name: 'G1' }])
    api.adminKeys.mockResolvedValue([{ id: 11, name: '项目接口' }, { id: 12, name: '另一个接口' }])
    api.adminGroups.mockResolvedValue({ items: [{ id: 4, name: 'G1' }], total: 1 })
  })
  it('renders a real chart above the table and distinguishes observed zero from missing in both chart types', async () => {
    const wrapper = render(); await flushPromises()
    expect(wrapper.text()).toContain('数据来源：使用记录')
    expect(wrapper.get('[data-testid="board-chart-line"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="board-granularity-day"]').attributes('aria-pressed')).toBe('true')
    const chart = wrapper.get('[data-testid="board-chart"]')
    const table = wrapper.get('[data-testid="board-table"]')
    expect(chart.element.compareDocumentPosition(table.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chart.findAll('svg')).toHaveLength(1)
    expect(table.findAll('tbody [data-state="observed"]')).toHaveLength(2)
    expect(table.get('tbody [data-state="missing"]').text()).toMatch(/0\s*百万\s*无数据/)
    await wrapper.get('[data-testid="board-chart-period-1"]').trigger('focus')
    expect(wrapper.get('[data-testid="board-chart-tooltip"]').text()).toContain('0 百万')
    expect(wrapper.get('[data-testid="board-chart-tooltip"]').text()).not.toContain('无数据')
    await wrapper.get('[data-testid="board-chart-period-2"]').trigger('focus')
    expect(wrapper.get('[data-testid="board-chart-tooltip"]').text()).toContain('0 百万 · 无数据')
    const calls = api.board.mock.calls.length
    await wrapper.get('[data-testid="board-chart-bar"]').trigger('click')
    expect(wrapper.findAll('[data-testid="board-observed-zero-bar"]')).toHaveLength(1)
    expect(wrapper.findAll('svg g[data-state="missing"] rect.board-missing-marker')).toHaveLength(1)
    expect(api.board).toHaveBeenCalledTimes(calls)
    wrapper.unmount()
  })
  it('applies multi-select filters and sorting in both permission scopes', async () => {
    for (const scope of [UsageBoardScope.SELF, UsageBoardScope.ADMIN]) {
      const wrapper = render(scope); await flushPromises()
      await wrapper.get('[data-testid="board-key-select"] button').trigger('click')
      await wrapper.get('[data-testid="board-key-option-11"]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="board-key-select"] button').trigger('click')
      await wrapper.get('[data-testid="board-key-option-12"]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="board-group-select"] button').trigger('click')
      await wrapper.get('[data-testid="board-group-option-4"]').trigger('click')
      await flushPromises()
      expect(api.board.mock.lastCall?.[0]).toBe(scope)
      expect(api.board.mock.lastCall?.[1]).toMatchObject({ api_key_ids: [11, 12], group_ids: [4] })
      await wrapper.get('[data-testid="board-token-sort"]').trigger('click'); await flushPromises()
      expect(api.board.mock.lastCall?.[1]).toMatchObject({ api_key_ids: [11, 12], group_ids: [4], sort_order: UsageBoardSortOrder.ASC })
      expect(wrapper.get('[data-testid="board-token-sort"]').element.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
      await wrapper.get('[data-testid="board-granularity-month"]').trigger('click'); await flushPromises()
      expect(wrapper.find('[data-testid="board-start-date"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="board-start-month"]').exists()).toBe(true)
      expect(api.board.mock.lastCall?.[1]).toMatchObject({ granularity: UsageBoardGranularity.MONTH, api_key_ids: [11, 12] })
      wrapper.unmount()
    }
  })
  it('shows field validation and retries failures without presenting them as missing data', async () => {
    const wrapper = render(); await flushPromises()
    await wrapper.get('[data-testid="board-end-date"]').setValue('2026-01-01'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('开始时间不能晚于结束时间')
    expect(wrapper.find('[data-testid="board-table"]').exists()).toBe(false)
    api.board.mockRejectedValueOnce(new Error('查询失败'))
    await wrapper.get('[data-testid="board-end-date"]').setValue('2027-01-01'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('查询失败')
    expect(wrapper.find('[data-testid="board-chart"] svg').exists()).toBe(false)
    await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="board-table"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('keeps empty periods visible without inventing an API key', async () => {
    const empty = boardResponse()
    empty.series = [{ api_key_id: null, api_key_name: '—', points: empty.periods.map((period) => ({ period_start: period.start, total_tokens: 0, record_count: 0, data_state: UsageBoardDataState.MISSING })) }]
    empty.rows = empty.rows.map((row) => ({ ...row, api_key_id: null, api_key_name: '—', total_tokens: 0, record_count: 0, data_state: UsageBoardDataState.MISSING }))
    api.board.mockResolvedValueOnce(empty)
    const wrapper = render(); await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
    expect(wrapper.findAll('tbody [data-state="missing"]')).toHaveLength(3)
    expect(wrapper.get('.board-legend').text()).toBe('无数据')
    wrapper.unmount()
  })
})
