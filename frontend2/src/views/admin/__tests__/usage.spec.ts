import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import zh from '@shared-i18n/locales/zh'
import { UsageBoardGranularity, UsageBoardScope, type UsageBoardResponse } from '@shared-api/usageBoard'
import AdminUsageView from '../AdminUsageView.vue'

// Match the JIT flag used by the production Vite configuration.
vi.hoisted(() => { vi.stubGlobal('__INTLIFY_JIT_COMPILATION__', true) })

const api = vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  return { board: vi.fn(), list: vi.fn().mockResolvedValue({ items: [], total: 0 }), stats: vi.fn().mockResolvedValue(null), keys: vi.fn().mockResolvedValue([]) }
})
vi.mock('@shared-api/usageBoard', async () => ({ ...await vi.importActual<typeof import('@shared-api/usageBoard')>('@shared-api/usageBoard'), getUsageBoard: api.board }))
vi.mock('@shared-api/admin/usage', async () => ({ ...await vi.importActual<typeof import('@shared-api/admin/usage')>('@shared-api/admin/usage'), list: api.list, getStats: api.stats, searchApiKeys: api.keys }))
vi.mock('@shared-api/admin/groups', async () => ({ ...await vi.importActual<typeof import('@shared-api/admin/groups')>('@shared-api/admin/groups'), list: vi.fn().mockResolvedValue({ items: [], total: 0 }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }))

describe('admin usage board entry', () => {
  it('opens the real board in admin scope and preserves its filters when switching modules', async () => {
    const empty: UsageBoardResponse = { granularity: UsageBoardGranularity.DAY, timezone: 'UTC', start_date: '2026-09-07', end_date: '2026-09-07', periods: [], series: [], rows: [], pagination: { page: 1, page_size: 20, total: 0, pages: 1 } }
    api.board.mockResolvedValue(empty)
    const wrapper = mount(AdminUsageView, { attachTo: document.body, global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh', messages: { zh } })], stubs: { ConsoleShell: { template: '<main><slot /></main>' }, SurfaceDialog: true, PageState: true } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="usage-board-tab"]').text()).toBe('使用看板')
    expect(api.board).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="usage-board-tab"]').trigger('click'); await flushPromises()
    expect(api.board.mock.lastCall?.[0]).toBe(UsageBoardScope.ADMIN)
    expect(wrapper.get('[data-testid="usage-board"]').isVisible()).toBe(true)
    await wrapper.get('[data-testid="board-granularity-month"]').trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="usage-statistics-tab"]').trigger('click')
    expect(wrapper.get('[data-testid="usage-statistics-tab"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[data-testid="usage-board"]').isVisible()).toBe(false)
    const count = api.board.mock.calls.length
    await wrapper.get('[data-testid="usage-board-tab"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="board-granularity-month"]').attributes('aria-pressed')).toBe('true')
    expect(api.board).toHaveBeenCalledTimes(count)
    wrapper.unmount()
  })
})
