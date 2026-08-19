import { describe, expect, it } from 'vitest'
import type { CreateOrderResult, MethodLimit, SubscriptionPlan } from '@/types/payment'
import {
  PaymentLaunchKind,
  VisiblePaymentMethod,
  amountFitsMethod,
  buildCreateOrderPayload,
  decidePaymentLaunch,
  feeAndTotal,
  getVisibleMethods,
  parseWechatResumeRoute,
  readPaymentRecoverySnapshot,
  subscriptionPaymentAmount
} from '../model'
import { buildAlipayDeepLink } from '../alipay-deep-link'

function limit(overrides: Partial<MethodLimit> = {}): MethodLimit {
  return {
    daily_limit: 0,
    daily_used: 0,
    daily_remaining: 0,
    single_min: 0,
    single_max: 0,
    fee_rate: 0,
    available: true,
    ...overrides
  }
}

function order(overrides: Partial<CreateOrderResult> = {}): CreateOrderResult {
  return {
    order_id: 101,
    amount: 20,
    pay_amount: 144,
    fee_rate: 2,
    expires_at: '2099-01-01T00:00:00Z',
    ...overrides
  }
}

describe('payment model', () => {
  it('normalizes aliases without dropping custom methods and prefers canonical limits', () => {
    const methods = getVisibleMethods({
      alipay_direct: limit({ single_min: 9 }),
      alipay: limit({ single_min: 2 }),
      wxpay_direct: limit({ single_max: 100 }),
      usdt_trc20: limit({ fee_rate: 1 })
    })
    expect(Object.keys(methods)).toEqual(['alipay', 'wxpay', 'usdt_trc20'])
    expect(methods.alipay!.single_min).toBe(2)
    expect(methods.usdt_trc20!.fee_rate).toBe(1)
  })

  it('validates single and daily method limits and calculates currency-aware totals', () => {
    const methods = { alipay: limit({ single_min: 5, single_max: 100, daily_remaining: 40 }) }
    expect(amountFitsMethod(4, 'alipay', methods)).toBe(false)
    expect(amountFitsMethod(30, 'alipay', methods)).toBe(true)
    expect(amountFitsMethod(60, 'alipay', methods)).toBe(false)
    expect(subscriptionPaymentAmount(9.9, 'CNY', 7.2)).toBe(71.28)
    expect(feeAndTotal(71.28, 1.5, 'CNY')).toEqual({ fee: 1.07, total: 72.35 })
  })

  it('builds the unchanged backend payload including mobile and WeChat source semantics', () => {
    expect(buildCreateOrderPayload({
      amount: 49,
      paymentType: 'wxpay_direct',
      orderType: 'subscription',
      planId: 301,
      origin: 'https://console.example.test/',
      isMobile: true,
      isWechatBrowser: true
    })).toEqual({
      amount: 49,
      payment_type: 'wxpay',
      order_type: 'subscription',
      plan_id: 301,
      is_mobile: true,
      payment_source: 'wechat_in_app_resume',
      return_url: 'https://console.example.test/payment/result'
    })
  })

  it('routes QR, redirect, Stripe, Airwallex, OAuth, and JSAPI results distinctly', () => {
    expect(decidePaymentLaunch(order({ qr_code: 'https://pay.test/qr' }), {
      visibleMethod: 'alipay', orderType: 'balance', isMobile: false, isWechatBrowser: false
    }).kind).toBe(PaymentLaunchKind.QR_WAITING)
    expect(decidePaymentLaunch(order({ pay_url: 'https://pay.test/hosted', payment_mode: 'popup' }), {
      visibleMethod: 'wxpay', orderType: 'balance', isMobile: false, isWechatBrowser: false
    }).kind).toBe(PaymentLaunchKind.REDIRECT_WAITING)
    expect(decidePaymentLaunch(order({ client_secret: 'cs_test' }), {
      visibleMethod: 'stripe', orderType: 'balance', isMobile: false, isWechatBrowser: false,
      stripeRouteUrl: '/payment/stripe?order_id=101'
    }).kind).toBe(PaymentLaunchKind.STRIPE_ROUTE)
    expect(decidePaymentLaunch(order({ client_secret: 'awx', intent_id: 'int_awx' }), {
      visibleMethod: 'airwallex', orderType: 'balance', isMobile: false, isWechatBrowser: false,
      airwallexRouteUrl: '/payment/airwallex?order_id=101'
    }).kind).toBe(PaymentLaunchKind.AIRWALLEX_ROUTE)
    expect(decidePaymentLaunch(order({ result_type: 'oauth_required', oauth: { authorize_url: '/wechat/start' } }), {
      visibleMethod: 'wxpay', orderType: 'balance', isMobile: true, isWechatBrowser: true
    }).kind).toBe(PaymentLaunchKind.WECHAT_OAUTH)
    expect(decidePaymentLaunch(order({ result_type: 'jsapi_ready', jsapi: { appId: 'wx1' } }), {
      visibleMethod: 'wxpay', orderType: 'balance', isMobile: true, isWechatBrowser: true
    }).kind).toBe(PaymentLaunchKind.WECHAT_JSAPI)
  })

  it('keeps mobile Alipay precreate separate from force-QR behavior', () => {
    const result = order({ qr_code: 'https://qr.alipay.test/101', alipay_mobile_precreate_deep_link: true })
    expect(decidePaymentLaunch(result, {
      visibleMethod: VisiblePaymentMethod.ALIPAY,
      orderType: 'balance',
      isMobile: true,
      isWechatBrowser: false,
      mobilePrecreateDeepLink: true
    }).kind).toBe(PaymentLaunchKind.ALIPAY_DEEP_LINK)
    expect(buildAlipayDeepLink('https://qr.alipay.test/101?name=A B')).toContain(encodeURIComponent('https://qr.alipay.test/101?name=A B'))
  })

  it('rejects expired or token-mismatched recovery snapshots', () => {
    const raw = JSON.stringify({
      orderId: 101, amount: 20, qrCode: 'qr', expiresAt: '2099-01-01T00:00:00Z', paymentType: 'alipay',
      payUrl: '', outTradeNo: 'trade-101', clientSecret: '', intentId: '', currency: 'CNY', countryCode: 'CN',
      paymentEnv: 'demo', payAmount: 144, orderType: 'balance', paymentMode: 'qrcode', resumeToken: 'resume-101',
      alipayMobilePrecreateDeepLink: false, createdAt: 1
    })
    expect(readPaymentRecoverySnapshot(raw, { resumeToken: 'resume-101', now: 1 })?.orderId).toBe(101)
    expect(readPaymentRecoverySnapshot(raw, { resumeToken: 'other', now: 1 })).toBeNull()
    expect(readPaymentRecoverySnapshot(raw, { now: Date.parse('2100-01-01') })).toBeNull()
  })

  it('recovers WeChat OAuth callbacks for balance, plans, and signed resume tokens', () => {
    const plans = [{ id: 301, price: 49 }] as SubscriptionPlan[]
    expect(parseWechatResumeRoute({
      wechat_resume: '1', openid: 'openid-1', payment_type: 'wxpay', order_type: 'subscription', plan_id: '301'
    }, plans, 20)).toEqual({
      openid: 'openid-1', paymentType: 'wxpay', orderType: 'subscription', orderAmount: 49, planId: 301
    })
    expect(parseWechatResumeRoute({
      wechat_resume_token: 'signed-resume', payment_type: 'wxpay', order_type: 'balance'
    }, plans, 20)).toEqual({
      wechatResumeToken: 'signed-resume', paymentType: 'wxpay', orderType: 'balance', orderAmount: 0, planId: undefined
    })
  })
})
