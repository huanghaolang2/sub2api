import { describe, expect, it } from 'vitest'
import {
  parseWechatPaymentFragment,
  resolveWechatPaymentCallback,
  WechatPaymentCallbackState
} from '../wechat-callback'

function resolve(hash: string, query: Record<string, unknown> = {}) {
  return resolveWechatPaymentCallback({
    fragment: parseWechatPaymentFragment(hash),
    query,
    origin: 'http://localhost:13002'
  })
}

describe('wechat payment callback', () => {
  it('uses an opaque fragment resume token before query values and keeps safe query context', () => {
    const result = resolve(
      '#wechat_resume_token=fragment-token&redirect=%2Fpurchase%3Ffrom%3Dwechat',
      { wechat_resume_token: 'query-token' }
    )
    expect(result).toEqual({
      state: WechatPaymentCallbackState.PROCESSING,
      target: {
        path: '/app/purchase',
        query: { from: 'wechat', wechat_resume: '1', wechat_resume_token: 'fragment-token' }
      }
    })
  })

  it('preserves the complete legacy openid payload', () => {
    const result = resolve(
      '#openid=o-123&state=s-123&scope=snsapi_base&payment_type=wxpay_direct&amount=128&order_type=subscription&plan_id=7&redirect=%2Fpayment%3Fcampaign%3Dsummer'
    )
    expect(result.target).toEqual({
      path: '/app/purchase',
      query: {
        campaign: 'summer',
        wechat_resume: '1',
        openid: 'o-123',
        state: 's-123',
        scope: 'snsapi_base',
        payment_type: 'wxpay_direct',
        amount: '128',
        order_type: 'subscription',
        plan_id: '7'
      }
    })
  })

  it('blocks external redirects and exposes provider and missing-context errors', () => {
    expect(resolve('#wechat_resume_token=ok&redirect=https%3A%2F%2Fevil.example').target?.path)
      .toBe('/app/purchase')
    expect(resolve('#error=access_denied&error_description=User%20cancelled')).toEqual({
      state: WechatPaymentCallbackState.ERROR,
      error: 'User cancelled'
    })
    expect(resolve('#payment_type=wxpay').error).toContain('缺少恢复令牌')
  })
})
