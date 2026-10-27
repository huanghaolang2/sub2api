import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UserDashboardStats from '../UserDashboardStats.vue'
import { buildDashboardSections, defaultDashboardSections, DashboardKind, DashboardState, type DashboardRankingSectionModel } from '../dashboardBoards'
function section(): DashboardRankingSectionModel {
  const result=buildDashboardSections(defaultDashboardSections,{today:'2026-10-26',timezone:'Asia/Taipei'},new Map()).find(s=>s.kind===DashboardKind.TOKEN)!
  return {...result,cards:result.cards.map((card,index)=>({...card,state:DashboardState.READY,items:[{id:'1',name:'累计文案',usage:index===2?987000000:0}]}))}
}
describe('UserDashboardStats',()=>{
  it('uses the shared real ranking module and preserves three Token titles and formatting',()=>{
    const wrapper=mount(UserDashboardStats,{props:{section:section()}})
    expect(wrapper.get('#dashboard-ranking-title').text()).toBe('Token 用量排行')
    expect(wrapper.findAll('h3').map(h=>h.text())).toEqual(['当周使用 Top','当月使用 Top','累计看板 Top'])
    expect(wrapper.findAll('.dashboard-ranking-viewport')).toHaveLength(3)
    expect(wrapper.findAll('li')[0].get('b').text()).toBe('0 Tokens')
    expect(wrapper.findAll('li')[2].get('b').text()).toBe('9.87 亿 Tokens')
    expect(wrapper.find('.dashboard-period-metric').exists()).toBe(false)
    wrapper.unmount()
  })
  it('forwards supplement retry while successful rankings remain rendered',async()=>{
    const value=section()
    value.cards[0].notice='完整密钥名单暂不可用'
    value.cards[0].retryTargets=[{key:'keys',label:'重试完整名单'}]
    const wrapper=mount(UserDashboardStats,{props:{section:value}})
    expect(wrapper.findAll('li')).toHaveLength(3)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['keys']])
    wrapper.unmount()
  })
})
