import type { AccountStatsPricingRule, Channel, CreateChannelRequest, UpdateChannelRequest } from '@shared-api/admin/channels'
import type { BillingModelSource, ChannelStatus } from '@/constants/channel'
import { findModelConflict, parseJsonValue, pricingDraftsToApi, pricingToDraft, splitValues, type ChannelPricingDraft } from './model'

export enum ChannelEditorTab { BASIC = 'basic', PRICING = 'pricing', ADVANCED = 'advanced' }

export interface ChannelRuleDraft {
  name: string
  group_ids: number[]
  account_ids: number[]
  pricing: ChannelPricingDraft[]
}

export interface ChannelDraft {
  name: string
  description: string
  status: ChannelStatus
  billing_model_source: BillingModelSource
  restrict_models: boolean
  group_ids: number[]
  model_pricing: ChannelPricingDraft[]
  model_mapping_json: string
  features_config_json: string
  web_search_emulation: boolean
  codex_image_generation_bridge: boolean
  bedrock_cc_compat: boolean
  apply_pricing_to_account_stats: boolean
  account_stats_pricing_rules: ChannelRuleDraft[]
}

export function emptyChannelDraft(): ChannelDraft {
  return {
    name: '', description: '', status: 'active', billing_model_source: 'channel_mapped', restrict_models: false,
    group_ids: [], model_pricing: [], model_mapping_json: '{}', features_config_json: '{}', web_search_emulation: false,
    codex_image_generation_bridge: false, bedrock_cc_compat: false, apply_pricing_to_account_stats: false,
    account_stats_pricing_rules: []
  }
}

export function channelToDraft(channel: Channel): ChannelDraft {
  const features = channel.features_config || {}
  const web = features.web_search_emulation as Record<string, boolean> | undefined
  const imageBridge = features.codex_image_generation_bridge as Record<string, boolean> | undefined
  return {
    name: channel.name, description: channel.description || '', status: channel.status,
    billing_model_source: channel.billing_model_source, restrict_models: channel.restrict_models,
    group_ids: [...(channel.group_ids || [])], model_pricing: (channel.model_pricing || []).map(pricingToDraft),
    model_mapping_json: JSON.stringify(channel.model_mapping || {}, null, 2), features_config_json: JSON.stringify(features, null, 2),
    web_search_emulation: Object.values(web || {}).some(Boolean),
    codex_image_generation_bridge: Object.values(imageBridge || {}).some(Boolean),
    bedrock_cc_compat: features.bedrock_cc_compat === true || Object.values((features.bedrock_cc_compat || {}) as Record<string, boolean>).some(Boolean),
    apply_pricing_to_account_stats: channel.apply_pricing_to_account_stats,
    account_stats_pricing_rules: (channel.account_stats_pricing_rules || []).map((rule) => ({
      name: rule.name, group_ids: [...rule.group_ids], account_ids: [...rule.account_ids], pricing: rule.pricing.map(pricingToDraft)
    }))
  }
}

export function emptyChannelRule(): ChannelRuleDraft { return { name: '', group_ids: [], account_ids: [], pricing: [] } }

export function channelDraftToRequest(draft: ChannelDraft, editing: boolean): CreateChannelRequest | UpdateChannelRequest {
  if (!draft.name.trim()) throw new Error('渠道名称不能为空')
  if (!draft.group_ids.length) throw new Error('至少选择一个分组')
  const byPlatform = new Map<string, string[]>()
  draft.model_pricing.forEach((entry) => byPlatform.set(entry.platform, [...(byPlatform.get(entry.platform) || []), ...splitValues(entry.modelsText)]))
  byPlatform.forEach((models, platform) => {
    const conflict = findModelConflict(models)
    if (conflict) throw new Error(`${platform || '未指定平台'} 的模型模式 ${conflict[0]} 与 ${conflict[1]} 冲突`)
  })
  const pricing = pricingDraftsToApi(draft.model_pricing)
  const modelMapping = parseJsonValue<Record<string, Record<string, string>>>(draft.model_mapping_json, '模型映射', {})
  if (!modelMapping || Array.isArray(modelMapping) || typeof modelMapping !== 'object') throw new Error('模型映射必须是按平台分组的 JSON 对象')
  Object.entries(modelMapping).forEach(([platform, mapping]) => {
    if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new Error(`${platform} 的模型映射必须是 JSON 对象`)
    const conflict = findModelConflict(Object.keys(mapping))
    if (conflict) throw new Error(`${platform} 的映射源模式 ${conflict[0]} 与 ${conflict[1]} 冲突`)
  })
  const features = parseJsonValue<Record<string, unknown>>(draft.features_config_json, '扩展能力配置', {})
  const platforms = [...new Set(pricing.map((item) => item.platform).filter(Boolean))]
  if (draft.web_search_emulation) features.web_search_emulation = Object.fromEntries(platforms.map((platform) => [platform, platform === 'anthropic']))
  else delete features.web_search_emulation
  if (draft.codex_image_generation_bridge) features.codex_image_generation_bridge = { openai: true }
  else delete features.codex_image_generation_bridge
  if (draft.bedrock_cc_compat) features.bedrock_cc_compat = true
  else delete features.bedrock_cc_compat
  const rules: AccountStatsPricingRule[] = draft.account_stats_pricing_rules.map((rule, index) => {
    if (!rule.name.trim()) throw new Error(`第 ${index + 1} 个账号统计价格规则缺少名称`)
    if (!rule.group_ids.length && !rule.account_ids.length) throw new Error(`规则 ${rule.name} 至少需要一个分组或账号`)
    return { name: rule.name.trim(), group_ids: [...rule.group_ids], account_ids: [...rule.account_ids], pricing: pricingDraftsToApi(rule.pricing) }
  })
  const payload: CreateChannelRequest & UpdateChannelRequest = {
    name: draft.name.trim(), description: draft.description.trim() || undefined,
    group_ids: [...new Set(draft.group_ids)], model_pricing: pricing,
    model_mapping: modelMapping, billing_model_source: draft.billing_model_source,
    restrict_models: draft.restrict_models, features_config: features,
    apply_pricing_to_account_stats: draft.apply_pricing_to_account_stats, account_stats_pricing_rules: rules
  }
  if (editing) payload.status = draft.status
  return payload
}
