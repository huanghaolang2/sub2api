import { describe, expect, it } from 'vitest'
import type { UserMonitorDetail, UserMonitorView } from '@shared-api/channelMonitor'
import type { MonitorHealth } from '@shared-api/channelMonitorV2'
import {
  availabilityForWindow,
  healthClass,
  LegacyMonitorWindow,
  lineChartPoints,
  MonitorHealthMode,
  sliceByZoom,
  zoomWindow
} from '../model'

const row = { primary_model: 'gpt-5.5', availability_7d: 99.9 } as UserMonitorView
const detail = { models: [{ model: 'gpt-5.5', availability_7d: 99.9, availability_15d: 99.7, availability_30d: 99.5 }] } as UserMonitorDetail

describe('channel monitor model', () => {
  it('resolves legacy availability without discarding any time window', () => {
    expect(availabilityForWindow(row, undefined, LegacyMonitorWindow.DAYS_7)).toBe(99.9)
    expect(availabilityForWindow(row, detail, LegacyMonitorWindow.DAYS_15)).toBe(99.7)
    expect(availabilityForWindow(row, detail, LegacyMonitorWindow.DAYS_30)).toBe(99.5)
  })

  it('maps health scores and coarse states for every pulse mode', () => {
    const health = { overall: 'healthy', error_rate: 'warning', ttft: 'critical', cache: 'healthy', score: 88, error_rate_score: 64 } as MonitorHealth
    expect(healthClass(health, MonitorHealthMode.OVERALL)).toBe('score-9')
    expect(healthClass(health, MonitorHealthMode.SUCCESS)).toBe('score-6')
    expect(healthClass({ ...health, score: null }, MonitorHealthMode.OVERALL)).toBe('state-healthy')
  })

  it('builds line points and applies cursor-centered zoom windows', () => {
    expect(lineChartPoints([1, 2, 3], 100, 40).split(' ')).toHaveLength(3)
    const zoom = zoomWindow({ start: 0, span: 1 }, -1, 0.5)
    expect(zoom.span).toBeLessThan(1)
    expect(sliceByZoom([1, 2, 3, 4, 5, 6, 7, 8], zoom).length).toBeLessThan(8)
  })
})
