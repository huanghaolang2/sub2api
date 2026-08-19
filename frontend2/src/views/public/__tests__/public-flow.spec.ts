import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyUsageHistoryDays, KeyUsageRange, PublicKeyStatus, PublicKeyUsageMode, RateLimitWindow } from '@/features/public/model'
import SetupView from '../SetupView.vue'
import KeyUsageView from '../KeyUsageView.vue'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  showSuccess: vi.fn(),
  getSetupStatus: vi.fn(),
  testDatabase: vi.fn(),
  testRedis: vi.fn(),
  install: vi.fn(),
  getPublicKeyUsage: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showSuccess: mocks.showSuccess }) }))
vi.mock('@/api/setup', () => ({
  getSetupStatus: mocks.getSetupStatus,
  testDatabase: mocks.testDatabase,
  testRedis: mocks.testRedis,
  install: mocks.install,
}))
vi.mock('@/features/public/keyUsage', () => ({ getPublicKeyUsage: mocks.getPublicKeyUsage }))

const global = {
  stubs: {
    PublicShell: { template: '<div><slot /></div>' },
    RouterLink: { props: ['to'], template: '<a><slot /></a>' },
  },
}

function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((item) => item.text().includes(label))!
}

describe('public setup and key usage flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSetupStatus.mockResolvedValue({ needs_setup: true, step: 'database' })
    mocks.testDatabase.mockResolvedValue(undefined)
    mocks.testRedis.mockResolvedValue(undefined)
    mocks.install.mockResolvedValue({ message: 'installed', restart: true })
    mocks.getPublicKeyUsage.mockResolvedValue({
      mode: PublicKeyUsageMode.QUOTA_LIMITED,
      isValid: true,
      status: PublicKeyStatus.ACTIVE,
      quota: { limit: 100, used: 12.5, remaining: 87.5, unit: 'USD' },
      rate_limits: [{ window: RateLimitWindow.ONE_DAY, limit: 10, used: 2, remaining: 8 }],
      usage: {
        today: { requests: 7, total_tokens: 1200, input_tokens: 800, output_tokens: 400, cache_creation_tokens: 31, cache_read_tokens: 102, actual_cost: 0.12 },
        total: { requests: 52, total_tokens: 9800, input_tokens: 6400, output_tokens: 3400, cache_creation_tokens: 240, cache_read_tokens: 680, actual_cost: 1.25 },
        rpm: 3,
        tpm: 420,
        average_duration_ms: 384,
      },
      model_stats: [{ model: 'gpt-fixture', requests: 7, input_tokens: 800, output_tokens: 400, cache_creation_tokens: 31, cache_read_tokens: 102, total_tokens: 1200, actual_cost: 0.12 }],
      daily_usage: [{ date: '2026-08-18', requests: 7, input_tokens: 800, output_tokens: 400, cache_read_tokens: 100, cache_write_tokens: 30, total_tokens: 1200, cost: 0.12, actual_cost: 0.12 }],
    })
  })

  it('gates setup progression on connection checks and submits the complete install contract', async () => {
    const wrapper = mount(SetupView, { global })
    await flushPromises()

    await button(wrapper, '下一步').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('数据库连接测试')
    await button(wrapper, '测试数据库连接').trigger('click')
    await flushPromises()
    expect(mocks.testDatabase).toHaveBeenCalledWith(expect.objectContaining({ host: 'localhost', port: 5432, dbname: 'sub2api' }))
    await button(wrapper, '下一步').trigger('click')

    expect(wrapper.text()).toContain('连接 Redis')
    await button(wrapper, '测试 Redis 连接').trigger('click')
    await flushPromises()
    expect(mocks.testRedis).toHaveBeenCalledWith(expect.objectContaining({ host: 'localhost', port: 6379, db: 0 }))
    await button(wrapper, '下一步').trigger('click')

    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('admin@example.test')
    await inputs[1].setValue('secret12')
    await inputs[2].setValue('secret12')
    await button(wrapper, '下一步').trigger('click')
    await button(wrapper, '确认并开始安装').trigger('click')
    await flushPromises()

    expect(mocks.install).toHaveBeenCalledWith(expect.objectContaining({
      database: expect.objectContaining({ host: 'localhost', sslmode: 'disable' }),
      redis: expect.objectContaining({ host: 'localhost', enable_tls: false }),
      admin: { email: 'admin@example.test', password: 'secret12' },
      server: expect.objectContaining({ host: '0.0.0.0', port: expect.any(Number), mode: 'release' }),
    }))
    expect(wrapper.text()).toContain('安装配置已提交')
    wrapper.unmount()
  })

  it('queries a key without persisting it and renders quota, model, and daily usage', async () => {
    const wrapper = mount(KeyUsageView, { global })
    const keyInput = wrapper.get('input[placeholder="sk-..."]')
    await keyInput.setValue('sk-fixture-secret')
    await button(wrapper, '立即查询').trigger('click')
    await flushPromises()

    expect(mocks.getPublicKeyUsage).toHaveBeenCalledWith(
      'sk-fixture-secret',
      expect.objectContaining({ range: KeyUsageRange.THIRTY_DAYS, days: KeyUsageHistoryDays.THIRTY }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(wrapper.text()).toContain('可用')
    expect(wrapper.text()).toContain('$87.5000')
    expect(wrapper.text()).toContain('gpt-fixture')
    expect(wrapper.text()).toContain('今日缓存创建')
    expect(wrapper.text()).toContain('累计缓存读取')
    expect(wrapper.text()).toContain('680')
    expect(wrapper.text()).toContain('2026-08-18')
    expect(wrapper.html()).not.toContain('sk-fixture-secret')
    wrapper.unmount()
  })
})
