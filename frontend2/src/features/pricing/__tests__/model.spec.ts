import { describe, expect, it } from 'vitest'
import type { ModelPlazaGroup } from '@shared-api/modelPlaza'
import { BILLING_MODE_IMAGE, BILLING_MODE_TOKEN } from '@/constants/channel'
import {
  filterPricing,
  flattenPricing,
  formatEffectivePrice,
  PricingBillingFilter
} from '@/features/pricing/model'

const groups: ModelPlazaGroup[] = [{
  id: 1,
  name: 'Codex 企业组',
  description: '企业低延迟模型',
  platform: 'openai',
  subscription_type: 'standard',
  rate_multiplier: 0.5,
  user_rate_multiplier: 0.4,
  peak_rate_enabled: true,
  peak_start: '18:00',
  peak_end: '23:00',
  peak_rate_multiplier: 1.2,
  is_exclusive: true,
  image_rate_independent: false,
  image_rate_multiplier: 1,
  models: [{
    name: 'gpt-5.6-sol',
    platform: 'openai',
    pricing: {
      billing_mode: BILLING_MODE_TOKEN,
      input_price: 2e-6,
      output_price: 10e-6,
      cache_write_price: 2.5e-6,
      cache_read_price: 0.2e-6,
      image_input_price: 3e-6,
      image_output_price: 30e-6,
      per_request_price: null,
      intervals: [{
        min_tokens: 0,
        max_tokens: 200000,
        tier_label: '标准上下文',
        input_price: 2e-6,
        output_price: 10e-6,
        cache_write_price: 2.5e-6,
        cache_read_price: 0.2e-6,
        per_request_price: null
      }]
    },
    official_pricing: {
      input_price: 2e-6,
      output_price: 10e-6,
      cache_write_price: 2.5e-6,
      cache_write_1h_price: 4e-6,
      cache_read_price: 0.2e-6
    }
  }]
}]

describe('pricing model', () => {
  it('maps every shared model-plaza price and group field without loss', () => {
    const row = flattenPricing(groups)[0]
    expect(row).toEqual(expect.objectContaining({
      effectiveRate: 0.4,
      defaultRate: 0.5,
      userRate: 0.4,
      peakRateEnabled: true,
      peakRate: 1.2,
      isExclusive: true,
      input: 2e-6,
      output: 10e-6,
      cacheWrite: 2.5e-6,
      cacheRead: 0.2e-6,
      imageInput: 3e-6,
      imageOutput: 30e-6,
      officialCacheWrite1h: 4e-6
    }))
    expect(row.intervals).toHaveLength(1)
    expect(formatEffectivePrice(row.input, row.effectiveRate, row.billingMode)).toBe('$0.8')
  })

  it('uses the independent image rate only for image-billed models', () => {
    const imageGroup: ModelPlazaGroup = {
      ...groups[0],
      image_rate_independent: true,
      image_rate_multiplier: 0.65,
      models: [{
        name: 'image-model',
        platform: 'openai',
        pricing: { ...groups[0].models[0].pricing!, billing_mode: BILLING_MODE_IMAGE },
        official_pricing: null
      }]
    }
    expect(flattenPricing([imageGroup])[0].effectiveRate).toBe(0.65)
  })

  it('filters across descriptions, visibility, platform, and billing mode', () => {
    const rows = flattenPricing(groups)
    expect(filterPricing(rows, '低延迟', 'openai')).toHaveLength(1)
    expect(filterPricing(rows, '专属', 'all')).toHaveLength(1)
    expect(filterPricing(rows, '', 'all', PricingBillingFilter.IMAGE)).toHaveLength(0)
  })
})
