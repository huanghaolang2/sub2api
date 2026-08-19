import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteFeature } from '../contracts'

const mocks = vi.hoisted(() => ({
  canUseBatchImage: { value: false },
  refreshBatchImageAccess: vi.fn(),
  adminFetch: vi.fn(),
  auth: { isAdmin: false },
  adminSettings: { opsMonitoringEnabled: false, paymentEnabled: false, fetch: vi.fn() },
}))

vi.mock('@shared-composables/useBatchImageAccess', () => ({
  useBatchImageAccess: () => ({
    canUseBatchImage: mocks.canUseBatchImage,
    refreshBatchImageAccess: mocks.refreshBatchImageAccess,
  }),
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('@/stores/adminSettings', () => ({ useAdminSettingsStore: () => mocks.adminSettings }))
vi.mock('@/utils/featureFlags', () => ({
  FeatureFlags: {
    payment: { key: 'payment_enabled' },
    riskControl: { key: 'risk_control_enabled' },
    modelPlaza: { key: 'model_plaza_enabled' },
    availableChannels: { key: 'available_channels_enabled' },
    channelMonitor: { key: 'channel_monitor_enabled' },
    affiliate: { key: 'affiliate_enabled' },
  },
  isFeatureFlagEnabled: vi.fn(() => true),
}))

describe('route feature gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canUseBatchImage.value = false
    mocks.auth.isAdmin = false
    mocks.adminSettings.paymentEnabled = false
    mocks.adminSettings.opsMonitoringEnabled = false
    mocks.refreshBatchImageAccess.mockResolvedValue(false)
    mocks.adminSettings.fetch.mockResolvedValue(undefined)
  })

  it('derives batch image access from an active eligible key and refreshes before routing', async () => {
    const { isRouteFeatureEnabled, prepareRouteFeature } = await import('../features')
    expect(isRouteFeatureEnabled(RouteFeature.BATCH_IMAGE)).toBe(false)

    await prepareRouteFeature(RouteFeature.BATCH_IMAGE)
    expect(mocks.refreshBatchImageAccess).toHaveBeenCalledWith(true)

    mocks.canUseBatchImage.value = true
    expect(isRouteFeatureEnabled(RouteFeature.BATCH_IMAGE)).toBe(true)
  })

  it('uses administrator settings as the payment and ops source of truth', async () => {
    const { isRouteFeatureEnabled, prepareRouteFeature } = await import('../features')
    mocks.auth.isAdmin = true
    await prepareRouteFeature(RouteFeature.PAYMENT)
    expect(mocks.adminSettings.fetch).toHaveBeenCalledOnce()
    expect(isRouteFeatureEnabled(RouteFeature.PAYMENT)).toBe(false)

    mocks.adminSettings.paymentEnabled = true
    expect(isRouteFeatureEnabled(RouteFeature.PAYMENT)).toBe(true)
  })
})
