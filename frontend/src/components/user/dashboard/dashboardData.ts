import { getDashboardModels, getDashboardStats } from '@/api/usage'
import { getUsageBoard } from '@/api/usageBoard'
import { RequestTimezonePolicy } from '@/api/client'
import { DashboardDataKind, type DashboardDependencyLoader } from './dashboardBoards'

export const loadDashboardDependency: DashboardDependencyLoader = async (dependency, signal) => {
  switch (dependency.kind) {
    case DashboardDataKind.SERIES:
      return { kind: dependency.kind, data: await getUsageBoard(dependency.scope, dependency.query, signal) }
    case DashboardDataKind.KEYS:
      return { kind: dependency.kind, data: await getDashboardStats({ signal }) }
    case DashboardDataKind.MODELS:
      return {
        kind: dependency.kind,
        data: await getDashboardModels(dependency.query, { signal, timezonePolicy: RequestTimezonePolicy.EXPLICIT })
      }
  }
}
