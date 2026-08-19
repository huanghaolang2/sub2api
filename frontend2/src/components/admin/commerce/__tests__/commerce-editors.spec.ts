import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { AdminPaymentConfig } from '@shared-api/admin/payment'
import type { AdminGroup } from '@/types'
import type { PaymentOrder, SubscriptionPlan } from '@/types/payment'
import PaymentConfigPanel from '../PaymentConfigPanel.vue'
import OrderRefundDialog from '../OrderRefundDialog.vue'
import PaymentChannelEditorDialog from '../PaymentChannelEditorDialog.vue'
import PaymentPlanEditorDialog from '../PaymentPlanEditorDialog.vue'
import PaymentProviderEditorDialog from '../PaymentProviderEditorDialog.vue'
import { PaymentOrderStatus, PlanValidityUnit } from '@/features/admin/commerce/model'

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    t: (key: string, fallback?: string) => ({
      'admin.settings.payment.field_secretKey': '密钥',
      'admin.settings.payment.field_publishableKey': '公开密钥',
      'admin.settings.payment.field_webhookSecret': 'Webhook 密钥',
      'admin.settings.payment.field_currency': '支付币种'
    }[key] || (typeof fallback === 'string' ? fallback : key))
  })
}))

const surfaceStub = {
  props: ['show', 'title'],
  template: '<section v-if="show"><h2>{{ title }}</h2><slot /><slot name="footer" /></section>'
}

const global = { plugins: [createPinia()], stubs: { SurfaceDialog: surfaceStub } }

function config(): AdminPaymentConfig {
  return {
    enabled: true,
    min_amount: 5,
    max_amount: 8000,
    daily_limit: 20000,
    order_timeout_minutes: 30,
    max_pending_orders: 3,
    enabled_payment_types: ['alipay', 'stripe'],
    balance_disabled: false,
    balance_recharge_multiplier: 1.25,
    subscription_usd_to_cny_rate: 7.2,
    recharge_fee_rate: 2,
    load_balance_strategy: 'round-robin',
    product_name_prefix: 'Sub2API',
    product_name_suffix: 'AI 服务',
    help_image_url: '',
    help_text: '付款帮助'
  }
}

function paymentOrder(): PaymentOrder {
  return {
    id: 502,
    user_id: 2,
    amount: 49,
    pay_amount: 49,
    currency: 'USD',
    fee_rate: 0,
    payment_type: 'stripe',
    out_trade_no: 'fixture-completed-502',
    status: PaymentOrderStatus.COMPLETED,
    order_type: 'subscription',
    created_at: '2026-08-12T02:00:00Z',
    expires_at: '2026-08-12T02:30:00Z',
    refund_amount: 0
  }
}

function group(): AdminGroup {
  return {
    id: 201,
    name: 'Team 月度订阅',
    platform: 'openai',
    status: 'active',
    subscription_type: 'subscription',
    is_exclusive: true,
    rate_multiplier: 0.9,
    rpm_limit: 0,
    model_pricing: [],
    sort_order: 1
  } as unknown as AdminGroup
}

describe('admin commerce editors', () => {
  it('copies the reactive payment config safely and emits the full save contract', async () => {
    const wrapper = mount(PaymentConfigPanel, { props: { config: config(), saving: false }, global })
    const suffix = wrapper.findAll('label').find((label) => label.text().startsWith('商品名后缀'))!
    await suffix.find('input').setValue('AI 服务 · 验收')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      enabled: true,
      enabled_payment_types: ['alipay', 'stripe'],
      product_name_suffix: 'AI 服务 · 验收',
      load_balance_strategy: 'round-robin'
    })
  })

  it('requires an explicit acknowledgement before emitting a forced refund', async () => {
    const wrapper = mount(OrderRefundDialog, {
      props: { show: false, order: paymentOrder(), requireForce: true, warning: '余额不足' },
      global
    })
    await wrapper.setProps({ show: true })
    await wrapper.find('textarea').setValue('人工审核强制退款')
    await wrapper.find('#order-refund-form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()

    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true)
    await wrapper.find('#order-refund-form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({ amount: 49, reason: '人工审核强制退款', deduct_balance: true, force: true })
  })

  it('preserves all channel fields and converts line editors to unique arrays', async () => {
    const wrapper = mount(PaymentChannelEditorDialog, { props: { show: false, channel: null, saving: false }, global })
    await wrapper.setProps({ show: true })
    const labels = wrapper.findAll('label')
    await labels.find((label) => label.text().startsWith('渠道名称'))!.find('input').setValue('生产订阅')
    await labels.find((label) => label.text().startsWith('平台键'))!.find('input').setValue('openai')
    await labels.find((label) => label.text().startsWith('关联分组'))!.find('input').setValue('201')
    await labels.find((label) => label.text().startsWith('模型'))!.find('textarea').setValue('gpt-5.5\ngpt-5.5\ngpt-5.6-sol')
    await labels.find((label) => label.text().startsWith('功能卖点'))!.find('textarea').setValue('低延迟\n共享额度')
    await wrapper.find('#payment-channel-form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      name: '生产订阅',
      group_id: 201,
      platform: 'openai',
      models: ['gpt-5.5', 'gpt-5.6-sol'],
      features: ['低延迟', '共享额度']
    })
  })

  it('validates and serializes structured Stripe configuration with refund capabilities', async () => {
    const wrapper = mount(PaymentProviderEditorDialog, { props: { show: false, provider: null, saving: false }, global })
    await wrapper.setProps({ show: true })
    await wrapper.findAll('label').find((label) => label.text().startsWith('Provider 类型'))!.find('select').setValue('stripe')
    const labels = wrapper.findAll('label')
    await labels.find((label) => label.text().startsWith('实例名称'))!.find('input').setValue('Stripe Sandbox')
    await labels.find((label) => label.text().startsWith('密钥'))!.find('input').setValue('sk_test_123')
    await labels.find((label) => label.text().startsWith('公开密钥'))!.find('input').setValue('pk_test_123')
    await labels.find((label) => label.text().startsWith('Webhook 密钥'))!.find('input').setValue('whsec_123')
    await labels.find((label) => label.text().includes('支持管理员退款'))!.find('input').setValue(true)
    await wrapper.find('#payment-provider-form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      provider_key: 'stripe',
      supported_types: ['card', 'alipay', 'wxpay', 'link'],
      config: { secretKey: 'sk_test_123', publishableKey: 'pk_test_123', webhookSecret: 'whsec_123', currency: 'CNY' },
      refund_enabled: true
    })
  })

  it('normalizes a legacy singular plan unit before saving an edited plan', async () => {
    const plan = {
      id: 301,
      group_id: 201,
      name: 'Team 月度',
      description: '团队生产额度',
      price: 49,
      currency: 'USD',
      validity_days: 1,
      validity_unit: 'month',
      features: ['优先队列'],
      for_sale: true,
      sort_order: 1
    } as SubscriptionPlan
    const wrapper = mount(PaymentPlanEditorDialog, { props: { show: false, plan, groups: [group()], config: config(), saving: false }, global })
    await wrapper.setProps({ show: true })
    const unit = wrapper.findAll('label').find((label) => label.text().startsWith('有效期单位'))!.find('select')
    expect(unit.element.value).toBe(PlanValidityUnit.MONTHS)
    await wrapper.find('#payment-plan-form').trigger('submit')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({ group_id: 201, validity_days: 1, validity_unit: PlanValidityUnit.MONTHS, features: '优先队列' })
  })
})
