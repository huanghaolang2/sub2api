export enum UserFeatureVisibility {
  HIDDEN = 'hidden',
  VISIBLE = 'visible',
}

export enum UserFeature {
  CHANNEL_STATUS = 'channel_status',
  SUBSCRIPTIONS = 'subscriptions',
  REDEEM = 'redeem',
  PROFILE = 'profile',
}

const USER_FEATURE_ROUTE_PREFIXES: Record<UserFeature, readonly string[]> = {
  [UserFeature.CHANNEL_STATUS]: ['/monitor'],
  [UserFeature.SUBSCRIPTIONS]: ['/subscriptions'],
  [UserFeature.REDEEM]: ['/redeem'],
  [UserFeature.PROFILE]: ['/profile'],
}

const SWITCH_CONTROLLED_FEATURES = new Set<UserFeature>([
  UserFeature.CHANNEL_STATUS,
  UserFeature.SUBSCRIPTIONS,
  UserFeature.REDEEM,
  UserFeature.PROFILE,
])

/**
 * Optional user features are hidden by default for this frontend build.
 * Set VITE_USER_FEATURE_VISIBILITY=visible and rebuild to restore them.
 */
export function resolveUserFeatureVisibility(
  raw: unknown = import.meta.env.VITE_USER_FEATURE_VISIBILITY,
): UserFeatureVisibility {
  return String(raw ?? '').trim().toLowerCase() === UserFeatureVisibility.VISIBLE
    ? UserFeatureVisibility.VISIBLE
    : UserFeatureVisibility.HIDDEN
}

export function isUserFeatureVisible(
  feature: UserFeature,
  visibility: UserFeatureVisibility = resolveUserFeatureVisibility(),
): boolean {
  return visibility === UserFeatureVisibility.VISIBLE || !SWITCH_CONTROLLED_FEATURES.has(feature)
}

export function userFeatureForRoute(path: string): UserFeature | null {
  for (const [feature, prefixes] of Object.entries(USER_FEATURE_ROUTE_PREFIXES) as Array<
    [UserFeature, readonly string[]]
  >) {
    if (prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return feature
    }
  }
  return null
}

export function isUserFeatureRouteAvailable(
  path: string,
  visibility: UserFeatureVisibility = resolveUserFeatureVisibility(),
): boolean {
  const feature = userFeatureForRoute(path)
  return feature === null || isUserFeatureVisible(feature, visibility)
}
