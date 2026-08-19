import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'

describe('global confirmation store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('resolves the caller after an explicit dangerous confirmation', async () => {
    const store = useConfirmStore()
    const result = store.ask({ title: '删除用户', message: '不可撤销', tone: ConfirmTone.DANGER })
    expect(store.current?.tone).toBe(ConfirmTone.DANGER)
    store.confirm()
    await expect(result).resolves.toBe(true)
    expect(store.current).toBeNull()
  })

  it('cancels an outstanding request when a new one replaces it', async () => {
    const store = useConfirmStore()
    const first = store.ask({ title: '第一次', message: '第一次' })
    void store.ask({ title: '第二次', message: '第二次' })
    await expect(first).resolves.toBe(false)
    expect(store.current?.title).toBe('第二次')
  })
})
