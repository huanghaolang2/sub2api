import { describe, expect, it } from 'vitest'
import type { UserAvailableChannel } from '@shared-api/channels'
import {
  ChannelAccessFilter,
  effectiveGroupRate,
  filterAvailableChannels,
  modelRateRange,
  summarizeAvailableChannels
} from '../model'

const channels: UserAvailableChannel[] = [{
  name: '全球智能路由',
  description: '生产流量',
  platforms: [
    {
      platform: 'openai',
      groups: [{ id: 1, name: '企业专属', platform: 'openai', subscription_type: 'standard', rate_multiplier: 1, peak_rate_enabled: true, peak_start: '09:00', peak_end: '12:00', peak_rate_multiplier: 1.2, is_exclusive: true }],
      supported_models: [{ name: 'gpt-5.5', platform: 'openai', pricing: null }]
    },
    {
      platform: 'anthropic',
      groups: [{ id: 2, name: '公共 Claude', platform: 'anthropic', subscription_type: 'standard', rate_multiplier: 1.1, peak_rate_enabled: false, peak_start: '', peak_end: '', peak_rate_multiplier: 1, is_exclusive: false }],
      supported_models: [{ name: 'claude-opus-4-1', platform: 'anthropic', pricing: null }]
    }
  ]
}]

describe('available channel model', () => {
  it('keeps an entire channel when its name matches and narrows section-level matches otherwise', () => {
    expect(filterAvailableChannels(channels, '智能路由', 'all', ChannelAccessFilter.ALL)[0]?.platforms).toHaveLength(2)
    expect(filterAvailableChannels(channels, 'claude-opus', 'all', ChannelAccessFilter.ALL)[0]?.platforms.map((item) => item.platform)).toEqual(['anthropic'])
    expect(filterAvailableChannels(channels, '企业专属', 'all', ChannelAccessFilter.PUBLIC)).toEqual([])
  })

  it('filters platform/access and summarizes unique capabilities', () => {
    const filtered = filterAvailableChannels(channels, '', 'openai', ChannelAccessFilter.EXCLUSIVE)
    expect(filtered[0]?.platforms).toHaveLength(1)
    expect(summarizeAvailableChannels(channels)).toEqual({ channels: 1, platforms: 2, groups: 2, models: 2 })
  })

  it('joins account rates and exposes the effective range for every supported model', () => {
    const section = channels[0]!.platforms[0]!
    expect(effectiveGroupRate(section.groups[0]!, { 1: 0.82 })).toBe(0.82)
    expect(modelRateRange(section.supported_models[0]!, section, { 1: 0.82 })).toBe('基准价')
  })
})
