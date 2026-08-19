import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import AnnouncementCenter from '../AnnouncementCenter.vue'
import { useAnnouncementStore } from '@/stores/announcements'

describe('AnnouncementCenter', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  it('opens the recent list, marks a detail read and sanitizes its body', async () => {
    const store = useAnnouncementStore()
    store.announcements = [{
      id: 12,
      title: '版本更新',
      content: '## 新能力\n\n<strong>已上线</strong><script>window.__xss = true</script>',
      notify_mode: 'silent',
      created_at: '2026-08-18T03:00:00Z',
      updated_at: '2026-08-18T03:00:00Z'
    }]
    vi.spyOn(store, 'fetchAnnouncements').mockResolvedValue(undefined)
    const markRead = vi.spyOn(store, 'markAsRead').mockImplementation(async (id) => {
      const item = store.announcements.find((entry) => entry.id === id)
      if (item) item.read_at = '2026-08-18T04:00:00Z'
    })

    const wrapper = mount(AnnouncementCenter)
    await wrapper.get('.announcement-trigger').trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.body.textContent).toContain('版本更新')

    const row = document.body.querySelector<HTMLButtonElement>('.announcement-center__list > button')
    row?.click()
    await wrapper.vm.$nextTick()

    expect(markRead).toHaveBeenCalledWith(12)
    expect(document.body.querySelector('.announcement-center__content h2')?.textContent).toBe('新能力')
    expect(document.body.querySelector('.announcement-center__content strong')?.textContent).toBe('已上线')
    expect(document.body.querySelector('.announcement-center__content script')).toBeNull()
  })

  it('marks every unread announcement from the list footer', async () => {
    const store = useAnnouncementStore()
    store.announcements = [{
      id: 20,
      title: '维护通知',
      content: '正文',
      notify_mode: 'silent',
      created_at: '2026-08-18T03:00:00Z',
      updated_at: '2026-08-18T03:00:00Z'
    }]
    vi.spyOn(store, 'fetchAnnouncements').mockResolvedValue(undefined)
    const markAll = vi.spyOn(store, 'markAllAsRead').mockImplementation(async () => {
      store.announcements[0].read_at = '2026-08-18T04:00:00Z'
    })

    const wrapper = mount(AnnouncementCenter)
    await wrapper.get('.announcement-trigger').trigger('click')
    await wrapper.vm.$nextTick()
    const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent?.includes('全部标记已读'))
    button?.click()
    await wrapper.vm.$nextTick()

    expect(markAll).toHaveBeenCalledOnce()
    expect(store.unreadCount).toBe(0)
  })
})
