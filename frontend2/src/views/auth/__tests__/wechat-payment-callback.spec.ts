import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WechatPaymentCallbackView from '../WechatPaymentCallbackView.vue'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  query: {} as Record<string, unknown>
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: mocks.query }),
  useRouter: () => ({ replace: mocks.replace })
}))

function mountView() {
  return mount(WechatPaymentCallbackView, {
    global: {
      stubs: {
        PublicShell: { template: '<main><slot /></main>' },
        AppButton: { template: '<button><slot /></button>' }
      }
    }
  })
}

describe('WechatPaymentCallbackView', () => {
  beforeEach(() => {
    mocks.replace.mockReset()
    mocks.query = {}
    window.location.hash = ''
  })

  it('redirects a valid callback into the new purchase route', async () => {
    window.location.hash = '#wechat_resume_token=resume-123&redirect=%2Fpurchase'
    mountView()
    await flushPromises()
    expect(mocks.replace).toHaveBeenCalledWith({
      path: '/app/purchase',
      query: { wechat_resume: '1', wechat_resume_token: 'resume-123' }
    })
  })

  it('renders a recoverable error and returns to purchase', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('缺少恢复令牌')
    await wrapper.get('button').trigger('click')
    expect(mocks.replace).toHaveBeenLastCalledWith('/app/purchase')
  })
})
