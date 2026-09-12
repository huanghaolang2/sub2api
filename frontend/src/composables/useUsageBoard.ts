import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { getUsageBoard, UsageBoardGranularity, UsageBoardScope, UsageBoardSortOrder, type UsageBoardQuery, type UsageBoardResponse } from '../api/usageBoard'
import * as keysAPI from '../api/keys'
import * as groupsAPI from '../api/groups'
import * as adminGroupsAPI from '../api/admin/groups'
import * as adminUsageAPI from '../api/admin/usage'
import { boardDefaultRange, boardMonthLastDay, validateBoardRange, UsageBoardChartType, UsageBoardChoiceKind, UsageBoardLoadState, UsageBoardValidation, type UsageBoardChoice } from '../utils/usageBoard'

export function useUsageBoard(scope: UsageBoardScope) {
  const range = boardDefaultRange()
  const filters = reactive({ granularity: UsageBoardGranularity.DAY, startDate: range.start, endDate: range.end, startMonth: range.start.slice(0, 7), endMonth: range.end.slice(0, 7) })
  const selectedKeys = ref<UsageBoardChoice[]>([])
  const selectedGroups = ref<UsageBoardChoice[]>([])
  const chartType = ref(UsageBoardChartType.LINE)
  const sortOrder = ref(UsageBoardSortOrder.DESC)
  const page = ref(1), pageSize = ref(20)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const data = ref<UsageBoardResponse | null>(null)
  const state = ref(UsageBoardLoadState.IDLE)
  const error = ref('')
  const validation = computed(() => validateBoardRange(filters.granularity,
    filters.granularity === UsageBoardGranularity.MONTH ? filters.startMonth : filters.startDate,
    filters.granularity === UsageBoardGranularity.MONTH ? filters.endMonth : filters.endDate))
  let controller: AbortController | null = null
  let sequence = 0
  let mounted = false

  function query(): UsageBoardQuery {
    return { granularity: filters.granularity,
      ...(filters.granularity === UsageBoardGranularity.MONTH
        ? { start_month: filters.startMonth, end_month: filters.endMonth }
        : { start_date: filters.startDate, end_date: filters.endDate }),
      timezone, api_key_ids: selectedKeys.value.map((key) => key.id), group_ids: selectedGroups.value.map((group) => group.id),
      sort_order: sortOrder.value, page: page.value, page_size: pageSize.value }
  }
  async function reload(): Promise<void> {
    controller?.abort(); controller = new AbortController()
    const current = controller, version = ++sequence
    data.value = null; error.value = ''
    if (validation.value !== UsageBoardValidation.VALID) { state.value = UsageBoardLoadState.IDLE; return }
    state.value = UsageBoardLoadState.LOADING
    try {
      const result = await getUsageBoard(scope, query(), current.signal)
      if (current.signal.aborted || version !== sequence) return
      data.value = result; page.value = result.pagination.page; state.value = UsageBoardLoadState.READY
    } catch (caught) {
      if (current.signal.aborted || version !== sequence) return
      error.value = caught instanceof Error ? caught.message : String((caught as { message?: string })?.message || '')
      state.value = UsageBoardLoadState.ERROR
    }
  }
  function setGranularity(next: UsageBoardGranularity): void {
    if (next === filters.granularity) return
    if (next === UsageBoardGranularity.MONTH) {
      filters.startMonth = filters.startDate.slice(0, 7); filters.endMonth = filters.endDate.slice(0, 7)
    } else if (filters.granularity === UsageBoardGranularity.MONTH) {
      filters.startDate = filters.startMonth ? `${filters.startMonth}-01` : ''
      filters.endDate = filters.endMonth ? boardMonthLastDay(filters.endMonth) : ''
    }
    filters.granularity = next
  }
  function toggleSort(): void { sortOrder.value = sortOrder.value === UsageBoardSortOrder.DESC ? UsageBoardSortOrder.ASC : UsageBoardSortOrder.DESC }
  function setPage(next: number): void { page.value = next; void reload() }
  function setPageSize(size: number): void { pageSize.value = size; page.value = 1; void reload() }

  const lookups = reactive({
    [UsageBoardChoiceKind.KEY]: { options: [] as UsageBoardChoice[], state: UsageBoardLoadState.IDLE, search: '', page: 1, total: 0, error: '' },
    [UsageBoardChoiceKind.GROUP]: { options: [] as UsageBoardChoice[], state: UsageBoardLoadState.IDLE, search: '', page: 1, total: 0, error: '' }
  })
  const lookupControllers = new Map<UsageBoardChoiceKind, AbortController>()
  const lookupTimers = new Map<UsageBoardChoiceKind, ReturnType<typeof setTimeout>>()

  async function loadChoices(kind: UsageBoardChoiceKind, append = false): Promise<void> {
    lookupControllers.get(kind)?.abort()
    const current = new AbortController(); lookupControllers.set(kind, current)
    const lookup = lookups[kind], targetPage = append ? lookup.page + 1 : 1, keyword = lookup.search
    lookup.state = UsageBoardLoadState.LOADING; lookup.error = ''
    try {
      let options: UsageBoardChoice[], total: number
      if (kind === UsageBoardChoiceKind.KEY && scope === UsageBoardScope.SELF) {
        const response = await keysAPI.list(targetPage, 30, { search: keyword }, { signal: current.signal })
        options = response.items.map((item) => ({ id: item.id, label: item.name || `API Key #${item.id}` })); total = response.total
      } else if (kind === UsageBoardChoiceKind.KEY) {
        const response = await adminUsageAPI.searchApiKeys(undefined, keyword)
        options = response.map((item) => ({ id: item.id, label: item.name || `API Key #${item.id}` })); total = options.length
      } else if (scope === UsageBoardScope.SELF) {
        const response = await groupsAPI.getAvailable()
        options = response.filter((item) => item.name.toLowerCase().includes(keyword.toLowerCase())).map((item) => ({ id: item.id, label: item.name })); total = options.length
      } else {
        const response = await adminGroupsAPI.list(targetPage, 30, { search: keyword }, { signal: current.signal })
        options = response.items.map((item) => ({ id: item.id, label: item.name })); total = response.total
      }
      if (current.signal.aborted) return
      lookup.options = append ? [...lookup.options, ...options.filter((item) => !lookup.options.some((existing) => existing.id === item.id))] : options
      lookup.page = targetPage; lookup.total = total; lookup.state = UsageBoardLoadState.READY
    } catch (caught) {
      if (current.signal.aborted) return
      lookup.state = UsageBoardLoadState.ERROR
      lookup.error = caught instanceof Error ? caught.message : ''
    }
  }
  function searchChoices(kind: UsageBoardChoiceKind, keyword: string): void {
    const timer = lookupTimers.get(kind); if (timer) clearTimeout(timer)
    lookupControllers.get(kind)?.abort()
    lookups[kind].search = keyword; lookups[kind].options = []; lookups[kind].state = UsageBoardLoadState.LOADING
    lookupTimers.set(kind, setTimeout(() => { lookupTimers.delete(kind); void loadChoices(kind) }, 250))
  }
  watch([filters, selectedKeys, selectedGroups, sortOrder], () => {
    if (!mounted) return
    page.value = 1; void reload()
  }, { deep: true })
  onMounted(() => { mounted = true; void reload(); void loadChoices(UsageBoardChoiceKind.KEY); void loadChoices(UsageBoardChoiceKind.GROUP) })
  onUnmounted(() => {
    mounted = false; controller?.abort(); sequence++
    lookupTimers.forEach(clearTimeout); lookupControllers.forEach((item) => item.abort())
  })
  return { filters, selectedKeys, selectedGroups, chartType, sortOrder, page, pageSize, timezone, data, state, error, validation,
    lookups, reload, setGranularity, toggleSort, setPage, setPageSize, loadChoices, searchChoices }
}
