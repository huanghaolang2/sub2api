import { UsageRankingPeriod as DashboardPeriod, type ModelStatsResponse, type UserDashboardStats } from '@/api/usage'
export { UsageRankingPeriod as DashboardPeriod } from '@/api/usage'
import { UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder, type UsageBoardQuery, type UsageBoardResponse } from '@/api/usageBoard'
import { buildDashboardTrend, dashboardTrendRange, summarizeUsageBoardPeriod, type DashboardTrendPoint } from './dashboardTrends'

export enum DashboardKind { TREND = 'trend', TOKEN = 'token', MODEL = 'model' }
export enum DashboardStage { PRIORITY = 'priority', DEFERRED = 'deferred' }
export enum DashboardState { IDLE = 'idle', LOADING = 'loading', READY = 'ready', ERROR = 'error' }
export enum DashboardDataKind { SERIES = 'series', KEYS = 'keys', MODELS = 'models' }
export enum DashboardDependencyRole { PRIMARY = 'primary', ENRICHMENT = 'enrichment' }
export type DashboardDependencyDefinition =
  | { kind: DashboardDataKind.SERIES; period: DashboardPeriod.WEEK | DashboardPeriod.MONTH; periodCount: number }
  | { kind: DashboardDataKind.KEYS }
  | { kind: DashboardDataKind.MODELS; period: DashboardPeriod }
export interface DashboardCardDefinition {
  id: string; title: string; caption: string; period: DashboardPeriod; stage: DashboardStage
  dependencies: readonly { role: DashboardDependencyRole; definition: DashboardDependencyDefinition }[]
}
export interface DashboardSectionDefinition {
  id: string; title: string; description: string; kind: DashboardKind; cards: readonly DashboardCardDefinition[]
}
export interface DashboardSnapshot { today: string; timezone: string }
export interface DashboardModelQuery { ranking_period: DashboardPeriod; start_date: string; end_date: string; timezone: string; model_source: 'requested' }
export type DashboardDependency = { key: string; stage: DashboardStage } & (
  | { kind: DashboardDataKind.SERIES; scope: UsageBoardScope.SELF; query: UsageBoardQuery }
  | { kind: DashboardDataKind.KEYS }
  | { kind: DashboardDataKind.MODELS; query: DashboardModelQuery }
)
export type DashboardDependencyResult =
  | { kind: DashboardDataKind.SERIES; data: UsageBoardResponse }
  | { kind: DashboardDataKind.KEYS; data: UserDashboardStats }
  | { kind: DashboardDataKind.MODELS; data: ModelStatsResponse }
export type DashboardDependencyLoader = (dependency: DashboardDependency, signal: AbortSignal) => Promise<DashboardDependencyResult>
export interface DashboardResource { dependency: DashboardDependency; state: DashboardState; error: string; result?: DashboardDependencyResult }
export type DashboardResources = ReadonlyMap<string, DashboardResource>
export interface DashboardRetryTarget { key: string; label: string }
export interface DashboardRankingItem { id: string; name: string; usage: number }
interface DashboardCardModel {
  id: string; title: string; caption: string; rangeLabel: string; state: DashboardState; error: string; retryTargets: DashboardRetryTarget[]
}
export interface DashboardTrendCardModel extends DashboardCardModel { points: DashboardTrendPoint[] }
export interface DashboardRankingCardModel extends DashboardCardModel { notice: string; items: DashboardRankingItem[] }
interface DashboardSectionBase { id: string; title: string; description: string }
export interface DashboardTrendSectionModel extends DashboardSectionBase { kind: DashboardKind.TREND; cards: DashboardTrendCardModel[] }
export interface DashboardRankingSectionModel extends DashboardSectionBase { kind: DashboardKind.TOKEN | DashboardKind.MODEL; cards: DashboardRankingCardModel[] }
export type DashboardSectionModel = DashboardTrendSectionModel | DashboardRankingSectionModel

const week: DashboardDependencyDefinition = { kind: DashboardDataKind.SERIES, period: DashboardPeriod.WEEK, periodCount: 4 }
const month: DashboardDependencyDefinition = { kind: DashboardDataKind.SERIES, period: DashboardPeriod.MONTH, periodCount: 3 }
const keys: DashboardDependencyDefinition = { kind: DashboardDataKind.KEYS }
const primary = (definition: DashboardDependencyDefinition) => ({ role: DashboardDependencyRole.PRIMARY, definition })
const enrichment = { role: DashboardDependencyRole.ENRICHMENT, definition: keys }
export const defaultDashboardSections: readonly DashboardSectionDefinition[] = [
  { id: 'dashboard-trends', title: '使用趋势', description: '按自然周期观察使用人数与 Token 变化，悬浮数据点可查看具体日期。', kind: DashboardKind.TREND, cards: [
    { id: 'weekly-trend', title: '周看板趋势', caption: '最近 4 个自然周', period: DashboardPeriod.WEEK, stage: DashboardStage.PRIORITY, dependencies: [primary(week)] },
    { id: 'monthly-trend', title: '月看板趋势', caption: '最近 3 个自然月', period: DashboardPeriod.MONTH, stage: DashboardStage.PRIORITY, dependencies: [primary(month)] }
  ] },
  { id: 'dashboard-ranking', title: 'Token 用量排行', description: '按当周、当月与所有时间对照 API Key 的 Token 使用量。', kind: DashboardKind.TOKEN, cards: [
    { id: 'weekly-tokens', title: '当周使用 Top', caption: '', period: DashboardPeriod.WEEK, stage: DashboardStage.DEFERRED, dependencies: [primary(week), enrichment] },
    { id: 'monthly-tokens', title: '当月使用 Top', caption: '', period: DashboardPeriod.MONTH, stage: DashboardStage.DEFERRED, dependencies: [primary(month), enrichment] },
    { id: 'lifetime-tokens', title: '累计看板 Top', caption: '', period: DashboardPeriod.LIFETIME, stage: DashboardStage.DEFERRED, dependencies: [primary(keys)] }
  ] },
  { id: 'dashboard-models', title: '模型看板', description: '当周超过100万、当月和累计超过1亿 Tokens 的模型，各展示前10名。', kind: DashboardKind.MODEL, cards: [
    { id: 'weekly-models', title: '当周使用 Top', caption: '', period: DashboardPeriod.WEEK, stage: DashboardStage.DEFERRED, dependencies: [primary({ kind: DashboardDataKind.MODELS, period: DashboardPeriod.WEEK })] },
    { id: 'monthly-models', title: '当月使用 Top', caption: '', period: DashboardPeriod.MONTH, stage: DashboardStage.DEFERRED, dependencies: [primary({ kind: DashboardDataKind.MODELS, period: DashboardPeriod.MONTH })] },
    { id: 'lifetime-models', title: '累计使用 Top', caption: '', period: DashboardPeriod.LIFETIME, stage: DashboardStage.DEFERRED, dependencies: [primary({ kind: DashboardDataKind.MODELS, period: DashboardPeriod.LIFETIME })] }
  ] }
]

export function createDashboardSnapshot(now: Date, timezone: string): DashboardSnapshot {
  const zone = timezone || 'UTC'
  let parts: Intl.DateTimeFormatPart[]
  try { parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now) }
  catch { return { today: now.toISOString().slice(0, 10), timezone: 'UTC' } }
  const part = (key: string) => parts.find((item) => item.type === key)?.value || ''
  return { today: `${part('year')}-${part('month')}-${part('day')}`, timezone: zone }
}
function calendarDate(snapshot: DashboardSnapshot): Date {
  const [year, month, day] = snapshot.today.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}
function periodStart(period: DashboardPeriod, snapshot: DashboardSnapshot): string {
  if (period === DashboardPeriod.LIFETIME) return '0001-01-01'
  if (period === DashboardPeriod.MONTH) return `${snapshot.today.slice(0, 7)}-01`
  return dashboardTrendRange('week', calendarDate(snapshot), 1).startDate!
}
function resolveDependency(definition: DashboardDependencyDefinition, snapshot: DashboardSnapshot, stage: DashboardStage): DashboardDependency {
  if (definition.kind === DashboardDataKind.KEYS) return { key: DashboardDataKind.KEYS, kind: definition.kind, stage }
  if (definition.kind === DashboardDataKind.MODELS) {
    const query: DashboardModelQuery = { ranking_period: definition.period, start_date: periodStart(definition.period, snapshot), end_date: snapshot.today, timezone: snapshot.timezone, model_source: 'requested' }
    return { key: JSON.stringify([definition.kind, query]), kind: definition.kind, query, stage }
  }
  const range = dashboardTrendRange(definition.period, calendarDate(snapshot), definition.periodCount)
  const query: UsageBoardQuery = {
    granularity: definition.period === DashboardPeriod.WEEK ? UsageBoardGranularity.WEEK : UsageBoardGranularity.MONTH,
    ...(definition.period === DashboardPeriod.WEEK ? { start_date: range.startDate, end_date: range.endDate } : { start_month: range.startMonth, end_month: range.endMonth }),
    timezone: snapshot.timezone, api_key_ids: [], group_ids: [], sort_order: UsageBoardSortOrder.DESC, page: 1, page_size: 20
  }
  return { key: JSON.stringify([definition.kind, UsageBoardScope.SELF, query]), kind: definition.kind, scope: UsageBoardScope.SELF, query, stage }
}
export function resolveDashboardDependencies(definitions: readonly DashboardSectionDefinition[], snapshot: DashboardSnapshot): DashboardDependency[] {
  const dependencies = new Map<string, DashboardDependency>()
  for (const section of definitions) for (const card of section.cards) for (const item of card.dependencies) {
    const dependency = resolveDependency(item.definition, snapshot, card.stage)
    const previous = dependencies.get(dependency.key)
    if (!previous || dependency.stage === DashboardStage.PRIORITY) dependencies.set(dependency.key, dependency)
  }
  return [...dependencies.values()]
}
export function buildDashboardSections(definitions: readonly DashboardSectionDefinition[], snapshot: DashboardSnapshot, resources: DashboardResources): DashboardSectionModel[] {
  return definitions.map((section): DashboardSectionModel => {
    const cards = section.cards.map((card) => {
      const bindings = card.dependencies.map((item) => ({ ...item, dependency: resolveDependency(item.definition, snapshot, card.stage) }))
      const main = bindings.find((item) => item.role === DashboardDependencyRole.PRIMARY)!
      const resource = resources.get(main.dependency.key)
      const state = resource?.state ?? DashboardState.IDLE
      const error = resource?.error ?? ''
      const retryTargets: DashboardRetryTarget[] = state === DashboardState.ERROR ? [{ key: main.dependency.key, label: '重试' }] : []
      const base = { id: card.id, title: card.title, caption: card.caption, rangeLabel: card.period === DashboardPeriod.LIFETIME ? '所有时间' : `${periodStart(card.period, snapshot)} 到 ${snapshot.today}`, state, error, retryTargets }
      if (section.kind === DashboardKind.TREND) {
        const data = resource?.result?.kind === DashboardDataKind.SERIES ? resource.result.data : undefined
        const points = data && card.period !== DashboardPeriod.LIFETIME ? buildDashboardTrend(data, card.period).points : []
        return { ...base, rangeLabel: points.length ? `${points[0].start} 到 ${points[points.length - 1].end}` : '', points }
      }
      let notice = ''
      let items: DashboardRankingItem[] = []
      if (resource?.result?.kind === DashboardDataKind.SERIES) {
        const supplement = bindings.find((item) => item.role === DashboardDependencyRole.ENRICHMENT)
        const names = supplement && resources.get(supplement.dependency.key)
        const allKeys = names?.result?.kind === DashboardDataKind.KEYS ? names.result.data.usage_board?.ranking : undefined
        if (!allKeys) {
          notice = names?.state === DashboardState.ERROR ? '完整密钥名单暂不可用，当前仅显示查询区间内的密钥。' : '完整密钥名单加载中，暂显示查询区间内的密钥。'
          if (names?.state === DashboardState.ERROR && supplement) retryTargets.push({ key: supplement.dependency.key, label: '重试完整名单' })
        }
        const data = resource.result.data
        const start = periodStart(card.period, snapshot)
        const index = data.periods.findIndex((period) => period.start === start)
        items = summarizeUsageBoardPeriod(data, index, allKeys).ranking
      } else if (resource?.result?.kind === DashboardDataKind.KEYS) {
        items = (resource.result.data.usage_board?.ranking ?? []).map((item) => ({ id: String(item.api_key_id), name: item.api_key_name, usage: item.total_tokens }))
      } else if (resource?.result?.kind === DashboardDataKind.MODELS) {
        items = resource.result.data.models.map((model) => ({ id: model.model, name: model.model, usage: model.total_tokens }))
      }
      return { ...base, notice, items }
    })
    if (section.kind === DashboardKind.TREND) return { ...section, kind: section.kind, cards: cards as DashboardTrendCardModel[] }
    return { ...section, kind: section.kind, cards: cards as DashboardRankingCardModel[] }
  })
}
