import { createApp, defineComponent, h, ref, type PropType } from 'vue'
import '../../style.css'
import { useDashboardBoards } from '@/composables/useDashboardBoards'
import { defaultDashboardSections, DashboardKind, DashboardDataKind, type DashboardDependencyLoader } from '@/components/user/dashboard/dashboardBoards'
import UserDashboardTrends from '@/components/user/dashboard/UserDashboardTrends.vue'
import UserDashboardStats from '@/components/user/dashboard/UserDashboardStats.vue'
import UserDashboardModels from '@/components/user/dashboard/UserDashboardModels.vue'
import { dashboardTrendRange } from '@/components/user/dashboard/dashboardTrends'
import { UsageBoardCoverage, UsageBoardDataState, UsageBoardGranularity } from '@/api/usageBoard'
import type { UserDashboardStats as Stats } from '@/api/usage'
enum PreviewScenario { SUCCESS='success', LOADING='loading', EMPTY='empty', ERROR='error' }
const PreviewDashboard=defineComponent({
  props:{scenario:{type:String as PropType<PreviewScenario>,required:true}},
  setup(props){
    const loader:DashboardDependencyLoader=async(dependency)=>{
      if(props.scenario===PreviewScenario.LOADING)return new Promise(()=>{})
      if(props.scenario===PreviewScenario.ERROR)throw {message:'预览数据加载失败'}
      const count=props.scenario===PreviewScenario.EMPTY?0:25
      if(dependency.kind===DashboardDataKind.KEYS)return {kind:dependency.kind,data:{usage_board:{users:count,total_tokens:1000,ranking:Array.from({length:count},(_,i)=>({api_key_id:i+1,api_key_name:`API Key ${String(i+1).padStart(2,'0')} 长名称验证`,total_tokens:25-i-1}))}} as Stats}
      if(dependency.kind===DashboardDataKind.MODELS)return {kind:dependency.kind,data:{start_date:dependency.query.start_date,end_date:dependency.query.end_date,models:Array.from({length:Math.min(count,10)},(_,i)=>({model:`model-${String(i+1).padStart(2,'0')}-long-name`,requests:1,input_tokens:(25-i)*100_000_000,output_tokens:0,cache_creation_tokens:0,cache_read_tokens:0,total_tokens:(25-i)*100_000_000,cost:0,actual_cost:0}))}}
      const start=dependency.query.granularity===UsageBoardGranularity.MONTH?`${dependency.query.end_month}-01`:dashboardTrendRange('week',new Date(),1).startDate!
      const end=dependency.query.end_date||`${dependency.query.end_month}-28`
      return {kind:dependency.kind,data:{granularity:dependency.query.granularity,timezone:dependency.query.timezone,start_date:start,end_date:end,periods:[{start,end,label:start,coverage:UsageBoardCoverage.PARTIAL}],series:Array.from({length:count},(_,i)=>({api_key_id:i+1,api_key_name:`API Key ${String(i+1).padStart(2,'0')}`,points:[{period_start:start,total_tokens:25-i-1,record_count:1,data_state:UsageBoardDataState.OBSERVED}]})),rows:[],pagination:{page:1,page_size:20,total:count,pages:2}}}
    }
    const {sections,retry}=useDashboardBoards(defaultDashboardSections,loader)
    return()=>h('div',{class:'space-y-8','data-scenario':props.scenario},sections.value.map(section=>section.kind===DashboardKind.TREND?h(UserDashboardTrends,{section,onRetry:retry}):section.kind===DashboardKind.TOKEN?h(UserDashboardStats,{section,onRetry:retry}):h(UserDashboardModels,{section,onRetry:retry})))
  }
})
createApp(defineComponent({setup(){
  const scenario=ref(PreviewScenario.SUCCESS)
  return()=>h('main',{class:'preview'},[
    h('div',{class:'controls'},[
      ...[[PreviewScenario.SUCCESS,'成功数据'],[PreviewScenario.LOADING,'加载中'],[PreviewScenario.EMPTY,'空数据'],[PreviewScenario.ERROR,'请求失败']].map(([value,label])=>h('button',{onClick:()=>{scenario.value=value as PreviewScenario}},label)),
      h('button',{onClick:()=>document.documentElement.classList.toggle('dark')},'切换主题')
    ]),h(PreviewDashboard,{key:scenario.value,scenario:scenario.value})
  ])
}})).mount('#app')
