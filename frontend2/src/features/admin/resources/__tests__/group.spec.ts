import { describe, expect, it } from 'vitest'
import { emptyGroupDraft, groupDraftToRequest } from '../group'
import { BillingModeOption, GroupPlatformOption, emptyPricingDraft } from '../model'

describe('admin group request model', () => {
  it('keeps pricing, quotas, media, routing, and protocol fields in the shared request contract', () => {
    const draft = emptyGroupDraft()
    Object.assign(draft, {
      name: 'OpenAI 生产组',
      platform: GroupPlatformOption.OPENAI,
      subscription_type: 'subscription',
      daily_limit_usd: 20,
      weekly_limit_usd: 100,
      monthly_limit_usd: 300,
      rpm_limit: 240,
      allow_image_generation: true,
      image_price_1k: 0.04,
      video_model_prices_json: '{"grok-video":{"720p":0.8}}',
      peak_rate_enabled: true,
      peak_start: '09:00',
      peak_end: '18:00',
      profit_control_enabled: true,
      profit_min_margin: 0.2,
      allow_messages_dispatch: true,
      allow_live: true,
      models_list_enabled: true,
      models_list_text: 'gpt-5.5\ngpt-5.6-sol',
      model_routing_enabled: true,
      model_routing_json: '{"gpt-5.5":[12,13]}',
      reasoning_effort_mappings_json: '[{"from":"xhigh","to":"high"}]',
      copy_accounts_from_group_ids: [7, 8]
    })
    const pricing = emptyPricingDraft(GroupPlatformOption.OPENAI)
    Object.assign(pricing, { modelsText: 'gpt-5.5', billing_mode: BillingModeOption.TOKEN, input_price: 1.25, output_price: 10 })
    draft.model_pricing = [pricing]

    const request = groupDraftToRequest(draft, false)

    expect(request).toMatchObject({
      name: 'OpenAI 生产组',
      platform: GroupPlatformOption.OPENAI,
      daily_limit_usd: 20,
      rpm_limit: 240,
      allow_image_generation: true,
      image_price_1k: 0.04,
      video_model_prices: { 'grok-video': { '720p': 0.8 } },
      peak_rate_enabled: true,
      profit_control_enabled: true,
      allow_messages_dispatch: true,
      allow_live: true,
      models_list_config: { enabled: true, models: ['gpt-5.5', 'gpt-5.6-sol'] },
      model_routing: { 'gpt-5.5': [12, 13] },
      reasoning_effort_mappings: [{ from: 'xhigh', to: 'high' }],
      copy_accounts_from_group_ids: [7, 8]
    })
    expect(request.model_pricing?.[0]).toMatchObject({ models: ['gpt-5.5'], input_price: 0.00000125, output_price: 0.00001 })
    expect(request).not.toHaveProperty('status')
  })

  it('rejects wildcard pricing conflicts before a group is saved', () => {
    const draft = emptyGroupDraft()
    draft.name = '冲突组'
    const wildcard = emptyPricingDraft(GroupPlatformOption.OPENAI)
    wildcard.modelsText = 'gpt-5*'
    const exact = emptyPricingDraft(GroupPlatformOption.OPENAI)
    exact.modelsText = 'gpt-5.5'
    draft.model_pricing = [wildcard, exact]

    expect(() => groupDraftToRequest(draft, false)).toThrow('模型模式 gpt-5* 与 gpt-5.5 冲突')
  })
})
