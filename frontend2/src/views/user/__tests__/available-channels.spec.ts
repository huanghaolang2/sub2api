import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserAvailableChannel } from '@shared-api/channels'
import ModelPricingDialog from '@/components/user/models/ModelPricingDialog.vue'
import AvailableChannelsView from '../AvailableChannelsView.vue'

const api = vi.hoisted(() => ({ getAvailable: vi.fn(), getUserGroupRates: vi.fn() }))

vi.mock('@shared-api/channels', () => ({ getAvailable: api.getAvailable }))
vi.mock('@shared-api/groups', () => ({ getUserGroupRates: api.getUserGroupRates }))

const channels: UserAvailableChannel[] = [{
  name: '全球智能路由',
  description: '生产流量',
  platforms: [
    {
      platform: 'openai',
      groups: [{ id: 101, name: '企业专属', platform: 'openai', subscription_type: 'standard', rate_multiplier: 1, peak_rate_enabled: true, peak_start: '09:00', peak_end: '12:00', peak_rate_multiplier: 1.18, is_exclusive: true }],
      supported_models: [{ name: 'gpt-5.5', platform: 'openai', pricing: { billing_mode: 'token', input_price: 0.000001, output_price: 0.00001, cache_write_price: 0.0000012, cache_read_price: 0.0000001, image_input_price: null, image_output_price: null, per_request_price: null, intervals: [] } }]
    },
    {
      platform: 'anthropic',
      groups: [{ id: 102, name: '公共 Claude', platform: 'anthropic', subscription_type: 'standard', rate_multiplier: 1.1, peak_rate_enabled: false, peak_start: '', peak_end: '', peak_rate_multiplier: 1, is_exclusive: false }],
      supported_models: [{ name: 'claude-opus-4-1', platform: 'anthropic', pricing: null }]
    }
  ]
}]

async function mountView() {
  const wrapper = mount(AvailableChannelsView, {
    global: {
      plugins: [createPinia()],
      stubs: {
        ConsoleShell: { template: '<main><slot /></main>' },
        ModelPricingDialog: { props: ['show', 'modelName', 'platform', 'context', 'pricing', 'effectiveRate'], template: '<aside data-testid="price-dialog">{{ modelName }} / {{ effectiveRate }}</aside>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('available channels workbench', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getAvailable.mockResolvedValue(channels)
    api.getUserGroupRates.mockResolvedValue({ 101: 0.82, 102: 0.9 })
  })

  it('loads the shared channel and account-rate APIs and renders every capability dimension', async () => {
    const wrapper = await mountView()
    expect(api.getAvailable).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    expect(api.getUserGroupRates).toHaveBeenCalled()
    expect(wrapper.text()).toContain('全球智能路由')
    expect(wrapper.text()).toContain('企业专属')
    expect(wrapper.text()).toContain('公共 Claude')
    expect(wrapper.text()).toContain('0.82×')
    expect(wrapper.text()).toContain('09:00–12:00 · 1.18×')
    expect(wrapper.text()).toContain('gpt-5.5')
    expect(wrapper.text()).toContain('claude-opus-4-1')
    wrapper.unmount()
  })

  it('preserves section-level search semantics and opens complete pricing with the account rate', async () => {
    const wrapper = await mountView()
    await wrapper.find<HTMLInputElement>('.search-field input').setValue('claude-opus')
    expect(wrapper.findAll('.platform-section')).toHaveLength(1)
    expect(wrapper.text()).toContain('anthropic')
    expect(wrapper.text()).not.toContain('gpt-5.5')

    await wrapper.find<HTMLInputElement>('.search-field input').setValue('')
    await wrapper.findAll('.model-chip')[0]!.trigger('click')
    const dialog = wrapper.findComponent(ModelPricingDialog)
    expect(dialog.props('show')).toBe(true)
    expect(dialog.props('modelName')).toBe('gpt-5.5')
    expect(dialog.props('effectiveRate')).toBe(0.82)
    wrapper.unmount()
  })
})
