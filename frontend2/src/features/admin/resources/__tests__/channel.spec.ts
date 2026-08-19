import { describe, expect, it } from 'vitest'
import { channelDraftToRequest, emptyChannelDraft, emptyChannelRule } from '../channel'
import { BillingModeOption, emptyPricingDraft } from '../model'

describe('admin channel request model', () => {
  it('keeps grouped pricing, model mappings, feature flags, and account statistics rules', () => {
    const draft = emptyChannelDraft()
    draft.name = '高可用渠道'
    draft.group_ids = [2, 2, 3]
    draft.features_config_json = '{"legacy_flag":{"enabled":true}}'
    draft.model_mapping_json = '{"openai":{"gpt-5":"gpt-5.5"}}'
    draft.web_search_emulation = true
    draft.codex_image_generation_bridge = true
    draft.bedrock_cc_compat = true
    draft.apply_pricing_to_account_stats = true
    const price = emptyPricingDraft('openai')
    Object.assign(price, { modelsText: 'gpt-5', billing_mode: BillingModeOption.TOKEN, input_price: 2, output_price: 8, image_input_price: 3 })
    draft.model_pricing = [price]
    const rule = emptyChannelRule()
    rule.name = '专属账号统计'
    rule.account_ids = [19]
    rule.pricing = [{ ...price, modelsText: 'gpt-5.5' }]
    draft.account_stats_pricing_rules = [rule]

    const request = channelDraftToRequest(draft, false)

    expect(request.group_ids).toEqual([2, 3])
    expect(request.model_mapping).toEqual({ openai: { 'gpt-5': 'gpt-5.5' } })
    expect(request.features_config).toMatchObject({
      legacy_flag: { enabled: true },
      web_search_emulation: { openai: false },
      codex_image_generation_bridge: { openai: true },
      bedrock_cc_compat: true
    })
    expect(request.model_pricing?.[0]).toMatchObject({ input_price: 0.000002, image_input_price: 0.000003 })
    expect(request.account_stats_pricing_rules?.[0]).toMatchObject({ name: '专属账号统计', account_ids: [19] })
  })

  it('rejects conflicting wildcard sources inside one platform mapping', () => {
    const draft = emptyChannelDraft()
    draft.name = '冲突渠道'
    draft.group_ids = [1]
    draft.model_mapping_json = '{"openai":{"gpt-5*":"a","gpt-5.5":"b"}}'

    expect(() => channelDraftToRequest(draft, false)).toThrow('映射源模式 gpt-5* 与 gpt-5.5 冲突')
  })
})
