import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UserDashboardModels from '../UserDashboardModels.vue'
import { buildDashboardSections, defaultDashboardSections, DashboardKind, DashboardState, type DashboardRankingSectionModel } from '../dashboardBoards'
function section(): DashboardRankingSectionModel {
  return buildDashboardSections(defaultDashboardSections,{today:'2026-10-26',timezone:'Asia/Taipei'},new Map()).find(s=>s.kind===DashboardKind.MODEL)!
}
describe('UserDashboardModels',()=>{
  it('shows all configured periods and the supplied model top ten',()=>{
    const value=section()
    value.cards.forEach(card=>{card.state=DashboardState.READY;card.items=Array.from({length:10},(_,index)=>({id:`model-${index}`,name:`model-${index}`,usage:200000000*(10-index)}))})
    const wrapper=mount(UserDashboardModels,{props:{section:value}})
    expect(wrapper.get('#dashboard-models-title').text()).toBe('模型看板')
    expect(wrapper.findAll('h3').map(h=>h.text())).toEqual(['当周使用 Top','当月使用 Top','累计使用 Top'])
    expect(wrapper.findAll('.dashboard-ranking-viewport').every(viewport=>viewport.findAll('li').length===10)).toBe(true)
    expect(wrapper.findAll('li')[9].get('b').text()).toContain('2 亿')
    wrapper.unmount()
  })
  it('distinguishes model empty data from failure and forwards only selected dependency',async()=>{
    const value=section()
    value.cards[0].state=DashboardState.READY
    value.cards[1].state=DashboardState.ERROR
    value.cards[1].error='模型月统计失败'
    value.cards[1].retryTargets=[{key:'models-month',label:'重试'}]
    const wrapper=mount(UserDashboardModels,{props:{section:value}})
    expect(wrapper.text()).toContain('暂无符合展示条件的模型')
    expect(wrapper.get('[role="alert"]').text()).toBe('模型月统计失败')
    expect(wrapper.findAll('.dashboard-ranking-loading')).toHaveLength(1)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['models-month']])
    wrapper.unmount()
  })
})
