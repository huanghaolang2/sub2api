<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { totpAPI } from '@/api'
import type { StepUpController } from '@/composables/useStepUp'
import { useModalInteraction } from '@/composables/useModalInteraction'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ controller: StepUpController }>()
const app = useAppStore()
const code = ref('')
const verifying = ref(false)
const input = ref<HTMLInputElement | null>(null)
const dialog = ref<HTMLElement | null>(null)

useModalInteraction(
  () => props.controller.visible.value,
  dialog,
  () => props.controller.onCancel(),
  () => input.value
)

watch(() => props.controller.visible.value, async (visible) => {
  if (!visible) return
  code.value = ''
  await nextTick()
  input.value?.focus()
})

async function verify(): Promise<void> {
  const value = code.value.replace(/\D/g, '').slice(0, 6)
  if (value.length !== 6 || verifying.value) return
  verifying.value = true
  try {
    await totpAPI.stepUp(value)
    code.value = ''
    props.controller.onVerified()
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '验证失败，请检查动态验证码。')
    code.value = ''
    await nextTick()
    input.value?.focus()
  } finally {
    verifying.value = false
  }
}

function normalize(): void {
  code.value = code.value.replace(/\D/g, '').slice(0, 6)
  if (code.value.length === 6) void verify()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="controller.visible.value" class="step-up-backdrop" role="presentation">
      <section ref="dialog" role="dialog" aria-modal="true" aria-labelledby="step-up-title" class="step-up-dialog" tabindex="-1">
        <span aria-hidden="true">2FA</span>
        <h2 id="step-up-title">管理员二次验证</h2>
        <p>这是敏感权限操作。请输入当前管理员账户的 6 位动态验证码，验证通过后会自动重试。</p>
        <label>
          <span>动态验证码</span>
          <input
            ref="input"
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            pattern="[0-9]*"
            placeholder="000000"
            :disabled="verifying"
            @input="normalize"
            @keyup.enter="verify"
          >
        </label>
        <footer>
          <button type="button" class="button button--secondary" :disabled="verifying" @click="controller.onCancel">取消</button>
          <button type="button" class="button button--primary" :disabled="verifying || code.length !== 6" @click="verify">
            {{ verifying ? '验证中…' : '验证并继续' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.step-up-backdrop { position: fixed; z-index: 125; inset: 0; padding: 24px; display: grid; place-items: center; background: color-mix(in srgb, #08070d 70%, transparent); backdrop-filter: blur(8px); }
.step-up-dialog { width: min(440px, 100%); padding: 30px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 18px; box-shadow: 0 28px 78px rgba(7, 6, 12, .3); }
.step-up-dialog > span { width: 42px; height: 42px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 12px; font-size: var(--font-meta); font-weight: 850; }
.step-up-dialog h2 { margin: 18px 0 10px; font-size: 25px; letter-spacing: -.035em; }
.step-up-dialog p { color: var(--text-secondary); font-size: 12px; line-height: 1.7; }
.step-up-dialog label { margin-top: 20px; display: grid; gap: 8px; color: var(--text-secondary); font-size: var(--font-body-sm); }
.step-up-dialog input { min-height: 56px; padding: 0 16px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 12px; font-size: 22px; font-weight: 760; letter-spacing: .28em; text-align: center; }
.step-up-dialog footer { margin-top: 22px; display: flex; justify-content: flex-end; gap: 9px; }
</style>
