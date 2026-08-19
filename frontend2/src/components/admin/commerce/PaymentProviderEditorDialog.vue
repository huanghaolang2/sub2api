<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderInstance } from '@/types/payment'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { paymentMethodLabels, PaymentMethod } from '@/features/admin/commerce/model'
import {
  PAYMENT_PROVIDER_KEYS,
  PROVIDER_CALLBACK_PATHS,
  PROVIDER_CONFIG_FIELDS,
  PROVIDER_SUPPORTED_TYPES,
  PROVIDER_WEBHOOK_PATHS,
  STRIPE_SDK_API_VERSION,
  PaymentProviderKey,
  ProviderLimitField,
  ProviderPaymentMode,
  defaultProviderPaymentMode,
  extractCallbackBaseUrl,
  isPaymentProviderKey,
  normalizeProviderPaymentMode,
  parseEasyPayCustomMethods,
  providerSupportsPaymentMode,
  serializeEasyPayCustomMethods,
  type EasyPayCustomMethod,
  type ProviderConfigField
} from '@/features/admin/commerce/provider'
import { useAppStore } from '@/stores/app'

interface PaymentGuideItem { title: string; open: string; call: string; fallback: string }
interface PaymentGuide { summary: string; items: PaymentGuideItem[]; note?: string }
type ProviderLimits = Record<string, Partial<Record<ProviderLimitField, number>>>

const props = withDefaults(defineProps<{
  show: boolean
  provider: ProviderInstance | null
  saving: boolean
  enabledPaymentTypes?: string[]
}>(), { enabledPaymentTypes: () => [] })
const emit = defineEmits<{ close: []; submit: [payload: Partial<ProviderInstance>] }>()
const app = useAppStore()
const { t } = useI18n()

const form = reactive({
  providerKey: PaymentProviderKey.EASYPAY as string,
  name: '',
  supportedTypes: [] as string[],
  enabled: true,
  paymentMode: ProviderPaymentMode.QRCODE as string,
  refundEnabled: false,
  allowUserRefund: false,
  sortOrder: 0
})
const config = reactive<Record<string, string>>({})
const limits = reactive<ProviderLimits>({})
const customMethods = reactive<EasyPayCustomMethod[]>([])
const visibleSecrets = reactive<Record<string, boolean>>({})
const notifyBaseUrl = ref('')
const returnBaseUrl = ref('')
const limitsExpanded = ref(false)
const rawConfig = ref('{}')
const rawLimits = ref('')
const rawSupportedTypes = ref('')
const defaultBaseUrl = typeof window === 'undefined' ? '' : window.location.origin

const knownProviderKey = computed<PaymentProviderKey | null>(() => isPaymentProviderKey(form.providerKey) ? form.providerKey : null)
const providerKeyOptions = computed(() => {
  const enabled = new Set(props.enabledPaymentTypes)
  const keys = props.provider
    ? PAYMENT_PROVIDER_KEYS
    : PAYMENT_PROVIDER_KEYS.filter((key) => enabled.size === 0 || enabled.has(key))
  return keys.map((key) => ({ value: key, label: providerLabel(key) }))
})
const resolvedFields = computed(() => knownProviderKey.value
  ? PROVIDER_CONFIG_FIELDS[knownProviderKey.value].map((field) => ({ ...field, label: field.label || t(`admin.settings.payment.field_${field.key}`) }))
  : [])
const callbackPaths = computed(() => knownProviderKey.value ? PROVIDER_CALLBACK_PATHS[knownProviderKey.value] : null)
const supportsPaymentMode = computed(() => knownProviderKey.value ? providerSupportsPaymentMode(knownProviderKey.value) : false)
const paymentModeOptions = computed(() => knownProviderKey.value === PaymentProviderKey.ALIPAY
  ? [
      { value: ProviderPaymentMode.DEFAULT, label: t('admin.settings.payment.modeQRCode') },
      { value: ProviderPaymentMode.REDIRECT, label: t('admin.settings.payment.modeRedirect') }
    ]
  : [
      { value: ProviderPaymentMode.QRCODE, label: t('admin.settings.payment.modeQRCode') },
      { value: ProviderPaymentMode.POPUP, label: t('admin.settings.payment.modePopup') }
    ])
const availableTypes = computed(() => {
  if (!knownProviderKey.value) return []
  const options = PROVIDER_SUPPORTED_TYPES[knownProviderKey.value].map((value) => ({ value, label: paymentTypeLabel(value) }))
  if (knownProviderKey.value === PaymentProviderKey.EASYPAY) {
    normalizedCustomMethods().forEach((method) => {
      if (!options.some((item) => item.value === method.type)) options.push({ value: method.type, label: method.displayName || method.type })
    })
  }
  return options
})
const limitableTypes = computed(() => {
  if (knownProviderKey.value === PaymentProviderKey.STRIPE) return [{ value: 'stripe', label: 'Stripe' }]
  return form.supportedTypes.map((value) => ({ value, label: paymentTypeLabel(value) }))
})
const webhookUrl = computed(() => knownProviderKey.value && [PaymentProviderKey.STRIPE, PaymentProviderKey.AIRWALLEX].includes(knownProviderKey.value)
  ? `${defaultBaseUrl}${PROVIDER_WEBHOOK_PATHS[knownProviderKey.value]}`
  : '')
const paymentGuide = computed<PaymentGuide | null>(() => {
  if (knownProviderKey.value === PaymentProviderKey.ALIPAY) return buildGuide('alipay', ['FaceToFace', 'PagePay', 'Wap'])
  if (knownProviderKey.value === PaymentProviderKey.WXPAY) return buildGuide('wxpay', ['Native', 'Jsapi', 'H5'], true)
  if (knownProviderKey.value === PaymentProviderKey.AIRWALLEX) return { summary: t('admin.settings.payment.airwallexGuideSummary'), note: t('admin.settings.payment.airwallexGuideNote'), items: [] }
  return null
})

function providerLabel(key: PaymentProviderKey): string {
  const suffix = { [PaymentProviderKey.EASYPAY]: 'Easypay', [PaymentProviderKey.ALIPAY]: 'Alipay', [PaymentProviderKey.WXPAY]: 'Wxpay', [PaymentProviderKey.STRIPE]: 'Stripe', [PaymentProviderKey.AIRWALLEX]: 'Airwallex' }[key]
  return t(`admin.settings.payment.provider${suffix}`)
}

function paymentTypeLabel(value: string): string {
  return paymentMethodLabels[value as PaymentMethod] || t(`payment.methods.${value}`, value)
}

function buildGuide(prefix: 'alipay' | 'wxpay', names: string[], includeNote = false): PaymentGuide {
  return {
    summary: t(`admin.settings.payment.${prefix}GuideSummary`),
    note: includeNote ? t(`admin.settings.payment.${prefix}GuideNote`) : undefined,
    items: names.map((name) => ({
      title: t(`admin.settings.payment.${prefix}Guide${name}Title`),
      open: t(`admin.settings.payment.${prefix}Guide${name}Open`),
      call: t(`admin.settings.payment.${prefix}Guide${name}Call`),
      fallback: t(`admin.settings.payment.${prefix}Guide${name}Fallback`)
    }))
  }
}

function clearState(): void {
  Object.keys(config).forEach((key) => delete config[key])
  Object.keys(limits).forEach((key) => delete limits[key])
  Object.keys(visibleSecrets).forEach((key) => delete visibleSecrets[key])
  customMethods.splice(0)
  notifyBaseUrl.value = ''
  returnBaseUrl.value = ''
  limitsExpanded.value = false
  rawConfig.value = '{}'
  rawLimits.value = ''
  rawSupportedTypes.value = ''
}

function applyDefaults(key: PaymentProviderKey): void {
  PROVIDER_CONFIG_FIELDS[key].forEach((field) => {
    if (field.defaultValue && !config[field.key]) config[field.key] = field.defaultValue
  })
}

function resetForKey(key: string): void {
  clearState()
  form.providerKey = key
  if (!isPaymentProviderKey(key)) {
    form.supportedTypes = []
    form.paymentMode = ProviderPaymentMode.DEFAULT
    return
  }
  form.supportedTypes = [...PROVIDER_SUPPORTED_TYPES[key]]
  form.paymentMode = defaultProviderPaymentMode(key)
  applyDefaults(key)
}

function loadProvider(value: ProviderInstance): void {
  clearState()
  Object.assign(form, {
    providerKey: value.provider_key,
    name: value.name,
    supportedTypes: [...(value.supported_types || [])],
    enabled: value.enabled,
    paymentMode: value.payment_mode || '',
    refundEnabled: value.refund_enabled,
    allowUserRefund: value.allow_user_refund,
    sortOrder: value.sort_order || 0
  })
  if (!isPaymentProviderKey(value.provider_key)) {
    rawConfig.value = JSON.stringify(value.config || {}, null, 2)
    rawLimits.value = value.limits || ''
    rawSupportedTypes.value = (value.supported_types || []).join('\n')
    return
  }
  form.paymentMode = normalizeProviderPaymentMode(value.provider_key, value.payment_mode || '')
  Object.entries(value.config || {}).forEach(([key, fieldValue]) => {
    if (key === 'customMethods' && value.provider_key === PaymentProviderKey.EASYPAY) customMethods.push(...parseEasyPayCustomMethods(fieldValue))
    else if (!['notifyUrl', 'returnUrl'].includes(key)) config[key] = fieldValue
  })
  const paths = PROVIDER_CALLBACK_PATHS[value.provider_key]
  if (paths?.notifyUrl && value.config?.notifyUrl) notifyBaseUrl.value = extractCallbackBaseUrl(value.config.notifyUrl, paths.notifyUrl)
  if (paths?.returnUrl && value.config?.returnUrl) returnBaseUrl.value = extractCallbackBaseUrl(value.config.returnUrl, paths.returnUrl)
  applyDefaults(value.provider_key)
  if (value.limits) {
    try {
      const parsed = JSON.parse(value.limits) as ProviderLimits
      Object.entries(parsed).forEach(([type, fields]) => { limits[type] = { ...fields } })
      limitsExpanded.value = Object.keys(parsed).length > 0
    } catch { rawLimits.value = value.limits }
  }
}

watch(() => props.show, (show) => {
  if (!show) return
  Object.assign(form, { name: '', enabled: true, refundEnabled: false, allowUserRefund: false, sortOrder: 0 })
  if (props.provider) loadProvider(props.provider)
  else resetForKey(providerKeyOptions.value[0]?.value || PaymentProviderKey.EASYPAY)
})

function changeProviderKey(): void { resetForKey(form.providerKey) }
function toggleSupportedType(value: string): void {
  form.supportedTypes = form.supportedTypes.includes(value)
    ? form.supportedTypes.filter((item) => item !== value)
    : [...form.supportedTypes, value]
}
function addCustomMethod(): void { customMethods.push({ type: '', upstreamType: '', displayName: '' }) }
function removeCustomMethod(index: number): void { customMethods.splice(index, 1) }
function normalizedCustomMethods(): EasyPayCustomMethod[] {
  return customMethods.map((item) => ({ type: item.type.trim().toLowerCase(), upstreamType: item.upstreamType.trim().toLowerCase(), displayName: item.displayName.trim() })).filter((item) => item.type || item.upstreamType || item.displayName)
}

function syncAndValidateCustomMethods(): string | null {
  if (knownProviderKey.value !== PaymentProviderKey.EASYPAY) return null
  const reserved = new Set(PROVIDER_SUPPORTED_TYPES.easypay)
  const seen = new Set<string>()
  for (const method of normalizedCustomMethods()) {
    if (!method.type || !method.upstreamType) return t('admin.settings.payment.validationEasyPayCustomMethodRequired')
    if (!/^[a-z0-9_-]+$/.test(method.type)) return t('admin.settings.payment.validationEasyPayCustomMethodTypeInvalid')
    if (!/^[a-z0-9_-]+$/.test(method.upstreamType)) return t('admin.settings.payment.validationEasyPayCustomMethodUpstreamTypeInvalid')
    if (reserved.has(method.type)) return t('admin.settings.payment.validationEasyPayCustomMethodReserved')
    if (method.type.startsWith('alipay') || method.type.startsWith('wxpay')) return t('admin.settings.payment.validationEasyPayCustomMethodPrefixReserved')
    if (seen.has(method.type)) return t('admin.settings.payment.validationEasyPayCustomMethodDuplicate')
    seen.add(method.type)
  }
  const allowed = new Set([...reserved, ...seen])
  form.supportedTypes = form.supportedTypes.filter((value) => allowed.has(value))
  seen.forEach((value) => { if (!form.supportedTypes.includes(value)) form.supportedTypes.push(value) })
  return null
}

function setLimit(type: string, field: ProviderLimitField, raw: string): void {
  limits[type] ||= {}
  if (!raw.trim()) { delete limits[type][field]; return }
  const value = Number(raw)
  if (Number.isFinite(value) && value > 0) limits[type][field] = value
}
function limitValue(type: string, field: ProviderLimitField): string { return limits[type]?.[field] ? String(limits[type][field]) : '' }
function serializeLimits(): string {
  const result: ProviderLimits = {}
  Object.entries(limits).forEach(([type, fields]) => {
    const clean = Object.fromEntries(Object.entries(fields).filter(([, value]) => Number(value) > 0)) as Partial<Record<ProviderLimitField, number>>
    if (Object.keys(clean).length) result[type] = clean
  })
  return Object.keys(result).length ? JSON.stringify(result) : ''
}

function validateKnownProvider(key: PaymentProviderKey): string | null {
  const customError = syncAndValidateCustomMethods()
  if (customError) return customError
  if (!form.supportedTypes.length) return '至少选择一种支持的支付方式'
  for (const field of PROVIDER_CONFIG_FIELDS[key]) {
    if (field.optional || (props.provider && field.sensitive)) continue
    if (!String(config[field.key] || '').trim()) return t('admin.settings.payment.validationFieldRequired', { field: field.label || t(`admin.settings.payment.field_${field.key}`) })
  }
  for (const { value: type } of limitableTypes.value) {
    const min = limits[type]?.singleMin || 0
    const max = limits[type]?.singleMax || 0
    if (min && max && min > max) return `${paymentTypeLabel(type)}：单笔最大金额不能小于最小金额`
  }
  return null
}

function knownProviderPayload(key: PaymentProviderKey): Partial<ProviderInstance> {
  const clearable = new Set(PROVIDER_CONFIG_FIELDS[key].filter((field) => field.clearable).map((field) => field.key))
  const filteredConfig: Record<string, string> = {}
  Object.entries(config).forEach(([fieldKey, raw]) => {
    const value = String(raw || '')
    if (!value.trim()) {
      if (clearable.has(fieldKey)) filteredConfig[fieldKey] = ''
      return
    }
    filteredConfig[fieldKey] = value
  })
  if (key === PaymentProviderKey.EASYPAY) filteredConfig.customMethods = serializeEasyPayCustomMethods(normalizedCustomMethods())
  const paths = PROVIDER_CALLBACK_PATHS[key]
  if (paths?.notifyUrl) filteredConfig.notifyUrl = `${notifyBaseUrl.value.trim() || defaultBaseUrl}${paths.notifyUrl}`
  if (paths?.returnUrl) filteredConfig.returnUrl = `${returnBaseUrl.value.trim() || defaultBaseUrl}${paths.returnUrl}`
  return {
    provider_key: key,
    name: form.name.trim(),
    supported_types: [...form.supportedTypes],
    enabled: form.enabled,
    payment_mode: providerSupportsPaymentMode(key) ? form.paymentMode : ProviderPaymentMode.DEFAULT,
    refund_enabled: form.refundEnabled,
    allow_user_refund: form.refundEnabled ? form.allowUserRefund : false,
    config: filteredConfig,
    limits: serializeLimits(),
    sort_order: Number(form.sortOrder) || 0
  }
}

function submit(): void {
  try {
    if (!form.name.trim()) throw new Error('实例名称不能为空')
    if (!knownProviderKey.value) {
      const supportedTypes = [...new Set(rawSupportedTypes.value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]
      if (!supportedTypes.length) throw new Error('至少配置一种支持的支付方式')
      emit('submit', { provider_key: form.providerKey, name: form.name.trim(), supported_types: supportedTypes, enabled: form.enabled, payment_mode: form.paymentMode, refund_enabled: form.refundEnabled, allow_user_refund: form.refundEnabled ? form.allowUserRefund : false, config: JSON.parse(rawConfig.value || '{}') as Record<string, string>, limits: rawLimits.value.trim(), sort_order: Number(form.sortOrder) || 0 })
      return
    }
    const validationError = validateKnownProvider(knownProviderKey.value)
    if (validationError) throw new Error(validationError)
    emit('submit', knownProviderPayload(knownProviderKey.value))
  } catch (caught) { app.showError((caught as Error).message || 'Provider 配置不正确') }
}

function fieldAutocomplete(field: ProviderConfigField): string { return field.sensitive ? 'new-password' : 'off' }
</script>

<template>
  <SurfaceDialog :show="show" :title="provider ? '编辑 Provider' : '创建 Provider'" description="内置 Provider 使用结构化配置；敏感字段编辑时留空会保留现有值，未知扩展 Provider 仍可使用兼容编辑器。" :width="DialogWidth.WIDE" @close="emit('close')">
    <form id="payment-provider-form" class="resource-form-stack" @submit.prevent="submit">
      <fieldset class="resource-form-section"><legend>实例与能力</legend><div class="resource-form-grid resource-form-grid--3">
        <label>Provider 类型 *<select v-model="form.providerKey" :disabled="Boolean(provider)" @change="changeProviderKey"><option v-for="option in providerKeyOptions" :key="option.value" :value="option.value">{{ option.label }}</option><option v-if="provider && !knownProviderKey" :value="form.providerKey">{{ form.providerKey }}</option></select></label>
        <label>实例名称 *<input v-model="form.name" required /></label>
        <label>调度排序<input v-model.number="form.sortOrder" type="number" step="1" /></label>
        <label v-if="supportsPaymentMode">支付模式<select v-model="form.paymentMode"><option v-for="mode in paymentModeOptions" :key="mode.value" :value="mode.value">{{ mode.label }}</option></select></label>
        <label class="resource-check"><input v-model="form.enabled" type="checkbox" /><span>启用 Provider</span></label>
        <label class="resource-check"><input v-model="form.refundEnabled" type="checkbox" @change="!form.refundEnabled && (form.allowUserRefund = false)" /><span>支持管理员退款</span></label>
        <label v-if="form.refundEnabled" class="resource-check"><input v-model="form.allowUserRefund" type="checkbox" /><span>允许用户发起退款申请</span></label>
      </div></fieldset>

      <template v-if="knownProviderKey">
        <fieldset class="resource-form-section"><legend>支持的支付方式</legend><div class="provider-chip-grid"><label v-for="type in availableTypes" :key="type.value"><input type="checkbox" :checked="form.supportedTypes.includes(type.value)" @change="toggleSupportedType(type.value)" /><span>{{ type.label }}</span></label></div></fieldset>

        <fieldset v-if="knownProviderKey === PaymentProviderKey.EASYPAY" class="resource-form-section"><legend>EasyPay 自定义支付方式</legend><p class="muted">为上游私有支付代码提供稳定类型与展示名；保存时会自动并入支持方式。</p><div class="provider-custom-methods"><div v-for="(method, index) in customMethods" :key="index"><label>本地类型<input v-model="method.type" placeholder="credit_card" /></label><label>上游类型<input v-model="method.upstreamType" placeholder="credit_card" /></label><label>展示名称<input v-model="method.displayName" placeholder="信用卡" /></label><button type="button" class="resource-link resource-link--danger" @click="removeCustomMethod(index)">删除</button></div><button type="button" class="resource-button resource-button--secondary" @click="addCustomMethod">添加自定义方式</button></div></fieldset>

        <fieldset class="resource-form-section"><legend>Provider 凭据与地址</legend><details v-if="paymentGuide" class="provider-guide"><summary>{{ paymentGuide.summary }} <span>查看支付方式说明</span></summary><div><article v-for="item in paymentGuide.items" :key="item.title"><strong>{{ item.title }}</strong><p><b>打开：</b>{{ item.open }}</p><p><b>调用：</b>{{ item.call }}</p><p><b>降级：</b>{{ item.fallback }}</p></article><p v-if="paymentGuide.note">{{ paymentGuide.note }}</p></div></details><div class="resource-form-grid">
          <label v-for="field in resolvedFields" :key="field.key" :class="field.multiline && 'resource-field--wide'">{{ field.label }} {{ field.optional ? '（可选）' : '*' }}
            <textarea v-if="field.multiline" v-model="config[field.key]" rows="5" :autocomplete="fieldAutocomplete(field)" :placeholder="provider && field.sensitive ? '留空保留' : field.defaultValue || ''" spellcheck="false" />
            <select v-else-if="field.options" v-model="config[field.key]"><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            <span v-else-if="field.sensitive" class="provider-secret"><input v-model="config[field.key]" :type="visibleSecrets[field.key] ? 'text' : 'password'" :autocomplete="fieldAutocomplete(field)" :placeholder="provider ? '留空保留' : field.defaultValue || ''" /><button type="button" :aria-label="visibleSecrets[field.key] ? '隐藏密钥' : '显示密钥'" @click="visibleSecrets[field.key] = !visibleSecrets[field.key]">{{ visibleSecrets[field.key] ? '隐藏' : '显示' }}</button></span>
            <input v-else v-model="config[field.key]" :placeholder="field.defaultValue || ''" />
            <small v-if="field.hintKey">{{ t(field.hintKey) }}</small>
          </label>
          <label v-if="callbackPaths?.notifyUrl" class="resource-field--wide">异步通知地址 *<span class="provider-callback"><input v-model="notifyBaseUrl" type="url" :placeholder="defaultBaseUrl" /><code>{{ callbackPaths.notifyUrl }}</code></span></label>
          <label v-if="callbackPaths?.returnUrl" class="resource-field--wide">同步跳转地址 *<span class="provider-callback"><input v-model="returnBaseUrl" type="url" :placeholder="defaultBaseUrl" /><code>{{ callbackPaths.returnUrl }}</code></span></label>
        </div><aside v-if="webhookUrl" class="provider-webhook"><strong>Webhook 配置</strong><p>{{ knownProviderKey === PaymentProviderKey.STRIPE ? t('admin.settings.payment.stripeWebhookHint') : t('admin.settings.payment.airwallexWebhookHint') }}</p><code>{{ webhookUrl }}</code><p v-if="knownProviderKey === PaymentProviderKey.STRIPE">{{ t('admin.settings.payment.stripeWebhookApiVersionHint', { version: STRIPE_SDK_API_VERSION }) }}</p></aside></fieldset>

        <fieldset v-if="limitableTypes.length" class="resource-form-section"><legend><button type="button" class="provider-limits-toggle" :aria-expanded="limitsExpanded" @click="limitsExpanded = !limitsExpanded">分方式限额 <span>{{ limitsExpanded ? '收起' : '展开' }}</span></button></legend><div v-if="limitsExpanded" class="provider-limit-list"><article v-for="type in limitableTypes" :key="type.value"><strong>{{ type.label }}</strong><label>单笔最小<input type="number" min="0.01" step="0.01" :value="limitValue(type.value, ProviderLimitField.SINGLE_MIN)" @input="setLimit(type.value, ProviderLimitField.SINGLE_MIN, ($event.target as HTMLInputElement).value)" /></label><label>单笔最大<input type="number" min="0.01" step="0.01" :value="limitValue(type.value, ProviderLimitField.SINGLE_MAX)" @input="setLimit(type.value, ProviderLimitField.SINGLE_MAX, ($event.target as HTMLInputElement).value)" /></label><label>每日限额<input type="number" min="0.01" step="0.01" :value="limitValue(type.value, ProviderLimitField.DAILY_LIMIT)" @input="setLimit(type.value, ProviderLimitField.DAILY_LIMIT, ($event.target as HTMLInputElement).value)" /></label></article><p class="muted">整组留空时使用全局配置；只填写部分字段时，其余字段不限制。</p></div></fieldset>
      </template>

      <fieldset v-else class="resource-form-section"><legend>兼容扩展 Provider</legend><p class="notice notice--error">该 Provider 不属于内置五类。为保证已有实例仍可维护，这里保留原始契约编辑；新建实例请使用内置结构化类型。</p><label>支持的支付类型（每行一个）<textarea v-model="rawSupportedTypes" rows="5" /></label><label>Provider 配置 JSON<textarea v-model="rawConfig" rows="12" class="resource-code" spellcheck="false" /></label><label>限额 JSON<textarea v-model="rawLimits" rows="6" class="resource-code" spellcheck="false" /></label></fieldset>
    </form>
    <template #footer><button type="button" class="button button--secondary" @click="emit('close')">取消</button><button type="submit" form="payment-provider-form" class="button button--primary" :disabled="saving">{{ saving ? '保存中…' : '保存 Provider' }}</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.provider-chip-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.provider-chip-grid label { min-height: 38px; padding: 0 12px; display: inline-flex; align-items: center; gap: 7px; color: var(--text-secondary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; cursor: pointer; }
.provider-chip-grid input { width: 16px; height: 16px; accent-color: var(--accent); }
.provider-custom-methods { display: grid; gap: 9px; }
.provider-custom-methods > div { display: grid; grid-template-columns: repeat(3, 1fr) auto; align-items: end; gap: 8px; }
.provider-guide { margin-bottom: 16px; padding: 12px 14px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }
.provider-guide summary { color: var(--text-primary); cursor: pointer; font-size: var(--font-body-sm); font-weight: 680; line-height: 1.55; }
.provider-guide summary span { margin-left: 8px; color: var(--accent); font-size: var(--font-meta); }
.provider-guide > div { margin-top: 13px; display: grid; gap: 12px; }
.provider-guide article { padding-top: 11px; border-top: 1px solid var(--border-subtle); }
.provider-guide p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.6; }
.provider-guide b { color: var(--text-primary); }
.provider-secret, .provider-callback { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
.provider-secret input, .provider-callback input { border-radius: 9px 0 0 9px !important; }
.provider-secret button, .provider-callback code { min-width: 58px; padding: 0 10px; display: grid; place-items: center; color: var(--accent); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-left: 0; border-radius: 0 9px 9px 0; font-size: var(--font-meta); }
.provider-secret button { cursor: pointer; }
.provider-callback code { max-width: 320px; color: var(--text-secondary); overflow-wrap: anywhere; }
.provider-webhook { padding: 13px; display: grid; gap: 6px; background: var(--accent-soft); border-radius: 10px; }
.provider-webhook p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.55; }
.provider-webhook code { overflow-wrap: anywhere; font-size: var(--font-meta); }
.provider-limits-toggle { width: 100%; padding: 0; display: flex; justify-content: space-between; color: inherit; background: transparent; border: 0; cursor: pointer; font: inherit; }
.provider-limits-toggle span { color: var(--accent); font-size: var(--font-meta); }
.provider-limit-list { display: grid; gap: 9px; }
.provider-limit-list article { padding: 11px; display: grid; grid-template-columns: minmax(110px, 1fr) repeat(3, minmax(120px, 1fr)); align-items: end; gap: 8px; background: var(--surface-canvas); border-radius: 9px; }
.provider-limit-list article > strong { align-self: center; }
.provider-limit-list label { font-size: var(--font-meta); }
@media (max-width: 700px) { .provider-custom-methods > div, .provider-limit-list article { grid-template-columns: 1fr; }.provider-callback { grid-template-columns: 1fr; }.provider-callback input { border-radius: 9px 9px 0 0 !important; }.provider-callback code { max-width: none; min-height: 36px; border: 1px solid var(--border-subtle); border-top: 0; border-radius: 0 0 9px 9px; } }
</style>
