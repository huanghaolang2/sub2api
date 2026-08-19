import type {
  UserAvailableChannel,
  UserAvailableGroup,
  UserChannelPlatformSection,
  UserSupportedModel
} from '@shared-api/channels'

export enum ChannelAccessFilter {
  ALL = 'all',
  EXCLUSIVE = 'exclusive',
  PUBLIC = 'public'
}

export interface AvailableChannelSummary {
  channels: number
  platforms: number
  groups: number
  models: number
}

function sectionMatchesAccess(section: UserChannelPlatformSection, access: ChannelAccessFilter): boolean {
  if (access === ChannelAccessFilter.ALL) return true
  return section.groups.some((group) => access === ChannelAccessFilter.EXCLUSIVE ? group.is_exclusive : !group.is_exclusive)
}

export function filterAvailableChannels(
  channels: UserAvailableChannel[],
  query: string,
  platform: string,
  access: ChannelAccessFilter
): UserAvailableChannel[] {
  const normalized = query.trim().toLowerCase()
  return channels
    .map((channel) => {
      const platformSections = channel.platforms.filter((section) =>
        (platform === 'all' || section.platform === platform) && sectionMatchesAccess(section, access)
      )
      if (!normalized) return platformSections.length ? { ...channel, platforms: platformSections } : null

      const channelHit = channel.name.toLowerCase().includes(normalized) || channel.description.toLowerCase().includes(normalized)
      if (channelHit) return platformSections.length ? { ...channel, platforms: platformSections } : null

      const matchingSections = platformSections.filter((section) =>
        section.platform.toLowerCase().includes(normalized) ||
        section.groups.some((group) => group.name.toLowerCase().includes(normalized)) ||
        section.supported_models.some((model) => model.name.toLowerCase().includes(normalized))
      )
      return matchingSections.length ? { ...channel, platforms: matchingSections } : null
    })
    .filter((channel): channel is UserAvailableChannel => channel !== null)
}

export function summarizeAvailableChannels(channels: UserAvailableChannel[]): AvailableChannelSummary {
  const platforms = new Set<string>()
  const groups = new Set<number>()
  const models = new Set<string>()
  for (const channel of channels) {
    for (const section of channel.platforms) {
      platforms.add(section.platform)
      section.groups.forEach((group) => groups.add(group.id))
      section.supported_models.forEach((model) => models.add(`${model.platform}:${model.name}`))
    }
  }
  return { channels: channels.length, platforms: platforms.size, groups: groups.size, models: models.size }
}

export function effectiveGroupRate(group: UserAvailableGroup, rates: Record<number, number>): number {
  const custom = rates[group.id]
  return Number.isFinite(custom) ? custom : group.rate_multiplier
}

export function splitGroups(section: UserChannelPlatformSection): {
  exclusive: UserAvailableGroup[]
  public: UserAvailableGroup[]
} {
  return {
    exclusive: section.groups.filter((group) => group.is_exclusive),
    public: section.groups.filter((group) => !group.is_exclusive)
  }
}

export function modelRateRange(
  model: UserSupportedModel,
  section: UserChannelPlatformSection,
  rates: Record<number, number>
): string {
  if (!model.pricing || section.groups.length === 0) return '基准价'
  const values = [...new Set(section.groups.map((group) => effectiveGroupRate(group, rates)))].sort((left, right) => left - right)
  if (values.length === 1) return `${values[0]}× 生效`
  return `${values[0]}–${values[values.length - 1]}× 生效`
}

export function formatPeakWindow(group: UserAvailableGroup): string {
  if (!group.peak_rate_enabled) return ''
  return `${group.peak_start || '00:00'}–${group.peak_end || '00:00'} · ${group.peak_rate_multiplier}×`
}
