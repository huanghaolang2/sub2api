import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import AnnouncementDialog from '../AnnouncementDialog.vue'
import { useAnnouncementStore } from '@/stores/announcements'

describe('AnnouncementDialog', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  it('renders mixed Markdown and HTML while removing executable markup', async () => {
    const announcements = useAnnouncementStore()
    announcements.currentPopup = {
      id: 8,
      title: '维护公告',
      content: '## 时间窗口\n\n<div><strong>今晚</strong></div><table><tbody><tr><td>23:00</td></tr></tbody></table><script>window.__xss = true</script>',
      notify_mode: 'popup',
      created_at: '2026-08-18T03:00:00Z',
      updated_at: '2026-08-18T03:00:00Z'
    }

    const wrapper = mount(AnnouncementDialog)
    await wrapper.vm.$nextTick()

    const content = document.body.querySelector('.announcement-dialog__content')
    expect(content?.querySelector('h2')?.textContent).toBe('时间窗口')
    expect(content?.querySelector('strong')?.textContent).toBe('今晚')
    expect(content?.querySelector('td')?.textContent).toBe('23:00')
    expect(content?.querySelector('script')).toBeNull()
    expect(document.body.style.overflow).toBe('hidden')

    wrapper.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
