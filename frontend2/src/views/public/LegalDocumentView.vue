<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { sanitizeUrl } from '@shared-utils/url'
import { useAppStore } from '@/stores/app'
import type { LoginAgreementDocument } from '@/types'
import zhAdminCompliance from '../../../../docs/legal/admin-compliance.zh.md?raw'
import enAdminCompliance from '../../../../docs/legal/admin-compliance.en.md?raw'

enum LegalDocumentKind {
  LOGIN_AGREEMENT = 'login_agreement',
  ADMIN_COMPLIANCE = 'admin_compliance'
}

const route = useRoute()
const { locale } = useI18n()
const app = useAppStore()
const loading = ref(!app.cachedPublicSettings)
const error = ref('')

marked.setOptions({ breaks: true, gfm: true })

const settings = computed(() => app.cachedPublicSettings)
const documentId = computed(() => String(route.params.documentId || ''))
const kind = computed(() => documentId.value === 'admin-compliance'
  ? LegalDocumentKind.ADMIN_COMPLIANCE
  : LegalDocumentKind.LOGIN_AGREEMENT)
const documents = computed(() => settings.value?.login_agreement_documents || [])
const current = computed<LoginAgreementDocument | null>(() => {
  if (kind.value === LegalDocumentKind.ADMIN_COMPLIANCE) {
    return {
      id: 'admin-compliance',
      title: locale.value.toLowerCase().startsWith('zh') ? '管理员合规确认' : 'Administrator Compliance Acknowledgement',
      content_md: locale.value.toLowerCase().startsWith('zh') ? zhAdminCompliance : enAdminCompliance
    }
  }
  return documents.value.find((item) => item.id === documentId.value) || null
})
const siteLogo = computed(() => sanitizeUrl(settings.value?.site_logo || '', { allowRelative: true, allowDataUrl: true }))
const updatedAt = computed(() => kind.value === LegalDocumentKind.ADMIN_COMPLIANCE
  ? ''
  : settings.value?.login_agreement_updated_at || '')
const label = computed(() => kind.value === LegalDocumentKind.ADMIN_COMPLIANCE ? '管理员合规' : '登录协议')
const symbol = computed(() => {
  const title = current.value?.title || ''
  if (/\u9690\u79c1|\u653f\u7b56|privacy|policy/i.test(title)) return '◈'
  if (/\u56fd\u5bb6|\u5730\u533a|region|country/i.test(title)) return '◎'
  return '§'
})
const rendered = computed(() => {
  const markdown = current.value?.content_md?.trim() || ''
  return markdown ? DOMPurify.sanitize(marked.parse(markdown) as string) : ''
})

async function initialize(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const value = await app.fetchPublicSettings()
    if (!value) error.value = '法律文档配置加载失败'
  } catch (caught) {
    error.value = (caught as { message?: string }).message || '法律文档配置加载失败'
  } finally { loading.value = false }
}

onMounted(() => { void initialize() })
</script>

<template>
  <div class="legal-public-shell">
    <div class="legal-page">
      <header class="legal-site-header">
        <RouterLink to="/" class="legal-brand"><span><img v-if="siteLogo" :src="siteLogo" alt=""><b v-else>S2</b></span><strong>{{ settings?.site_name || 'Sub2API' }}</strong></RouterLink>
        <RouterLink class="button button--secondary" to="/login">返回登录</RouterLink>
      </header>
      <main>
        <section v-if="loading" class="legal-state" role="status">正在加载文档…</section>
        <section v-else-if="error" class="legal-state legal-state--error" role="alert"><strong>文档加载失败</strong><span>{{ error }}</span><button class="button button--secondary" @click="initialize">重试</button></section>
        <section v-else-if="!current" class="legal-state"><strong>未找到法律文档</strong><span>文档可能已更名或未由管理员发布。</span></section>
        <article v-else class="legal-document">
          <header><div class="legal-symbol">{{ symbol }}</div><div><span>{{ label }}</span><h1>{{ current.title }}</h1><p v-if="updatedAt">更新时间：{{ updatedAt }}</p></div></header>
          <div v-if="rendered" class="legal-content" v-html="rendered" />
          <div v-else class="legal-empty">该文档当前没有内容。</div>
        </article>
      </main>
    </div>
  </div>
</template>

<style scoped>
.legal-public-shell { min-height: 100vh; color: var(--text-primary); background: var(--surface-canvas); }
.legal-page { width: min(1040px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 90px; }.legal-site-header { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }.legal-brand { display: flex; align-items: center; gap: 10px; }.legal-brand > span { width: 38px; height: 38px; display: grid; place-items: center; overflow: hidden; color: white; background: var(--text-primary); border-radius: 11px; font-size: var(--font-meta); }.legal-brand img { width: 100%; height: 100%; object-fit: contain; }.legal-brand strong { font-size: 14px; }.legal-page > main { margin-top: 60px; }.legal-state { min-height: 400px; display: grid; place-content: center; justify-items: center; gap: 9px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 18px; font-size: var(--font-meta); text-align: center; }.legal-state strong { color: var(--text-primary); font-size: 15px; }.legal-state--error strong { color: var(--danger); }.legal-document > header { padding-bottom: 30px; display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 18px; border-bottom: 1px solid var(--border-subtle); }.legal-symbol { width: 60px; height: 60px; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border-radius: 17px; font-size: 26px; }.legal-document header span { color: var(--accent); font-size: var(--font-meta); font-weight: 780; letter-spacing: .13em; text-transform: uppercase; }.legal-document h1 { margin: 8px 0 0; max-width: 800px; font-size: clamp(36px, 5vw, 62px); line-height: 1.05; letter-spacing: -.055em; }.legal-document header p { margin: 13px 0 0; color: var(--text-secondary); font-size: var(--font-meta); }.legal-content { width: min(820px, 100%); margin: 0 auto; padding-top: 48px; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }.legal-content :deep(h1), .legal-content :deep(h2), .legal-content :deep(h3), .legal-content :deep(h4) { letter-spacing: -.03em; }.legal-content :deep(h1) { margin: 0 0 24px; font-size: 32px; }.legal-content :deep(h2) { margin: 42px 0 14px; padding-top: 11px; border-top: 1px solid var(--border-subtle); font-size: 24px; }.legal-content :deep(h3) { margin: 30px 0 11px; font-size: 18px; }.legal-content :deep(p), .legal-content :deep(li) { color: var(--text-secondary); }.legal-content :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }.legal-content :deep(blockquote) { margin: 24px 0; padding: 12px 17px; background: var(--accent-soft); border-left: 3px solid var(--accent); }.legal-content :deep(code) { padding: 2px 5px; background: var(--surface-raised); border-radius: 4px; font-size: .9em; }.legal-content :deep(pre) { padding: 18px; overflow-x: auto; color: #f5f4f8; background: #17151e; border-radius: 10px; }.legal-content :deep(pre code) { padding: 0; background: transparent; }.legal-content :deep(table) { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; }.legal-content :deep(th), .legal-content :deep(td) { padding: 9px; border: 1px solid var(--border-subtle); text-align: left; }.legal-content :deep(img) { max-width: 100%; height: auto; border-radius: 10px; }.legal-empty { margin-top: 44px; padding: 60px; color: var(--text-secondary); background: var(--surface-raised); border: 1px dashed var(--border-strong); border-radius: 13px; font-size: var(--font-meta); text-align: center; }
@media (max-width: 620px) { .legal-page { width: min(100% - 28px, 1040px); }.legal-page > main { margin-top: 40px; }.legal-document > header { grid-template-columns: 1fr; }.legal-symbol { width: 50px; height: 50px; }.legal-content { padding-top: 34px; } }
</style>
