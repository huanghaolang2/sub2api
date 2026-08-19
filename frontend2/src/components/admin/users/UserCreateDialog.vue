<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import * as groupsAPI from '@shared-api/admin/groups'
import * as usersAPI from '@shared-api/admin/users'
import type { AdminGroup } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog.vue'
import {
  isStepUpBlocked,
  isStepUpCancelled,
  stepUpBlockReason,
  useStepUp
} from '@/composables/useStepUp'
import { AdminUserRole } from '@/features/admin/users/model'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: []; created: [] }>()
const app = useAppStore()
const stepUp = useStepUp()
const groups = ref<AdminGroup[]>([])
const submitting = ref(false)
const loadingGroups = ref(false)

const form = reactive({
  email: '',
  password: '',
  username: '',
  notes: '',
  role: AdminUserRole.USER,
  balance: '' as string | number,
  concurrency: 1,
  rpmLimit: 0,
  allowedGroups: [] as number[]
})

function reset(): void {
  Object.assign(form, {
    email: '', password: '', username: '', notes: '', role: AdminUserRole.USER,
    balance: '', concurrency: 1, rpmLimit: 0, allowedGroups: []
  })
}

function generatePassword(): void {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*'
  const random = new Uint32Array(16)
  crypto.getRandomValues(random)
  form.password = Array.from(random, (value) => alphabet[value % alphabet.length]).join('')
}

function toggleGroup(id: number): void {
  form.allowedGroups = form.allowedGroups.includes(id)
    ? form.allowedGroups.filter((groupId) => groupId !== id)
    : [...form.allowedGroups, id]
}

async function loadGroups(): Promise<void> {
  loadingGroups.value = true
  try {
    groups.value = (await groupsAPI.getAll()).filter((group) =>
      group.status === 'active' && group.subscription_type === 'standard' && group.is_exclusive
    )
  } catch (caught) {
    app.showError((caught as { message?: string }).message || '授权分组加载失败')
  } finally {
    loadingGroups.value = false
  }
}

async function submit(): Promise<void> {
  if (submitting.value) return
  if (!form.email.trim() || !form.password) {
    app.showError('邮箱和初始密码不能为空')
    return
  }
  if (!Number.isInteger(form.concurrency) || form.concurrency < 1 || !Number.isInteger(form.rpmLimit) || form.rpmLimit < 0) {
    app.showError('并发必须至少为 1，RPM 必须为非负整数')
    return
  }
  const rawBalance = String(form.balance).trim()
  const payload: Parameters<typeof usersAPI.create>[0] = {
    email: form.email.trim(),
    password: form.password,
    username: form.username.trim() || undefined,
    notes: form.notes.trim() || undefined,
    role: form.role,
    concurrency: form.concurrency,
    rpm_limit: form.rpmLimit,
    allowed_groups: [...form.allowedGroups]
  }
  if (rawBalance !== '') payload.balance = Number(rawBalance)
  if (payload.balance != null && !Number.isFinite(payload.balance)) {
    app.showError('初始余额格式不正确')
    return
  }

  submitting.value = true
  try {
    await stepUp.run(() => usersAPI.create(payload))
    app.showSuccess('用户已创建')
    emit('created')
    emit('close')
  } catch (caught) {
    if (isStepUpCancelled(caught)) return
    if (isStepUpBlocked(caught)) {
      app.showError(stepUpBlockReason(caught) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'
        ? '管理员 API Key 无法完成二次验证，请使用管理员会话。'
        : '当前管理员尚未启用 TOTP，无法完成敏感权限操作。')
      return
    }
    app.showError((caught as { message?: string }).message || '创建用户失败')
  } finally {
    submitting.value = false
  }
}

watch(() => props.show, (show) => {
  if (!show) return
  reset()
  generatePassword()
  void loadGroups()
})
</script>

<template>
  <SurfaceDialog
    :show="show"
    title="创建用户"
    description="创建后可继续配置专属倍率、平台限额与 API Key 归属。"
    :width="DialogWidth.WIDE"
    @close="emit('close')"
  >
    <form id="create-admin-user-form" class="user-form-grid" @submit.prevent="submit">
      <label class="field field--wide"><span>邮箱 *</span><input v-model="form.email" required type="email" autocomplete="off" placeholder="name@example.com"></label>
      <label class="field field--wide"><span>初始密码 *</span><div class="field-inline"><input v-model="form.password" required type="text" autocomplete="off"><button type="button" class="mini-button" @click="generatePassword">重新生成</button></div><small>仅在当前表单展示，请通过安全渠道交付给用户。</small></label>
      <label class="field"><span>用户名</span><input v-model="form.username" maxlength="64" placeholder="可选"></label>
      <label class="field"><span>角色</span><select v-model="form.role"><option :value="AdminUserRole.USER">普通用户</option><option :value="AdminUserRole.ADMIN">管理员</option></select></label>
      <label class="field"><span>初始余额（USD）</span><input v-model="form.balance" type="number" step="any" placeholder="0.00"></label>
      <label class="field"><span>并发上限</span><input v-model.number="form.concurrency" required type="number" min="1" step="1"></label>
      <label class="field"><span>RPM 上限</span><input v-model.number="form.rpmLimit" type="number" min="0" step="1"><small>0 表示不限。</small></label>
      <label class="field field--wide"><span>管理员备注</span><textarea v-model="form.notes" rows="3" maxlength="1000" placeholder="仅管理员可见"></textarea></label>
      <fieldset class="field-group field--wide">
        <legend>初始专属分组</legend>
        <p v-if="loadingGroups">正在加载分组…</p>
        <p v-else-if="groups.length === 0">暂无可选专属分组，创建后仍可在用户工作台配置。</p>
        <div v-else class="choice-grid">
          <label v-for="group in groups" :key="group.id"><input type="checkbox" :checked="form.allowedGroups.includes(group.id)" @change="toggleGroup(group.id)"><span><strong>{{ group.name }}</strong><small>{{ group.platform }} · 默认 {{ group.rate_multiplier }}×</small></span></label>
        </div>
      </fieldset>
    </form>
    <template #footer>
      <button type="button" class="button button--secondary" @click="emit('close')">取消</button>
      <button type="submit" form="create-admin-user-form" class="button button--primary" :disabled="submitting">{{ submitting ? '创建中…' : '创建用户' }}</button>
    </template>
  </SurfaceDialog>
  <TotpStepUpDialog :controller="stepUp" />
</template>

<style scoped>
.user-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.field { display: grid; align-content: start; gap: 7px; color: var(--text-secondary); font-size: var(--font-body-sm); font-weight: 650; }
.field--wide { grid-column: 1 / -1; }
.field input, .field select, .field textarea { width: 100%; min-height: 44px; padding: 0 12px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }
.field textarea { padding-block: 11px; resize: vertical; }
.field small, .field-group p { margin: 0; color: var(--text-secondary); font-size: var(--font-meta); font-weight: 500; line-height: 1.5; }
.field-inline { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.mini-button { min-height: 44px; padding: 0 12px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; }
.field-group { margin: 0; padding: 16px; border: 1px solid var(--border-subtle); border-radius: 12px; }
.field-group legend { padding: 0 7px; font-size: var(--font-body-sm); font-weight: 700; }
.choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.choice-grid label { padding: 10px; display: flex; align-items: flex-start; gap: 9px; background: var(--surface-canvas); border-radius: 9px; cursor: pointer; }
.choice-grid label span { display: grid; gap: 3px; }
.choice-grid strong { font-size: var(--font-body-sm); }
.choice-grid small { color: var(--text-secondary); font-size: var(--font-meta); }
@media (max-width: 660px) { .user-form-grid, .choice-grid { grid-template-columns: 1fr; } .field--wide { grid-column: auto; } }
</style>
