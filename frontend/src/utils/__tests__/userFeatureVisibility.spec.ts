import { describe, expect, it } from 'vitest'

import {
  isUserFeatureRouteAvailable,
  isUserFeatureVisible,
  resolveUserFeatureVisibility,
  userFeatureForRoute,
  UserFeature,
  UserFeatureVisibility,
} from '@/utils/userFeatureVisibility'

describe('user feature visibility', () => {
  it('defaults missing or invalid values to hidden', () => {
    expect(resolveUserFeatureVisibility(undefined)).toBe(UserFeatureVisibility.HIDDEN)
    expect(resolveUserFeatureVisibility('invalid')).toBe(UserFeatureVisibility.HIDDEN)
  })

  it('accepts the visible switch value', () => {
    expect(resolveUserFeatureVisibility(' visible ')).toBe(UserFeatureVisibility.VISIBLE)
  })

  it.each(Object.values(UserFeature))('applies the switch to %s', (feature) => {
    expect(isUserFeatureVisible(feature, UserFeatureVisibility.HIDDEN)).toBe(false)
    expect(isUserFeatureVisible(feature, UserFeatureVisibility.VISIBLE)).toBe(true)
  })

  it.each([
    ['/monitor', UserFeature.CHANNEL_STATUS],
    ['/monitor/detail', UserFeature.CHANNEL_STATUS],
    ['/subscriptions', UserFeature.SUBSCRIPTIONS],
    ['/redeem', UserFeature.REDEEM],
    ['/profile', UserFeature.PROFILE],
  ])('maps %s to %s', (path, feature) => {
    expect(userFeatureForRoute(path)).toBe(feature)
    expect(isUserFeatureRouteAvailable(path, UserFeatureVisibility.HIDDEN)).toBe(false)
    expect(isUserFeatureRouteAvailable(path, UserFeatureVisibility.VISIBLE)).toBe(true)
  })

  it.each(['/dashboard', '/keys', '/admin/subscriptions', '/admin/redeem', '/admin/channels/monitor'])(
    'does not restrict unrelated route %s',
    (path) => {
      expect(userFeatureForRoute(path)).toBeNull()
      expect(isUserFeatureRouteAvailable(path, UserFeatureVisibility.HIDDEN)).toBe(true)
    },
  )
})
