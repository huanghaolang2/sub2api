<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { resetPassword } from '@/api/auth'
import PublicAuthLayout from '@/components/auth/PublicAuthLayout.vue'
import { useAppStore } from '@/stores/app'
import { passwordValidationMessage } from '@/features/public/model'

const route = useRoute()
const app = useAppStore()
const email = computed(() => typeof route.query.email === 'string' ? route.query.email : '')
const token = computed(() => typeof route.query.token === 'string' ? route.query.token : '')
const invalid = computed(() => !email.value || !token.value)
const form = reactive({ password: '', confirmation: '' })
const submitting = ref(false)
const success = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  error.value = ''
  const validation = passwordValidationMessage(form.password, form.confirmation)
  if (validation) { error.value = validation; return }
  submitting.value = true
  try {
    await resetPassword({ email: email.value, token: token.value, new_password: form.password })
    success.value = true; app.showSuccess('密码已重置')
  } catch (caught) {
    const value = caught as { message?: string; response?: { data?: { detail?: string; code?: string } } }
    error.value = value.response?.data?.code === 'INVALID_RESET_TOKEN' ? '重置链接无效或已过期，请重新申请' : (value.response?.data?.detail || value.message || '密码重置失败')
  } finally { submitting.value = false }
}
</script>

<template>
  <PublicAuthLayout eyebrow="RESET PASSWORD" title="设置新密码" description="链接仅可使用一次。完成后，旧密码和已经使用的重置令牌都会立即失效。" compact>
    <div v-if="invalid" class="public-state-inline public-state-inline--warning"><strong>重置链接不完整</strong><span>链接缺少邮箱或安全令牌，可能已被截断。</span><RouterLink class="button button--primary" to="/forgot-password">重新申请</RouterLink></div>
    <div v-else-if="success" class="public-state-inline public-state-inline--success"><strong>密码重置成功</strong><span>现在可以使用新密码登录。</span><RouterLink class="button button--primary" to="/login">前往登录</RouterLink></div>
    <form v-else class="public-form-stack" @submit.prevent="submit">
      <label>账号邮箱<input :value="email" type="email" disabled /></label>
      <label>新密码<input v-model="form.password" type="password" autocomplete="new-password" required /></label>
      <label>确认新密码<input v-model="form.confirmation" type="password" autocomplete="new-password" required /></label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button--primary" :disabled="submitting" type="submit">{{ submitting ? '重置中…' : '确认重置密码' }}</button>
    </form>
    <template #footer><RouterLink to="/login">返回登录</RouterLink></template>
  </PublicAuthLayout>
</template>
