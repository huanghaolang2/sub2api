import { RouteFeature } from './contracts'
import { useAdminSettingsStore } from '@/stores/adminSettings'
import { useAuthStore } from '@/stores/auth'
import { useBatchImageAccess } from '@shared-composables/useBatchImageAccess'
import {
  FeatureFlags,
  isFeatureFlagEnabled,
  type FeatureFlagDefinition
} from '@/utils/featureFlags'

const publicFeatureMap: Partial<Record<RouteFeature, FeatureFlagDefinition>> = {
  [RouteFeature.PAYMENT]: FeatureFlags.payment,
  [RouteFeature.RISK_CONTROL]: FeatureFlags.riskControl,
  [RouteFeature.MODEL_PLAZA]: FeatureFlags.modelPlaza,
  [RouteFeature.AVAILABLE_CHANNELS]: FeatureFlags.availableChannels,
  [RouteFeature.CHANNEL_MONITOR]: FeatureFlags.channelMonitor,
  [RouteFeature.AFFILIATE]: FeatureFlags.affiliate
}

export async function prepareRouteFeature(feature: RouteFeature): Promise<void> {
  const auth = useAuthStore()
  if (feature === RouteFeature.BATCH_IMAGE) {
    await useBatchImageAccess().refreshBatchImageAccess(true)
    return
  }
  if (feature === RouteFeature.OPS_MONITORING || (feature === RouteFeature.PAYMENT && auth.isAdmin)) {
    await useAdminSettingsStore().fetch()
  }
}

export function isRouteFeatureEnabled(feature: RouteFeature | undefined): boolean {
  if (!feature) return true
  if (feature === RouteFeature.BATCH_IMAGE) return useBatchImageAccess().canUseBatchImage.value
  const auth = useAuthStore()
  const adminSettings = useAdminSettingsStore()
  if (feature === RouteFeature.OPS_MONITORING) return adminSettings.opsMonitoringEnabled
  if (feature === RouteFeature.PAYMENT && auth.isAdmin) return adminSettings.paymentEnabled
  const definition = publicFeatureMap[feature]
  return definition ? isFeatureFlagEnabled(definition) : true
}
