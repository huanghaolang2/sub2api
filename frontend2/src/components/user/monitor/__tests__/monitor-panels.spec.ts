import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserMonitorView } from '@shared-api/channelMonitor'
import type { MonitorHealth, MonitorMetric } from '@shared-api/channelMonitorV2'
import LegacyMonitorDetailDialog from '../LegacyMonitorDetailDialog.vue'
import LegacyMonitorPanel from '../LegacyMonitorPanel.vue'
import RealtimeMonitorPanel from '../RealtimeMonitorPanel.vue'

const api = vi.hoisted(() => ({
  legacyList: vi.fn(), legacyStatus: vi.fn(), dimensions: vi.fn(), snapshot: vi.fn(), matrix: vi.fn(), models: vi.fn(), errors: vi.fn(), users: vi.fn()
}))

vi.mock('@shared-api/channelMonitor', () => ({ list: api.legacyList, status: api.legacyStatus }))
vi.mock('@shared-api/channelMonitorV2', () => ({
  getDimensions: api.dimensions,
  getSnapshot: api.snapshot,
  getMatrix: api.matrix,
  getModels: api.models,
  getErrors: api.errors,
  getUsers: api.users
}))
vi.mock('@/utils/featureFlags', () => ({ isChannelMonitorThroughputHidden: () => false }))

function metric(overrides: Partial<MonitorMetric> = {}): MonitorMetric {
  return {
    success_requests: 98, error_requests: 2, request_count: 100, token_count: 1000, rpm: 12, tpm: 6000,
    error_rate: 0.02, cache_rate: 0.6, cache_rate_numerator: 60, cache_rate_denominator: 100,
    ttft: { sample_count: 100, p50_ms: 300, p90_ms: 700, p95_ms: 900, avg_ms: 380 },
    duration: { sample_count: 100, p50_ms: 1200, p90_ms: 2200, p95_ms: 2800, avg_ms: 1450 },
    ...overrides
  }
}

function health(): MonitorHealth {
  return { overall: 'healthy', error_rate: 'healthy', ttft: 'healthy', cache: 'healthy', score: 92, error_rate_score: 94, ttft_score: 90, cache_score: 88, minimum_sample: 20 }
}

const coverage = { requested_start: '2026-08-18T00:00:00Z', requested_end: '2026-08-18T01:30:00Z', coverage_start: '2026-08-18T00:00:00Z', data_through: '2026-08-18T01:28:00Z', computed_at: '2026-08-18T01:30:00Z', aggregation_lag_seconds: 120, coverage_complete: true, bucket_seconds: 300 }
const matrixRow = { platform: 'openai', group_id: 101, group_name: '企业专属', model: 'gpt-5.5', metrics: metric(), health: health(), buckets: [{ bucket_start: '2026-08-18T01:20:00Z', metrics: metric(), health: health() }] }

async function mountRealtime() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/monitor', component: { template: '<div />' } }] })
  await router.push('/monitor')
  await router.isReady()
  const wrapper = mount(RealtimeMonitorPanel, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  return wrapper
}

describe('realtime channel monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.dimensions.mockResolvedValue({ platforms: [{ value: 'openai', label: 'OpenAI', request_count: 100 }], groups: [{ id: 101, name: '企业专属', platform: 'openai', request_count: 100 }], models: [{ value: 'gpt-5.5', label: 'gpt-5.5', platform: 'openai', request_count: 100 }] })
    api.snapshot.mockResolvedValue({ config: { refresh_interval_seconds: 60 }, coverage, metrics: metric(), health: health(), trend: matrixRow.buckets })
    api.matrix.mockResolvedValue({ coverage, group_by: 'platform_group', items: [matrixRow] })
    api.models.mockResolvedValue({ coverage, items: [{ platform: 'openai', model: 'gpt-5.5', metrics: metric(), health: health() }] })
    api.errors.mockResolvedValue({ coverage, items: [{ category: 'rate_or_capacity', count: 2, rate: 0.02, details: [{ platform: 'openai', model: 'gpt-5.5', count: 2, message: 'limited' }] }] })
    api.users.mockResolvedValue({ coverage, items: [{ user_id: 2, rank: 1, display_label: '当前用户', is_self: true, can_drilldown: true, metrics: metric() }] })
  })

  it('loads dimensions, snapshot, matrix, and the active detail through shared APIs', async () => {
    const wrapper = await mountRealtime()
    expect(api.dimensions).toHaveBeenCalledWith({ range: '90m', platforms: [], groupIds: [], models: [] }, false, expect.any(AbortSignal))
    expect(api.snapshot).toHaveBeenCalledWith(expect.objectContaining({ range: '90m' }), false, expect.any(AbortSignal))
    expect(api.matrix).toHaveBeenCalledWith(expect.anything(), 'platform_group', false, expect.any(AbortSignal))
    expect(api.models).toHaveBeenCalled()
    expect(wrapper.text()).toContain('98.0%')
    expect(wrapper.text()).toContain('gpt-5.5')
    wrapper.unmount()
  })

  it('switches detail APIs, expands errors, and drills a model in one action', async () => {
    const wrapper = await mountRealtime()
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(api.errors).toHaveBeenCalled()
    await wrapper.find('.error-list > article > button').trigger('click')
    expect(wrapper.text()).toContain('limited')

    await wrapper.findAll('[role="tab"]')[0]!.trigger('click')
    await flushPromises()
    await wrapper.find('tr.clickable').trigger('click')
    await flushPromises()
    expect(api.snapshot).toHaveBeenLastCalledWith(expect.objectContaining({ platforms: ['openai'], models: ['gpt-5.5'] }), false, expect.any(AbortSignal))
    wrapper.unmount()
  })
})

describe('legacy channel monitor', () => {
  beforeEach(() => {
    const legacy: UserMonitorView = { id: 301, name: 'OpenAI 企业线路', provider: 'openai', group_name: '企业专属', primary_model: 'gpt-5.5', primary_status: 'operational', primary_latency_ms: 800, primary_ping_latency_ms: 40, availability_7d: 99.98, extra_models: [], timeline: [] }
    api.legacyList.mockResolvedValue({ items: [legacy] })
    api.legacyStatus.mockResolvedValue({ id: 301, name: legacy.name, provider: legacy.provider, group_name: legacy.group_name, models: [{ model: 'gpt-5.5', latest_status: 'operational', latest_latency_ms: 800, availability_7d: 99.98, availability_15d: 99.94, availability_30d: 99.9, avg_latency_7d_ms: 810 }] })
  })

  it('keeps 7/15/30-day windows, auto-refresh controls, timelines, and detail drilldown', async () => {
    const wrapper = mount(LegacyMonitorPanel, { global: { plugins: [createPinia()], stubs: { LegacyMonitorDetailDialog: { props: ['show', 'monitorId', 'title'], template: '<aside />' } } } })
    await flushPromises()
    expect(api.legacyList).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    await wrapper.findAll('.segmented button')[1]!.trigger('click')
    await flushPromises()
    expect(api.legacyStatus).toHaveBeenCalledWith(301)
    expect(wrapper.text()).toContain('99.94%')
    await wrapper.find('.legacy-card').trigger('click')
    expect(wrapper.findComponent(LegacyMonitorDetailDialog).props('show')).toBe(true)
    wrapper.unmount()
  })
})
