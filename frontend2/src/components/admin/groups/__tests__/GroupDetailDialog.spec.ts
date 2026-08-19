import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminGroup, ApiKey } from '@/types'
import GroupDetailDialog from '../GroupDetailDialog.vue'

const api = vi.hoisted(() => ({
  getStats: vi.fn(),
  getGroupApiKeys: vi.fn()
}))

vi.mock('@shared-api/admin/groups', () => ({
  getStats: api.getStats,
  getGroupApiKeys: api.getGroupApiKeys
}))

const surfaceStub = {
  props: ['show', 'title'],
  template: '<section v-if="show"><h2>{{ title }}</h2><slot /></section>'
}

function group(id: number, name: string): AdminGroup {
  return { id, name } as AdminGroup
}

function apiKey(id: number, key: string): ApiKey {
  return {
    id,
    key,
    name: `Key ${id}`,
    user_id: id + 100,
    status: 'active',
    quota_used: 1,
    quota: 0,
    last_used_at: null
  } as unknown as ApiKey
}

describe('GroupDetailDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getStats.mockResolvedValue({ total_api_keys: 1, active_api_keys: 1, total_requests: 2, total_cost: 3 })
    api.getGroupApiKeys.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, pages: 1 })
  })

  it('masks API keys instead of rendering complete credentials', async () => {
    const fullKey = 'sk-live-super-secret-value-123456'
    api.getGroupApiKeys.mockResolvedValue({ items: [apiKey(1, fullKey)], total: 1, page: 1, page_size: 20, pages: 1 })
    const wrapper = mount(GroupDetailDialog, {
      props: { show: false, group: group(1, '分组一') },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })

    await wrapper.setProps({ show: true })
    await flushPromises()

    expect(wrapper.text()).not.toContain(fullKey)
    expect(wrapper.text()).toContain('sk-liv...3456')
  })

  it('clears previous group data when the next group request fails', async () => {
    const firstKey = 'sk-first-group-secret-123456'
    api.getGroupApiKeys.mockResolvedValueOnce({ items: [apiKey(1, firstKey)], total: 1, page: 1, page_size: 20, pages: 1 })
    const wrapper = mount(GroupDetailDialog, {
      props: { show: false, group: group(1, '分组一') },
      global: { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }
    })

    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(wrapper.text()).toContain('Key 1')

    await wrapper.setProps({ show: false, group: group(2, '分组二') })
    api.getStats.mockRejectedValueOnce(new Error('stats failed'))
    api.getGroupApiKeys.mockRejectedValueOnce(new Error('keys failed'))
    await wrapper.setProps({ show: true })
    await flushPromises()

    expect(wrapper.text()).not.toContain('Key 1')
    expect(wrapper.text()).toContain('该分组暂无 API Key')
  })
})
