import { defineComponent, h, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDashboardBoards } from '../useDashboardBoards'
import { defaultDashboardSections, DashboardDataKind, DashboardKind, DashboardStage, DashboardState, type DashboardDependency, type DashboardDependencyResult, type DashboardSectionDefinition } from '@/components/user/dashboard/dashboardBoards'

function setup(initial: readonly DashboardSectionDefinition[] = defaultDashboardSections) {
  const definitions=ref(initial)
  const calls: {dependency: DashboardDependency; signal: AbortSignal; resolve:(r:DashboardDependencyResult)=>void; reject:(e:unknown)=>void; dom:string}[]=[]
  let board: ReturnType<typeof useDashboardBoards>
  const wrapper=mount(defineComponent({setup(){
    board=useDashboardBoards(definitions,(dependency,signal)=>new Promise((resolve,reject)=>{calls.push({dependency,signal,resolve,reject,dom:document.body.textContent||''})}))
    return()=>h('div',board.sections.value.flatMap(s=>s.cards.map(c=>h('span',`${c.title}:${c.state}`))))
  }}),{attachTo:document.body})
  const finish=(index:number)=>{
    const c=calls[index], d=c.dependency
    if(d.kind===DashboardDataKind.SERIES)c.resolve({kind:d.kind,data:{granularity:d.query.granularity,timezone:d.query.timezone,start_date:'2026-10-05',end_date:'2026-10-26',periods:[],series:[],rows:[],pagination:{page:1,page_size:20,total:0,pages:1}}})
    else if(d.kind===DashboardDataKind.MODELS)c.resolve({kind:d.kind,data:{models:[],start_date:d.query.start_date,end_date:d.query.end_date}})
    else c.resolve({kind:d.kind,data:{usage_board:{users:0,total_tokens:0,ranking:[]}} as never})
  }
  return {definitions,calls,wrapper,finish,get board(){return board!}}
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))})
afterEach(()=>{vi.useRealTimers();document.body.innerHTML=''})
describe('real dashboard dependency scheduler',()=>{
  it('publishes each priority result before starting deferred data once',async()=>{
    const s=setup();await flushPromises();expect(s.calls).toHaveLength(2)
    s.finish(0);await flushPromises();expect(s.calls).toHaveLength(2)
    expect(s.wrapper.text()).toContain('周看板趋势:ready')
    expect(s.wrapper.text()).toContain('月看板趋势:loading')
    s.finish(1);await flushPromises();expect(s.calls).toHaveLength(6)
    expect(s.calls[2].dom).toContain('月看板趋势:ready')
    expect(s.calls.filter(c=>c.dependency.kind===DashboardDataKind.SERIES)).toHaveLength(2)
    const before=s.calls.length
    s.definitions.value=[...s.definitions.value].reverse();await flushPromises();expect(s.calls).toHaveLength(before)
    s.wrapper.unmount()
  })
  it('releases after failure and retries only the failed key with deduplication',async()=>{
    const s=setup();await flushPromises();s.calls[0].reject({message:'timed out'});s.finish(1);await flushPromises()
    expect(s.calls).toHaveLength(6)
    expect(s.board.sections.value[0].cards[0].error).toBe('timed out')
    const key=s.calls[0].dependency.key
    const a=s.board.retry(key), b=s.board.retry(key)
    expect(a).toBe(b);await flushPromises();expect(s.calls).toHaveLength(7)
    s.finish(6);await a;await flushPromises();expect(s.calls).toHaveLength(7)
    expect(s.board.sections.value[0].cards[0].state).toBe(DashboardState.READY)
    await s.board.retry('unknown');expect(s.calls).toHaveLength(7)
    s.wrapper.unmount()
  })
  it('loads deferred consumers when no priority panels exist, including newly added panels',async()=>{
    const token=defaultDashboardSections.filter(s=>s.kind===DashboardKind.TOKEN)
    const s=setup(token);await flushPromises();expect(s.calls).toHaveLength(3)
    expect(s.calls.every(c=>c.dependency.stage===DashboardStage.DEFERRED)).toBe(true)
    s.definitions.value=defaultDashboardSections.filter(s=>s.kind!==DashboardKind.TREND)
    await flushPromises();expect(s.calls).toHaveLength(6)
    s.wrapper.unmount()
  })
  it('cancels removed requests and ignores late responses without restarting retained requests',async()=>{
    const s=setup();await flushPromises()
    s.definitions.value=defaultDashboardSections.filter(s=>s.kind===DashboardKind.MODEL)
    await flushPromises();expect(s.calls.slice(0,2).every(c=>c.signal.aborted)).toBe(true)
    expect(s.calls).toHaveLength(5)
    s.finish(0);s.finish(1);await flushPromises();expect(s.calls).toHaveLength(5)
    expect(s.board.sections.value).toHaveLength(1)
    s.wrapper.unmount()
  })
  it('unmounts before priority resolution and never starts deferred requests',async()=>{
    const s=setup();await flushPromises();s.wrapper.unmount()
    expect(s.calls.every(c=>c.signal.aborted)).toBe(true)
    s.finish(0);s.finish(1);await flushPromises();expect(s.calls).toHaveLength(2)
  })
  it('keeps the original calendar snapshot across midnight and retry',async()=>{
    const s=setup();await flushPromises();vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
    s.finish(0);s.finish(1);await flushPromises()
    const model=s.calls.find(c=>c.dependency.kind===DashboardDataKind.MODELS)!
    if(model.dependency.kind!==DashboardDataKind.MODELS)throw new Error('model required')
    expect(model.dependency.query.end_date).toBe('2026-10-26')
    model.reject(new Error('failed'));await flushPromises();void s.board.retry(model.dependency.key);await flushPromises()
    expect(s.calls.at(-1)?.dependency).toEqual(model.dependency)
    s.wrapper.unmount()
  })
  it('does not release a stale phase when definitions change during the rendering boundary',async()=>{
    const s=setup();await flushPromises();s.finish(0);s.finish(1)
    s.definitions.value=[];await nextTick();await flushPromises();expect(s.calls).toHaveLength(2)
    s.wrapper.unmount()
  })
})
