import { describe, expect, it, vi } from 'vitest'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity, type UsageBoardResponse } from '@/api/usageBoard'
import type { UserDashboardStats } from '@/api/usage'
import { buildDashboardSections, createDashboardSnapshot, defaultDashboardSections, DashboardDataKind, DashboardKind, DashboardStage, DashboardState, resolveDashboardDependencies, type DashboardResources } from '../dashboardBoards'
const snapshot = { today: '2026-10-26', timezone: 'Asia/Taipei' }
function series(): UsageBoardResponse {
  return { granularity: UsageBoardGranularity.WEEK, timezone: snapshot.timezone, start_date: '2026-10-05', end_date: snapshot.today,
    periods: ['2026-10-19', '2026-10-26'].map(start => ({start,end:start,label:start,coverage:UsageBoardCoverage.FULL})),
    series: Array.from({length:1001},(_,i)=>({api_key_id:i+1,api_key_name:`Key ${i+1}`,points:[1000000,i+1].map((total_tokens,p)=>({period_start:p?snapshot.today:'2026-10-19',total_tokens,record_count:1,data_state:UsageBoardDataState.OBSERVED}))})),
    rows:[],pagination:{page:1,page_size:20,total:2002,pages:101} }
}
describe('dashboard definition and transformations',()=>{
  it('deduplicates actual consumers and derives priority without a second board list',()=>{
    const all=resolveDashboardDependencies(defaultDashboardSections,snapshot)
    expect(all).toHaveLength(6)
    expect(all.filter(d=>d.stage===DashboardStage.PRIORITY)).toHaveLength(2)
    expect(all.find(d=>d.kind===DashboardDataKind.SERIES&&d.query.granularity===UsageBoardGranularity.WEEK)).toMatchObject({scope:'self',query:{start_date:'2026-10-05',end_date:snapshot.today}})
    const rankings=defaultDashboardSections.filter(s=>s.kind!==DashboardKind.TREND)
    expect(resolveDashboardDependencies(rankings,snapshot).every(d=>d.stage===DashboardStage.DEFERRED)).toBe(true)
    expect(resolveDashboardDependencies([],snapshot)).toEqual([])
    expect(resolveDashboardDependencies(defaultDashboardSections.filter(s=>s.kind===DashboardKind.MODEL),snapshot)).toHaveLength(3)
    expect(resolveDashboardDependencies([...defaultDashboardSections].reverse(),snapshot).map(d=>d.key).sort()).toEqual(all.map(d=>d.key).sort())
  })
  it('uses calendar boundaries, explicit lifetime and timezone-aware UTC fallback',()=>{
    const deps=resolveDashboardDependencies(defaultDashboardSections,{today:'2026-01-01',timezone:'America/New_York'})
    const models=deps.filter(d=>d.kind===DashboardDataKind.MODELS)
    expect(models.map(d=>d.query.start_date)).toEqual(['2025-12-29','2026-01-01','0001-01-01'])
    expect(models.every(d=>d.query.end_date==='2026-01-01'&&d.query.timezone==='America/New_York')).toBe(true)
    expect(createDashboardSnapshot(new Date('2026-03-08T06:30:00Z'),'America/New_York')).toEqual({today:'2026-03-08',timezone:'America/New_York'})
    expect(createDashboardSnapshot(new Date('2026-03-08T23:30:00Z'),'Asia/Taipei').today).toBe('2026-03-09')
    expect(createDashboardSnapshot(new Date('2026-03-08T23:30:00Z'),'')).toEqual({today:'2026-03-08',timezone:'UTC'})
    expect(createDashboardSnapshot(new Date('2026-03-08T23:30:00Z'),'invalid').timezone).toBe('UTC')
  })
  it('falls back to UTC even when Intl itself throws',()=>{
    const spy=vi.spyOn(Intl,'DateTimeFormat').mockImplementation(()=>{throw new Error('unavailable')})
    try { expect(createDashboardSnapshot(new Date('2026-10-26T23:00:00Z'),'Asia/Taipei')).toEqual({today:'2026-10-26',timezone:'UTC'}) } finally { spy.mockRestore() }
  })
  it('uses full series and current bucket, recovers complete names and unused IDs',()=>{
    const all=resolveDashboardDependencies(defaultDashboardSections,snapshot)
    const dependency=all.find(d=>d.kind===DashboardDataKind.SERIES&&d.query.granularity===UsageBoardGranularity.WEEK)!
    const keys=all.find(d=>d.kind===DashboardDataKind.KEYS)!
    const resources=new Map<string,DashboardResources extends ReadonlyMap<string,infer R>?R:never>()
    resources.set(dependency.key,{dependency,state:DashboardState.READY,error:'',result:{kind:DashboardDataKind.SERIES,data:series()}})
    const token=()=>buildDashboardSections(defaultDashboardSections,snapshot,resources).find(s=>s.kind===DashboardKind.TOKEN)!
    expect(token().cards[0].items).toHaveLength(1001)
    expect(token().cards[0].items[0]).toEqual({id:'1001',name:'Key 1001',usage:1001})
    expect(token().cards[0].notice).toContain('加载中')
    resources.set(keys.key,{dependency:keys,state:DashboardState.ERROR,error:'timeout'})
    expect(token().cards[0].state).toBe(DashboardState.READY)
    expect(token().cards[0].retryTargets[0].key).toBe(keys.key)
    resources.set(keys.key,{dependency:keys,state:DashboardState.READY,error:'',result:{kind:DashboardDataKind.KEYS,data:{usage_board:{users:1,total_tokens:1,ranking:[{api_key_id:1,api_key_name:'同名 (#1)',total_tokens:1},{api_key_id:2000,api_key_name:'同名 (#2000)',total_tokens:0}]}} as UserDashboardStats}})
    expect(token().cards[0].items).toHaveLength(1002)
    expect(token().cards[0].items.find(i=>i.id==='1')?.name).toBe('同名 (#1)')
    expect(token().cards[0].items.at(-1)).toEqual({id:'2000',name:'同名 (#2000)',usage:0})
    expect(token().cards[0].notice).toBe('')
  })
  it('preserves model totals, server order and request date labels',()=>{
    const definitions=defaultDashboardSections.filter(s=>s.kind===DashboardKind.MODEL)
    const dependency=resolveDashboardDependencies(definitions,snapshot)[0]
    const models=[{model:'z',total_tokens:2_000_000},{model:'a',total_tokens:2_000_000},{model:'free',total_tokens:3_000_000,actual_cost:0}]
    const resources=new Map([[dependency.key,{dependency,state:DashboardState.READY,error:'',result:{kind:DashboardDataKind.MODELS,data:{models,start_date:'bad',end_date:'bad'}}}]]) as DashboardResources
    const result=buildDashboardSections(definitions,snapshot,resources)[0]
    if(result.kind===DashboardKind.TREND)throw new Error('expected ranking')
    expect(result.cards[0].items.map(i=>i.id)).toEqual(['z','a','free'])
    expect(result.cards[0].rangeLabel).toBe('2026-10-26 到 2026-10-26')
    expect(result.cards[1].state).toBe(DashboardState.IDLE)
  })
  it('sends distinct ranking policies even when week and month date ranges coincide',()=>{
    const dependencies=resolveDashboardDependencies(defaultDashboardSections,{today:'2026-06-01',timezone:'UTC'}).filter(d=>d.kind===DashboardDataKind.MODELS)
    expect(dependencies).toHaveLength(3)
    expect(dependencies.map(d=>d.query.ranking_period)).toEqual(['week','month','lifetime'])
    expect(new Set(dependencies.map(d=>d.key)).size).toBe(3)
    expect(dependencies[0].query.start_date).toBe(dependencies[1].query.start_date)
  })
  it('maps the server payload without browser filtering, sorting or truncation',()=>{
    const definitions=defaultDashboardSections.filter(s=>s.kind===DashboardKind.MODEL)
    // Deliberately noncanonical payload proves the mapper does not own ranking policy.
    const models=Array.from({length:12},(_,i)=>({model:`server-${i}`,total_tokens:i}))
    const dependencies=resolveDashboardDependencies(definitions,snapshot)
    const resources=new Map(dependencies.map(dependency=>[dependency.key,{dependency,state:DashboardState.READY,error:'',result:{kind:DashboardDataKind.MODELS,data:{models,start_date:'',end_date:''}}}])) as DashboardResources
    const section=buildDashboardSections(definitions,snapshot,resources)[0]
    if(section.kind===DashboardKind.TREND)throw new Error('expected models')
    for(const card of section.cards)expect(card.items).toEqual(models.map(model=>({id:model.model,name:model.model,usage:model.total_tokens})))
  })

})
