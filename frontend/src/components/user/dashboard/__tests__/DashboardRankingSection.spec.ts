import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardRankingSection from '../DashboardRankingSection.vue'
import { DashboardKind, DashboardState, type DashboardRankingCardModel, type DashboardRankingSectionModel } from '../dashboardBoards'
function card(overrides: Partial<DashboardRankingCardModel> = {}): DashboardRankingCardModel {
  return { id:'weekly',title:'当周使用 Top',caption:'',rangeLabel:'2026-10-26 到 2026-10-26',state:DashboardState.READY,error:'',notice:'',retryTargets:[],items:Array.from({length:25},(_,index)=>({id:String(index+1),name:index<2?'同名':`Key ${index+1}`,usage:index===24?0:25-index})),...overrides }
}
function section(cards: DashboardRankingCardModel[]): DashboardRankingSectionModel {
  return {id:'test-ranking',title:'Token 用量排行',description:'按周期观察用量',kind:DashboardKind.TOKEN,cards}
}
describe('DashboardRankingSection',()=>{
  it('renders all 25 stable IDs including same names and the final zero value',()=>{
    const wrapper=mount(DashboardRankingSection,{props:{section:section([card()])}})
    const region=wrapper.get('[role="region"]')
    expect(region.attributes('tabindex')).toBe('0')
    expect(region.attributes('aria-labelledby')).toBe('test-ranking-title test-ranking-weekly-title')
    expect(region.attributes('aria-busy')).toBe('false')
    expect(region.findAll('li')).toHaveLength(25)
    expect(region.findAll('li').slice(0,2).map(row=>row.attributes('data-item-id'))).toEqual(['1','2'])
    expect(region.findAll('li')[0].get('strong').attributes('title')).toBe('同名')
    expect(region.findAll('li')[24].get('b').text()).toBe('0 Tokens')
    expect(wrapper.get('h3').element.closest('[role="region"]')).toBeNull()
    wrapper.unmount()
  })
  it('keeps one viewport through idle, loading, empty, failure and success',async()=>{
    const wrapper=mount(DashboardRankingSection,{props:{section:section([card({state:DashboardState.IDLE})])}})
    const viewport=wrapper.get('.dashboard-ranking-viewport').element
    expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe('当周使用 Top加载中')
    for(const state of [DashboardState.LOADING,DashboardState.ERROR,DashboardState.READY]){
      await wrapper.setProps({section:section([card({state,items:[],error:state===DashboardState.ERROR?'请求超时':''})])})
      expect(wrapper.get('.dashboard-ranking-viewport').element).toBe(viewport)
      if(state===DashboardState.ERROR)expect(wrapper.get('[role="alert"]').text()).toBe('请求超时')
      if(state===DashboardState.READY)expect(wrapper.text()).toContain('暂无 API Key')
    }
    await wrapper.setProps({section:section([card()])})
    expect(wrapper.get('.dashboard-ranking-viewport').element).toBe(viewport)
    expect(wrapper.findAll('li')).toHaveLength(25)
    wrapper.unmount()
  })
  it('keeps successful rows visible with a supplement notice and emits the retry key',async()=>{
    const wrapper=mount(DashboardRankingSection,{props:{section:section([card({notice:'完整名单暂不可用',retryTargets:[{key:'keys',label:'重试完整名单'}]})])}})
    expect(wrapper.findAll('li')).toHaveLength(25)
    expect(wrapper.get('.dashboard-ranking-notice').text()).toBe('完整名单暂不可用')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['keys']])
    wrapper.unmount()
  })
  it('keeps period states independent and derives unique IDs from each card',()=>{
    const wrapper=mount(DashboardRankingSection,{props:{section:section([card({id:'week',state:DashboardState.ERROR,error:'周失败',items:[]}),card({id:'month',title:'当月使用 Top'})])}})
    expect(wrapper.findAll('[role="region"]')).toHaveLength(2)
    expect(wrapper.get('[role="alert"]').text()).toBe('周失败')
    expect(wrapper.findAll('[role="region"]')[1].findAll('li')).toHaveLength(25)
    expect(wrapper.findAll('h3').map(h=>h.attributes('id'))).toEqual(['test-ranking-week-title','test-ranking-month-title'])
    wrapper.unmount()
  })
})
