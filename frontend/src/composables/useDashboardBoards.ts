import { computed, nextTick, onBeforeUnmount, onMounted, reactive, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  buildDashboardSections, createDashboardSnapshot, DashboardStage, DashboardState, resolveDashboardDependencies,
  type DashboardDependency, type DashboardDependencyLoader, type DashboardResource, type DashboardSectionDefinition
} from '@/components/user/dashboard/dashboardBoards'

export function useDashboardBoards(definitions: MaybeRefOrGetter<readonly DashboardSectionDefinition[]>, loader: DashboardDependencyLoader) {
  let timezone = 'UTC'
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { /* UTC is the fallback. */ }
  const snapshot = createDashboardSnapshot(new Date(), timezone)
  const resources = reactive(new Map<string, DashboardResource>())
  const resolved = computed(() => resolveDashboardDependencies(toValue(definitions), snapshot))
  const sections = computed(() => buildDashboardSections(toValue(definitions), snapshot, resources))
  type Request = { controller: AbortController; promise: Promise<void> }
  const requests = new Map<string, Request>()
  let dependencies = new Map<string, DashboardDependency>()
  let active = false
  let graphVersion = 0
  let releasedVersion = -1
  let signature = ''

  const pendingPriority = () => [...dependencies.values()].some(dependency => dependency.stage === DashboardStage.PRIORITY &&
    [DashboardState.IDLE, DashboardState.LOADING].includes(resources.get(dependency.key)?.state ?? DashboardState.IDLE))

  async function advance(version: number): Promise<void> {
    if (!active || version !== graphVersion || releasedVersion === version || pendingPriority()) return
    await nextTick()
    if (!active || version !== graphVersion || releasedVersion === version || pendingPriority()) return
    releasedVersion = version
    for (const dependency of dependencies.values()) {
      if (dependency.stage === DashboardStage.DEFERRED && resources.get(dependency.key)?.state === DashboardState.IDLE) void start(dependency)
    }
  }

  function start(dependency: DashboardDependency): Promise<void> {
    const existing = requests.get(dependency.key)
    if (existing) return existing.promise
    const resource = resources.get(dependency.key)
    if (!active || !resource || !dependencies.has(dependency.key)) return Promise.resolve()
    resource.state = DashboardState.LOADING
    resource.error = ''
    resource.result = undefined
    const request: Request = { controller: new AbortController(), promise: Promise.resolve() }
    requests.set(dependency.key, request)
    const current = () => active && !request.controller.signal.aborted && requests.get(dependency.key) === request && dependencies.has(dependency.key)
    request.promise = Promise.resolve().then(async () => {
      if (!current()) return
      try {
        const result = await loader(dependency, request.controller.signal)
        if (!current()) return
        resource.result = result
        resource.state = DashboardState.READY
      } catch (error) {
        if (!current()) return
        const message = error && typeof error === 'object' && 'message' in error ? String(error.message || '') : ''
        resource.error = message || '看板数据加载失败，请重试'
        resource.state = DashboardState.ERROR
      } finally {
        if (requests.get(dependency.key) === request) requests.delete(dependency.key)
        if (active) void advance(graphVersion)
      }
    })
    return request.promise
  }

  function reconcile(): void {
    if (!active) return
    const next = resolved.value
    const nextSignature = JSON.stringify(next.map(dependency => [dependency.key, dependency.stage]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    if (nextSignature === signature) return
    signature = nextSignature
    const version = ++graphVersion
    dependencies = new Map(next.map(dependency => [dependency.key, dependency]))
    for (const [key] of resources) {
      if (!dependencies.has(key)) {
        requests.get(key)?.controller.abort()
        requests.delete(key)
        resources.delete(key)
      }
    }
    for (const dependency of next) {
      const resource = resources.get(dependency.key)
      if (resource) resource.dependency = dependency
      else resources.set(dependency.key, { dependency, state: DashboardState.IDLE, error: '' })
    }
    for (const dependency of next) {
      if (dependency.stage === DashboardStage.PRIORITY && resources.get(dependency.key)?.state === DashboardState.IDLE) void start(dependency)
    }
    void advance(version)
  }

  function retry(key: string): Promise<void> {
    if (!active || !dependencies.has(key)) return Promise.resolve()
    const resource = resources.get(key)
    if (resource?.state === DashboardState.LOADING) return requests.get(key)?.promise ?? Promise.resolve()
    if (resource?.state !== DashboardState.ERROR) return Promise.resolve()
    return start(dependencies.get(key)!)
  }

  watch(resolved, reconcile, { flush: 'sync' })
  onMounted(() => { active = true; reconcile() })
  onBeforeUnmount(() => {
    active = false
    graphVersion++
    for (const request of requests.values()) request.controller.abort()
    requests.clear()
  })
  return { sections, retry }
}
