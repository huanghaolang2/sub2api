import { describe, expect, it } from 'vitest'
import { BillingModeOption, findModelConflict, millionToPerToken, perTokenToMillion, pricingDraftsToApi, pricingToDraft } from '../model'

describe('admin resource pricing model', () => {
  it('round-trips token prices through readable per-million values', () => {
    expect(perTokenToMillion(0.00000125)).toBe(1.25)
    expect(millionToPerToken(1.25)).toBe(0.00000125)
    const api = pricingDraftsToApi([pricingToDraft({
      platform: 'openai', models: ['gpt-5.5'], billing_mode: BillingModeOption.TOKEN,
      input_price: 0.00000125, output_price: 0.00001, cache_write_price: null, cache_read_price: null,
      image_input_price: null, image_output_price: null, per_request_price: null, intervals: []
    })])
    expect(api[0]?.input_price).toBe(0.00000125)
    expect(api[0]?.models).toEqual(['gpt-5.5'])
  })

  it('rejects duplicate models and overlapping token intervals before sending', () => {
    const duplicate = pricingToDraft({
      platform: 'openai', models: ['gpt-5.5'], billing_mode: BillingModeOption.TOKEN,
      input_price: null, output_price: null, cache_write_price: null, cache_read_price: null,
      image_input_price: null, image_output_price: null, per_request_price: null, intervals: []
    })
    expect(() => pricingDraftsToApi([duplicate, { ...duplicate }])).toThrow('重复配置')

    const overlap = { ...duplicate, intervals: [
      { min_tokens: 0, max_tokens: 100, tier_label: 'A', input_price: 1, output_price: 2, cache_write_price: null, cache_read_price: null, per_request_price: null, sort_order: 0 },
      { min_tokens: 80, max_tokens: null, tier_label: 'B', input_price: 2, output_price: 3, cache_write_price: null, cache_read_price: null, per_request_price: null, sort_order: 1 }
    ] }
    expect(() => pricingDraftsToApi([overlap])).toThrow('不能重叠')
  })

  it('rejects negative prices before sending', () => {
    const draft = pricingToDraft({
      platform: 'openai', models: ['gpt-5.5'], billing_mode: BillingModeOption.TOKEN,
      input_price: null, output_price: null, cache_write_price: null, cache_read_price: null,
      image_input_price: null, image_output_price: null, per_request_price: null, intervals: []
    })
    draft.input_price = -1
    expect(() => pricingDraftsToApi([draft])).toThrow('输入价格不能为负数')
  })

  it('detects exact and wildcard model conflicts', () => {
    expect(findModelConflict(['gpt-5*', 'gpt-5.5'])).toEqual(['gpt-5*', 'gpt-5.5'])
    expect(findModelConflict(['gpt-5.5', 'claude-4'])).toBeNull()
  })
})
