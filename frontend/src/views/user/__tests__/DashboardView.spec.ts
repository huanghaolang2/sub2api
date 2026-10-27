import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import DashboardView from '../DashboardView.vue'
vi.mock('@/i18n',()=>({getLocale:()=> 'zh-CN'}))
vi.mock('@/components/layout/AppLayout.vue',()=>({default:{template:'<main><slot /></main>'}}))
const original=apiClient.defaults.adapter
let calls: {url:URL; config:InternalAxiosRequestConfig; resolve:(data:unknown)=>void; reject:(e:unknown)=>void}[]
beforeEach(()=>{
  calls=[];localStorage.clear();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
  apiClient.defaults.adapter=((config)=>new Promise((resolve,reject)=>{
    calls.push({url:new URL(apiClient.getUri(config),'http://local.test'),config,resolve:(data)=>resolve({status:200,data:data && typeof data==='object' && 'code' in data ? data : {code:0,data},headers:{},config,statusText:'OK'}),reject})
  })) as AxiosAdapter
})
afterEach(()=>{apiClient.defaults.adapter=original;vi.useRealTimers()})
function render(){return mount(DashboardView,{global:{stubs:{AppLayout:{template:'<main><slot /></main>'}}}})}
function board(index:number){
  const c=calls[index], monthly=c.url.searchParams.get('granularity')==='month'
  const start=monthly?'2026-10-01':'2026-10-26'
  c.resolve({granularity:monthly?'month':'week',timezone:'UTC',start_date:start,end_date:'2026-10-26',periods:[{start,end:'2026-10-26',label:start,coverage:'partial'}],series:[{api_key_id:1,api_key_name:'共享',points:[{period_start:start,total_tokens:123,record_count:1,data_state:'observed'}]}],rows:[],pagination:{page:1,page_size:20,total:1,pages:1}})
}
const stats={usage_board:{users:1,total_tokens:123,ranking:[{api_key_id:1,api_key_name:'共享 (#1)',total_tokens:123},{api_key_id:2,api_key_name:'共享 (#2)',total_tokens:0}]}}
describe('real user dashboard integration',()=>{
  it('renders structure immediately, publishes one trend and only then loads independent deferred boards',async()=>{
    const wrapper=render()
    expect(wrapper.findAll('h2').map(h=>h.text())).toEqual(['使用趋势','Token 用量排行','模型看板'])
    await flushPromises();expect(calls).toHaveLength(2)
    expect(calls.every(c=>c.url.pathname==='/api/v1/usage/board')).toBe(true)
    board(0);await flushPromises()
    expect(wrapper.findAll('.dashboard-trend-plot')).toHaveLength(2)
    expect(wrapper.findAll('.dashboard-trend-loading')).toHaveLength(1)
    expect(calls).toHaveLength(2)
    board(1);await flushPromises();expect(calls).toHaveLength(6)
    expect(calls.filter(c=>c.url.pathname.endsWith('/models')).map(c=>c.url.searchParams.get('ranking_period'))).toEqual(['week','month','lifetime'])
    const key=calls.find(c=>c.url.pathname.endsWith('/stats'))!;key.resolve(stats)
    for(const c of calls.filter(c=>c.url.pathname.endsWith('/models')))c.resolve({models:[{model:'free-model',total_tokens:300_000_000,actual_cost:0}],start_date:'ignored',end_date:'ignored'})
    await flushPromises()
    expect(wrapper.get('.dashboard-user-stats').text()).toContain('共享 (#2)')
    expect(wrapper.get('.dashboard-models').findAll('li')).toHaveLength(3)
    expect(wrapper.get('.dashboard-models').text()).toContain('free-model')
    expect(calls.find(c=>c.url.searchParams.get('start_date')==='0001-01-01')).toBeDefined()
    expect(calls.some(c=>c.url.pathname.includes('/auth'))).toBe(false)
    wrapper.unmount()
  })
  it('preserves successful rankings, retries the failed complete-name dependency, and isolates model errors',async()=>{
    const wrapper=render();await flushPromises();board(0);board(1);await flushPromises()
    const key=calls.find(c=>c.url.pathname.endsWith('/stats'))!;key.resolve({code:500,message:'完整名单失败'})
    const models=calls.filter(c=>c.url.pathname.endsWith('/models'))
    models[0].resolve({code:500,message:'模型服务繁忙'})
    models[1].resolve({models:[],start_date:'2026-10-01',end_date:'2026-10-26'})
    models[2].resolve({models:[{model:'historical-model',total_tokens:400_000_000}],start_date:'0001-01-01',end_date:'2026-10-26'})
    await flushPromises()
    expect(wrapper.get('.dashboard-user-stats').text()).toContain('完整密钥名单暂不可用')
    expect(wrapper.get('.dashboard-user-stats').findAll('li')).toHaveLength(2)
    expect(wrapper.get('.dashboard-models').text()).toContain('模型服务繁忙')
    expect(wrapper.get('.dashboard-models').text()).toContain('historical-model')
    const retry=wrapper.get('.dashboard-user-stats').findAll('button').find(b=>b.text()==='重试完整名单')!
    await retry.trigger('click');await flushPromises();expect(calls).toHaveLength(7)
    calls[6].resolve(stats);await flushPromises()
    expect(wrapper.get('.dashboard-user-stats').text()).not.toContain('暂不可用')
    expect(wrapper.get('.dashboard-user-stats').findAll('li')).toHaveLength(6)
    expect(wrapper.get('.dashboard-user-stats').text()).toContain('共享 (#2)')
    wrapper.unmount()
  })
  it('aborts initial HTTP requests and does not start model requests after page exit',async()=>{
    const wrapper=render();await flushPromises();wrapper.unmount()
    expect(calls.every(c=>c.config.signal?.aborted)).toBe(true)
    board(0);board(1);await flushPromises();expect(calls).toHaveLength(2)
  })
})
