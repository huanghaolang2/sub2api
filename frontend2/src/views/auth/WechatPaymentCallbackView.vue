<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/base/AppButton.vue'
import PublicShell from '@/components/layout/PublicShell.vue'
import {
  parseWechatPaymentFragment,
  resolveWechatPaymentCallback,
  WechatPaymentCallbackState
} from '@/features/user/payment/wechat-callback'

const route = useRoute()
const router = useRouter()
const state = ref(WechatPaymentCallbackState.PROCESSING)
const error = ref('')

async function processCallback(): Promise<void> {
  const result = resolveWechatPaymentCallback({
    fragment: parseWechatPaymentFragment(window.location.hash),
    query: route.query,
    origin: window.location.origin
  })
  state.value = result.state
  error.value = result.error || ''
  if (result.target) await router.replace(result.target)
}

function backToPayment(): void {
  void router.replace('/app/purchase')
}

onMounted(() => { void processCallback() })
</script>

<template>
  <PublicShell>
    <section class="auth-panel auth-panel--form callback-panel" aria-live="polite">
      <p class="eyebrow">WECHAT PAY</p>
      <h1>{{ state === WechatPaymentCallbackState.ERROR ? '支付恢复失败' : '正在恢复支付' }}</h1>
      <template v-if="state === WechatPaymentCallbackState.ERROR">
        <p class="form-error" role="alert">{{ error }}</p>
        <AppButton type="button" @click="backToPayment">返回购买与充值</AppButton>
      </template>
      <template v-else>
        <p>正在校验微信授权结果并恢复订单上下文，请稍候。</p>
        <div class="callback-loader" role="status" aria-label="正在处理">
          <span></span><span></span><span></span>
        </div>
      </template>
    </section>
  </PublicShell>
</template>

<style scoped>
.callback-panel { max-width: 640px; }
.callback-panel .form-error { margin: 28px 0 22px; }
.callback-loader { display: flex; gap: 8px; margin-top: 32px; }
.callback-loader span { width: 10px; height: 10px; background: var(--accent); border-radius: 999px; animation: callback-pulse 1.1s infinite ease-in-out; }
.callback-loader span:nth-child(2) { animation-delay: .15s; }
.callback-loader span:nth-child(3) { animation-delay: .3s; }
@keyframes callback-pulse { 0%, 70%, 100% { opacity: .28; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-5px); } }
@media (prefers-reduced-motion: reduce) { .callback-loader span { animation: none; opacity: .75; } }
</style>
