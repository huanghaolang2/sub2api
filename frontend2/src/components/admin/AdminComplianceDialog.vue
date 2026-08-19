<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getLocale, LocaleCode } from '@/i18n'
import { useModalInteraction } from '@/composables/useModalInteraction'
import { useAdminComplianceStore } from '@/stores/adminCompliance'
import { useAppStore } from '@/stores/app'

const compliance = useAdminComplianceStore()
const app = useAppStore()
const phrase = ref('')
const error = ref('')
const dialog = ref<HTMLElement | null>(null)
useModalInteraction(() => compliance.shouldShow, dialog)
const documentUrl = computed(() => getLocale() === LocaleCode.ZH
  ? compliance.status?.document_url_zh
  : compliance.status?.document_url_en)

async function accept(): Promise<void> {
  error.value = ''
  if (phrase.value.trim() !== compliance.expectedPhrase) {
    error.value = '确认短语不匹配，请完整输入页面显示的内容。'
    return
  }
  try {
    await compliance.accept(phrase.value.trim())
    phrase.value = ''
    app.showSuccess('合规承诺已记录')
  } catch (caught) {
    error.value = (caught as { message?: string }).message || '提交失败，请稍后重试。'
  }
}

watch(() => compliance.shouldShow, (visible) => {
  if (visible) error.value = ''
})
</script>

<template>
  <div v-if="compliance.shouldShow" class="compliance-backdrop" role="presentation">
    <section ref="dialog" class="compliance-dialog" role="dialog" aria-modal="true" aria-labelledby="compliance-title" tabindex="-1">
      <p class="eyebrow">ADMIN COMPLIANCE</p>
      <h2 id="compliance-title">管理员合规确认</h2>
      <p>继续使用管理能力前，请阅读部署与运营合规承诺，并输入下方完整短语。</p>
      <a v-if="documentUrl" :href="documentUrl" target="_blank" rel="noopener noreferrer">查看合规文档</a>
      <code>{{ compliance.expectedPhrase }}</code>
      <label>
        <span>确认短语</span>
        <textarea v-model="phrase" rows="3" :placeholder="compliance.expectedPhrase" />
      </label>
      <p v-if="error" class="compliance-error" role="alert">{{ error }}</p>
      <button type="button" class="button button--primary" :disabled="compliance.submitting" @click="accept">
        {{ compliance.submitting ? '提交中…' : '同意并继续' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.compliance-backdrop { position: fixed; z-index: 90; inset: 0; padding: 24px; display: grid; place-items: center; background: color-mix(in srgb, #08070d 72%, transparent); backdrop-filter: blur(8px); }
.compliance-dialog { width: min(560px, 100%); padding: clamp(24px, 4vw, 38px); color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 18px; box-shadow: 0 28px 70px rgba(7, 6, 12, .28); }
.compliance-dialog h2 { margin: 7px 0 12px; font-size: 28px; letter-spacing: -.035em; }
.compliance-dialog > p:not(.eyebrow, .compliance-error) { color: var(--text-secondary); line-height: 1.7; }
.compliance-dialog > a { display: inline-flex; margin: 8px 0 18px; color: var(--accent); font-size: 12px; font-weight: 680; }
.compliance-dialog code { padding: 12px 14px; display: block; background: var(--surface-canvas); border-radius: 9px; white-space: normal; }
.compliance-dialog label { margin-top: 18px; display: grid; gap: 7px; font-size: var(--font-body-sm); font-weight: 680; }
.compliance-dialog textarea { width: 100%; resize: vertical; }
.compliance-error { color: var(--danger); font-size: var(--font-body-sm); }
.compliance-dialog .button { margin-top: 16px; width: 100%; }
</style>
