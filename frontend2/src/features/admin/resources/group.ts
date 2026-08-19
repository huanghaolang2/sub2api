import type { AdminGroup, CreateGroupRequest, GroupPlatform, UpdateGroupRequest } from '@/types'
import {
  GroupPlatformOption,
  ResourceStatus,
  SubscriptionMode,
  findModelConflict,
  parseJsonValue,
  parseNonNegative,
  pricingDraftsToApi,
  pricingToDraft,
  splitValues,
  stringifyJson,
  type ChannelPricingDraft
} from './model'

export enum GroupEditorTab {
  BASIC = 'basic',
  PRICING = 'pricing',
  ROUTING = 'routing'
}

export interface GroupDraft {
  name: string
  description: string
  platform: GroupPlatform
  status: ResourceStatus.ACTIVE | ResourceStatus.INACTIVE
  subscription_type: SubscriptionMode
  rate_multiplier: number | string
  rpm_limit: number | string
  is_exclusive: boolean
  daily_limit_usd: number | string
  weekly_limit_usd: number | string
  monthly_limit_usd: number | string
  sort_order: number
  long_context_pricing_enabled: boolean
  allow_image_generation: boolean
  allow_batch_image_generation: boolean
  image_rate_independent: boolean
  image_rate_multiplier: number | string
  batch_image_discount_multiplier: number | string
  batch_image_hold_multiplier: number | string
  image_price_1k: number | string
  image_price_2k: number | string
  image_price_4k: number | string
  video_rate_independent: boolean
  video_rate_multiplier: number | string
  video_price_480p: number | string
  video_price_720p: number | string
  video_price_1080p: number | string
  video_model_prices_json: string
  web_search_price_per_call: number | string
  search_price_per_1k: number | string
  audio_realtime_price_per_min: number | string
  audio_tts_price_per_million_chars: number | string
  audio_stt_price_per_hour: number | string
  peak_rate_enabled: boolean
  peak_start: string
  peak_end: string
  peak_rate_multiplier: number | string
  profit_control_enabled: boolean
  profit_min_margin: number | string
  profit_safety_buffer: number | string
  claude_code_only: boolean
  fallback_group_id: number | string
  fallback_group_id_on_invalid_request: number | string
  mcp_xml_inject: boolean
  supported_model_scopes_text: string
  models_list_enabled: boolean
  models_list_text: string
  allow_messages_dispatch: boolean
  allow_live: boolean
  default_mapped_model: string
  messages_dispatch_json: string
  model_routing_enabled: boolean
  model_routing_json: string
  max_reasoning_effort: string
  reasoning_effort_mappings_json: string
  require_oauth_only: boolean
  require_privacy_set: boolean
  copy_accounts_from_group_ids: number[]
  model_pricing: ChannelPricingDraft[]
}

export function emptyGroupDraft(): GroupDraft {
  return {
    name: '', description: '', platform: GroupPlatformOption.OPENAI, status: ResourceStatus.ACTIVE,
    subscription_type: SubscriptionMode.STANDARD, rate_multiplier: 1, rpm_limit: 0, is_exclusive: false,
    daily_limit_usd: '', weekly_limit_usd: '', monthly_limit_usd: '', sort_order: 0,
    long_context_pricing_enabled: false, allow_image_generation: false, allow_batch_image_generation: false,
    image_rate_independent: false, image_rate_multiplier: 1, batch_image_discount_multiplier: 1,
    batch_image_hold_multiplier: 1, image_price_1k: '', image_price_2k: '', image_price_4k: '',
    video_rate_independent: false, video_rate_multiplier: 1, video_price_480p: '', video_price_720p: '',
    video_price_1080p: '', video_model_prices_json: '{}', web_search_price_per_call: '', search_price_per_1k: '',
    audio_realtime_price_per_min: '', audio_tts_price_per_million_chars: '', audio_stt_price_per_hour: '',
    peak_rate_enabled: false, peak_start: '00:00', peak_end: '00:00', peak_rate_multiplier: 1,
    profit_control_enabled: false, profit_min_margin: 0, profit_safety_buffer: 0,
    claude_code_only: false, fallback_group_id: '', fallback_group_id_on_invalid_request: '',
    mcp_xml_inject: false, supported_model_scopes_text: '', models_list_enabled: false, models_list_text: '',
    allow_messages_dispatch: false, allow_live: false, default_mapped_model: '', messages_dispatch_json: '{}',
    model_routing_enabled: false, model_routing_json: '{}', max_reasoning_effort: '',
    reasoning_effort_mappings_json: '[]', require_oauth_only: false, require_privacy_set: false,
    copy_accounts_from_group_ids: [], model_pricing: []
  }
}

export function groupToDraft(group: AdminGroup): GroupDraft {
  return {
    ...emptyGroupDraft(),
    ...group,
    description: group.description || '',
    daily_limit_usd: group.daily_limit_usd ?? '', weekly_limit_usd: group.weekly_limit_usd ?? '', monthly_limit_usd: group.monthly_limit_usd ?? '',
    rpm_limit: group.rpm_limit ?? 0,
    image_price_1k: group.image_price_1k ?? '', image_price_2k: group.image_price_2k ?? '', image_price_4k: group.image_price_4k ?? '',
    video_price_480p: group.video_price_480p ?? '', video_price_720p: group.video_price_720p ?? '', video_price_1080p: group.video_price_1080p ?? '',
    video_model_prices_json: stringifyJson(group.video_model_prices), web_search_price_per_call: group.web_search_price_per_call ?? '',
    search_price_per_1k: group.search_price_per_1k ?? '', audio_realtime_price_per_min: group.audio_realtime_price_per_min ?? '',
    audio_tts_price_per_million_chars: group.audio_tts_price_per_million_chars ?? '', audio_stt_price_per_hour: group.audio_stt_price_per_hour ?? '',
    fallback_group_id: group.fallback_group_id ?? '', fallback_group_id_on_invalid_request: group.fallback_group_id_on_invalid_request ?? '',
    supported_model_scopes_text: (group.supported_model_scopes || []).join('\n'),
    models_list_enabled: group.models_list_config?.enabled ?? false, models_list_text: (group.models_list_config?.models || []).join('\n'),
    messages_dispatch_json: stringifyJson(group.messages_dispatch_model_config), model_routing_json: stringifyJson(group.model_routing),
    reasoning_effort_mappings_json: stringifyJson(group.reasoning_effort_mappings, []), copy_accounts_from_group_ids: [],
    model_pricing: (group.model_pricing || []).map(pricingToDraft)
  } as GroupDraft
}

function optionalNumber(value: unknown, field: string): number | null {
  return parseNonNegative(value, field)
}

function requiredNumber(value: unknown, field: string): number {
  return parseNonNegative(value, field, false)!
}

export function groupDraftToRequest(draft: GroupDraft, editing: boolean): CreateGroupRequest | UpdateGroupRequest {
  if (!draft.name.trim()) throw new Error('分组名称不能为空')
  const configuredModels = draft.model_pricing.flatMap((entry) => splitValues(entry.modelsText))
  const modelConflict = findModelConflict(configuredModels)
  if (modelConflict) {
    throw new Error(`模型模式 ${modelConflict[0]} 与 ${modelConflict[1]} 冲突`)
  }
  const payload: CreateGroupRequest & UpdateGroupRequest = {
    name: draft.name.trim(), description: draft.description.trim() || null, platform: draft.platform,
    rate_multiplier: requiredNumber(draft.rate_multiplier, '默认倍率'), is_exclusive: draft.is_exclusive,
    status: draft.status, subscription_type: draft.subscription_type,
    daily_limit_usd: optionalNumber(draft.daily_limit_usd, '每日限额'), weekly_limit_usd: optionalNumber(draft.weekly_limit_usd, '每周限额'),
    monthly_limit_usd: optionalNumber(draft.monthly_limit_usd, '每月限额'), rpm_limit: requiredNumber(draft.rpm_limit, 'RPM 上限'),
    long_context_pricing_enabled: draft.long_context_pricing_enabled,
    model_pricing: pricingDraftsToApi(draft.model_pricing.map((entry) => ({ ...entry, platform: draft.platform }))),
    allow_image_generation: draft.allow_image_generation, allow_batch_image_generation: draft.allow_batch_image_generation,
    image_rate_independent: draft.image_rate_independent, image_rate_multiplier: requiredNumber(draft.image_rate_multiplier, '图片倍率'),
    batch_image_discount_multiplier: requiredNumber(draft.batch_image_discount_multiplier, '批量图片折扣倍率'),
    batch_image_hold_multiplier: requiredNumber(draft.batch_image_hold_multiplier, '批量图片预扣倍率'),
    image_price_1k: optionalNumber(draft.image_price_1k, '1K 图片价格'), image_price_2k: optionalNumber(draft.image_price_2k, '2K 图片价格'),
    image_price_4k: optionalNumber(draft.image_price_4k, '4K 图片价格'), video_rate_independent: draft.video_rate_independent,
    video_rate_multiplier: requiredNumber(draft.video_rate_multiplier, '视频倍率'), video_price_480p: optionalNumber(draft.video_price_480p, '480p 视频价格'),
    video_price_720p: optionalNumber(draft.video_price_720p, '720p 视频价格'), video_price_1080p: optionalNumber(draft.video_price_1080p, '1080p 视频价格'),
    video_model_prices: parseJsonValue(draft.video_model_prices_json, '视频模型覆盖价', {}),
    web_search_price_per_call: optionalNumber(draft.web_search_price_per_call, '网页搜索价格'), search_price_per_1k: optionalNumber(draft.search_price_per_1k, '搜索价格'),
    audio_realtime_price_per_min: optionalNumber(draft.audio_realtime_price_per_min, '实时音频价格'),
    audio_tts_price_per_million_chars: optionalNumber(draft.audio_tts_price_per_million_chars, 'TTS 价格'),
    audio_stt_price_per_hour: optionalNumber(draft.audio_stt_price_per_hour, 'STT 价格'), peak_rate_enabled: draft.peak_rate_enabled,
    peak_start: draft.peak_start, peak_end: draft.peak_end, peak_rate_multiplier: requiredNumber(draft.peak_rate_multiplier, '高峰倍率'),
    profit_control_enabled: draft.profit_control_enabled, profit_min_margin: requiredNumber(draft.profit_min_margin, '最低利润率'),
    profit_safety_buffer: requiredNumber(draft.profit_safety_buffer, '利润安全缓冲'), claude_code_only: draft.claude_code_only,
    fallback_group_id: optionalNumber(draft.fallback_group_id, '默认降级分组'),
    fallback_group_id_on_invalid_request: optionalNumber(draft.fallback_group_id_on_invalid_request, '无效请求降级分组'),
    mcp_xml_inject: draft.mcp_xml_inject, supported_model_scopes: splitValues(draft.supported_model_scopes_text),
    models_list_config: { enabled: draft.models_list_enabled, models: splitValues(draft.models_list_text) },
    allow_messages_dispatch: draft.allow_messages_dispatch, allow_live: draft.allow_live,
    default_mapped_model: draft.default_mapped_model.trim(),
    messages_dispatch_model_config: parseJsonValue(draft.messages_dispatch_json, 'Messages 调度映射', {}),
    model_routing_enabled: draft.model_routing_enabled,
    model_routing: parseJsonValue<Record<string, number[]> | null>(draft.model_routing_json, '模型路由', null),
    max_reasoning_effort: draft.max_reasoning_effort.trim(),
    reasoning_effort_mappings: parseJsonValue(draft.reasoning_effort_mappings_json, 'Reasoning 映射', []),
    require_oauth_only: draft.require_oauth_only, require_privacy_set: draft.require_privacy_set
  }
  if (!editing) delete payload.status
  if (!editing && draft.copy_accounts_from_group_ids.length) payload.copy_accounts_from_group_ids = [...draft.copy_accounts_from_group_ids]
  return payload
}
