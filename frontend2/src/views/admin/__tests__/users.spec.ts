import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminGroup, AdminUser } from '@/types'
import AttributeDefinitionsDialog from '@/components/admin/users/AttributeDefinitionsDialog.vue'
import UserDetailDrawer from '@/components/admin/users/UserDetailDrawer.vue'
import { AdminUserRole, SortOrder, UserColumnKey, UserPanelTab } from '@/features/admin/users/model'
import UsersView from '../UsersView.vue'

const storageValues = new Map<string, string>()
const localStorageMock: Storage = {
  get length() { return storageValues.size },
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(key) ?? null,
  key: (index) => Array.from(storageValues.keys())[index] ?? null,
  removeItem: (key) => { storageValues.delete(key) },
  setItem: (key, value) => { storageValues.set(key, String(value)) }
}

const api = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  getPlatformQuotas: vi.fn(),
  toggleStatus: vi.fn(),
  getAll: vi.fn(),
  getAllIncludingInactive: vi.fn(),
  listEnabledDefinitions: vi.fn(),
  listDefinitions: vi.fn(),
  reorderDefinitions: vi.fn(),
  getBatchUserAttributes: vi.fn(),
  getBatchUsersUsage: vi.fn()
}))

vi.mock('@shared-api/admin/users', () => ({
  list: api.list,
  getById: api.getById,
  getPlatformQuotas: api.getPlatformQuotas,
  toggleStatus: api.toggleStatus
}))
vi.mock('@shared-api/admin/groups', () => ({ getAll: api.getAll, getAllIncludingInactive: api.getAllIncludingInactive }))
vi.mock('@shared-api/admin/userAttributes', () => ({
  listEnabledDefinitions: api.listEnabledDefinitions,
  listDefinitions: api.listDefinitions,
  reorderDefinitions: api.reorderDefinitions,
  getBatchUserAttributes: api.getBatchUserAttributes
}))
vi.mock('@shared-api/admin/dashboard', () => ({ getBatchUsersUsage: api.getBatchUsersUsage }))
vi.mock('@/api', () => ({ totpAPI: { stepUp: vi.fn() } }))

function fixtureUser(): AdminUser {
  return {
    id: 7,
    email: 'member@example.test',
    username: 'Member',
    notes: '重点客户',
    role: 'user',
    balance: 42,
    concurrency: 3,
    rpm_limit: 120,
    status: 'active',
    allowed_groups: [11],
    group_rates: { 11: 0.8 },
    balance_notify_enabled: false,
    balance_notify_threshold: null,
    balance_notify_extra_emails: [],
    current_concurrency: 1,
    created_at: '2026-08-17T12:00:00Z',
    updated_at: '2026-08-17T12:00:00Z'
  } as AdminUser
}

function group(): AdminGroup {
  return {
    id: 11,
    name: '团队专属',
    platform: 'openai',
    status: 'active',
    subscription_type: 'standard',
    is_exclusive: true,
    rate_multiplier: 1
  } as AdminGroup
}

async function mountView() {
  const wrapper = mount(UsersView, {
    global: {
      plugins: [createPinia()],
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        PageState: { template: '<div><slot /></div>' },
        UserCreateDialog: true,
        BulkLimitsDialog: true,
        AttributeDefinitionsDialog: true,
        UserDetailDrawer: true
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('admin users page', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
    localStorage.clear()
    vi.clearAllMocks()
    api.list.mockResolvedValue({ items: [fixtureUser()], total: 1, page: 1, page_size: 20, pages: 1 })
    api.getById.mockResolvedValue(fixtureUser())
    api.getPlatformQuotas.mockResolvedValue({ platform_quotas: [] })
    api.toggleStatus.mockResolvedValue(fixtureUser())
    api.getAll.mockResolvedValue([group()])
    api.getAllIncludingInactive.mockResolvedValue([group()])
    api.listEnabledDefinitions.mockResolvedValue([])
    api.listDefinitions.mockResolvedValue([
      { id: 501, key: 'tier', name: '客户等级', type: 'text', required: false, enabled: true, display_order: 1 },
      { id: 502, key: 'region', name: '区域', type: 'text', required: false, enabled: true, display_order: 2 }
    ])
    api.reorderDefinitions.mockResolvedValue({ message: 'ok' })
    api.getBatchUserAttributes.mockResolvedValue({ attributes: {} })
    api.getBatchUsersUsage.mockResolvedValue({ stats: {} })
  })

  it('uses the shared service-side list contract with subscriptions, sorting, and filters', async () => {
    const wrapper = await mountView()
    expect(api.list).toHaveBeenCalledWith(1, 20, expect.objectContaining({
      include_subscriptions: true,
      sort_by: UserColumnKey.CREATED_AT,
      sort_order: SortOrder.DESC
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))

    const role = wrapper.find('.active-filters select')
    await role.setValue(AdminUserRole.ADMIN)
    await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({ role: AdminUserRole.ADMIN }), expect.anything())

    const search = wrapper.find<HTMLInputElement>('input[aria-label="搜索用户"]')
    await search.setValue('member@example.test')
    await search.trigger('keyup.enter')
    await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith(1, 20, expect.objectContaining({
      search: 'member@example.test',
      role: AdminUserRole.ADMIN
    }), expect.anything())
    wrapper.unmount()
  })

  it('persists optional columns and opens the requested user workspace in one action', async () => {
    const wrapper = await mountView()
    const columnsButton = wrapper.findAll('button').find((button) => button.text() === '显示列')
    expect(columnsButton).toBeDefined()
    await columnsButton!.trigger('click')
    const usageOption = wrapper.findAll('.settings-options--columns label').find((label) => label.text().startsWith('用量'))
    expect(usageOption).toBeDefined()
    await usageOption!.find('input').setValue(true)
    await flushPromises()
    expect(JSON.parse(localStorage.getItem('frontend2:admin-users:visible-columns') || '[]')).toContain(UserColumnKey.USAGE)
    expect(api.getBatchUsersUsage).toHaveBeenCalledWith([7])

    await wrapper.find('.identity-cell').trigger('click')
    const drawer = wrapper.findComponent(UserDetailDrawer)
    expect(drawer.props('show')).toBe(true)
    expect(drawer.props('initialTab')).toBe(UserPanelTab.PROFILE)
    expect((drawer.props('user') as AdminUser).id).toBe(7)
    wrapper.unmount()
  })

  it('reorders user attributes through the shared admin contract', async () => {
    const wrapper = mount(AttributeDefinitionsDialog, {
      props: { show: true },
      global: {
        plugins: [createPinia()],
        stubs: {
          SurfaceDialog: { template: '<section><slot /><slot name="footer" /></section>' }
        }
      }
    })
    await flushPromises()
    const moveDown = wrapper.find('button[aria-label="下移属性 客户等级"]')
    expect(moveDown.exists()).toBe(true)
    await moveDown.trigger('click')
    await flushPromises()
    expect(api.reorderDefinitions).toHaveBeenCalledWith([502, 501])
    wrapper.unmount()
  })
})
