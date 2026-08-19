<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import * as groupsAPI from '@shared-api/admin/groups'
import * as usersAPI from '@shared-api/admin/users'
import type { AdminGroup, AdminUser } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { ConfirmTone, useConfirmStore } from '@/stores/confirm'
import { useAppStore } from '@/stores/app'
import { GroupOverrideMode } from '@/features/admin/resources/model'

const props = defineProps<{ show: boolean; group: AdminGroup | null; mode: GroupOverrideMode }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const app = useAppStore()
const confirm = useConfirmStore()
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const rows = ref<groupsAPI.GroupRateMultiplierEntry[]>([])
const values = ref<Record<number, string | number>>({})
const userSearch = ref('')
const userResults = ref<AdminUser[]>([])
const userSearching = ref(false)
const newValue = ref('')
const batchFactor = ref('')
let userSearchTimer: number | null = null
let userSearchRequest = 0
const title = computed(() => `${props.mode === GroupOverrideMode.RATE ? '用户专属倍率' : '用户 RPM 覆盖'} · ${props.group?.name || ''}`)
const filtered = computed(() => rows.value.filter((row) => `${row.user_name} ${row.user_email} ${row.user_notes}`.toLowerCase().includes(search.value.toLowerCase())))

async function load(): Promise<void> {
  if (!props.group) return
  loading.value = true
  try {
    rows.value = props.mode === GroupOverrideMode.RATE
      ? (await groupsAPI.getGroupRateMultipliers(props.group.id)).filter((row) => row.rate_multiplier != null)
      : await groupsAPI.getGroupRPMOverrides(props.group.id)
    values.value = Object.fromEntries(rows.value.map((row) => [row.user_id, String(props.mode === GroupOverrideMode.RATE ? row.rate_multiplier ?? '' : row.rpm_override ?? '')]))
  } catch (caught) { app.showError((caught as { message?: string }).message || '用户覆盖值加载失败') }
  finally { loading.value = false }
}

function searchUsersLater(): void {
  if (userSearchTimer) window.clearTimeout(userSearchTimer)
  const request = ++userSearchRequest
  const query = userSearch.value.trim()
  if (!query) {
    userResults.value = []
    userSearching.value = false
    return
  }
  userSearchTimer = window.setTimeout(async () => {
    userSearching.value = true
    try {
      const response = await usersAPI.list(1, 10, { search: query })
      if (request !== userSearchRequest || !props.show) return
      userResults.value = response.items.filter((user) => !rows.value.some((row) => row.user_id === user.id))
    } catch (caught) {
      if (request !== userSearchRequest) return
      app.showError((caught as { message?: string }).message || '用户搜索失败')
      userResults.value = []
    } finally {
      if (request === userSearchRequest) userSearching.value = false
    }
  }, 280)
}

function addUser(user: AdminUser): void {
  const value = Number(newValue.value)
  if (!Number.isFinite(value) || value < 0 || (props.mode === GroupOverrideMode.RATE && value === 0) || (props.mode === GroupOverrideMode.RPM && !Number.isInteger(value))) {
    app.showError(props.mode === GroupOverrideMode.RATE ? '专属倍率必须大于 0' : 'RPM 覆盖必须是非负整数')
    return
  }
  const normalized = value
  rows.value.push({
    user_id: user.id,
    user_name: user.username || '',
    user_email: user.email,
    user_notes: user.notes || '',
    user_status: user.status,
    rate_multiplier: props.mode === GroupOverrideMode.RATE ? normalized : null,
    rpm_override: props.mode === GroupOverrideMode.RPM ? normalized : null
  })
  values.value = { ...values.value, [user.id]: String(normalized) }
  userSearch.value = ''
  userResults.value = []
  newValue.value = ''
}

function removeUser(userId: number): void {
  rows.value = rows.value.filter((row) => row.user_id !== userId)
  const next = { ...values.value }
  delete next[userId]
  values.value = next
}

function applyBatchFactor(): void {
  const factor = Number(batchFactor.value)
  if (!Number.isFinite(factor) || factor <= 0) {
    app.showError('批量乘数必须大于 0')
    return
  }
  values.value = Object.fromEntries(Object.entries(values.value).map(([userId, value]) => [userId, String(Number((Number(value) * factor).toFixed(6)))]))
  batchFactor.value = ''
}

async function save(): Promise<void> {
  if (!props.group || saving.value) return
  const entries = Object.entries(values.value)
    .filter(([, value]) => String(value).trim() !== '')
    .map(([userId, value]) => ({ user_id: Number(userId), value: Number(value) }))
  if (props.mode === GroupOverrideMode.RATE && entries.some((entry) => !Number.isFinite(entry.value) || entry.value <= 0)) {
    app.showError('专属倍率必须大于 0')
    return
  }
  if (props.mode === GroupOverrideMode.RPM && entries.some((entry) => !Number.isFinite(entry.value) || entry.value < 0 || !Number.isInteger(entry.value))) {
    app.showError('RPM 覆盖必须是非负整数')
    return
  }
  saving.value = true
  try {
    if (props.mode === GroupOverrideMode.RATE) await groupsAPI.batchSetGroupRateMultipliers(props.group.id, entries.map((item) => ({ user_id: item.user_id, rate_multiplier: item.value })))
    else await groupsAPI.batchSetGroupRPMOverrides(props.group.id, entries.map((item) => ({ user_id: item.user_id, rpm_override: item.value })))
    app.showSuccess('用户覆盖值已保存'); emit('saved'); await load()
  } catch (caught) { app.showError((caught as { message?: string }).message || '保存失败') }
  finally { saving.value = false }
}

async function clearAll(): Promise<void> {
  if (!props.group || !await confirm.ask({ title: '清空全部覆盖值', message: `这会清空 ${props.group.name} 的全部${props.mode === GroupOverrideMode.RATE ? '专属倍率' : ' RPM 覆盖'}，另一类覆盖值不受影响。`, confirmText: '清空', tone: ConfirmTone.DANGER })) return
  try {
    if (props.mode === GroupOverrideMode.RATE) await groupsAPI.clearGroupRateMultipliers(props.group.id)
    else await groupsAPI.clearGroupRPMOverrides(props.group.id)
    app.showSuccess('覆盖值已清空'); await load()
  } catch (caught) { app.showError((caught as { message?: string }).message || '清空失败') }
}

watch([() => props.show, () => props.mode], ([show]) => {
  userSearchRequest += 1
  if (userSearchTimer) {
    window.clearTimeout(userSearchTimer)
    userSearchTimer = null
  }
  userSearching.value = false
  if (!show) return
  search.value = ''
  userSearch.value = ''
  userResults.value = []
  newValue.value = ''
  batchFactor.value = ''
  void load()
})
onBeforeUnmount(() => { if (userSearchTimer) window.clearTimeout(userSearchTimer) })
</script>

<template>
  <SurfaceDialog :show="show" :title="title" description="留空表示使用分组或用户默认值；保存只修改当前类型，不覆盖另一类设置。" :width="DialogWidth.WIDE" @close="emit('close')">
    <div class="resource-form-stack">
      <fieldset class="resource-form-section">
        <legend>添加用户覆盖</legend>
        <div class="override-add-grid">
          <label>搜索用户<input v-model="userSearch" type="search" placeholder="邮箱、用户名或 ID" @input="searchUsersLater" /></label>
          <label>{{ mode === GroupOverrideMode.RATE ? '专属倍率' : 'RPM 覆盖' }}<input v-model="newValue" type="number" :min="mode === GroupOverrideMode.RATE ? '0.000001' : '0'" :step="mode === GroupOverrideMode.RATE ? 'any' : '1'" /></label>
        </div>
        <div v-if="userSearching" class="muted">正在搜索用户…</div>
        <div v-else-if="userResults.length" class="override-user-results">
          <button v-for="user in userResults" :key="user.id" type="button" @click="addUser(user)">
            <strong>{{ user.username || user.email }}</strong><span>{{ user.email }} · #{{ user.id }}</span>
          </button>
        </div>
        <p v-else-if="userSearch.trim()" class="muted">没有可添加的匹配用户。</p>
      </fieldset>
      <fieldset v-if="mode === GroupOverrideMode.RATE && rows.length" class="resource-form-section">
        <legend>批量调整</legend>
        <div class="resource-inline-actions"><label class="batch-factor">当前倍率 × <input v-model="batchFactor" type="number" min="0" step="any" placeholder="例如 0.9" /></label><button type="button" class="resource-button resource-button--secondary" @click="applyBatchFactor">应用到当前列表</button></div>
      </fieldset>
      <div class="resource-toolbar"><input v-model="search" type="search" placeholder="搜索姓名、邮箱或备注" /><div class="resource-toolbar__actions"><button class="resource-button resource-button--danger" type="button" @click="clearAll">清空全部</button><button class="resource-button" type="button" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存全部' }}</button></div></div>
      <div class="resource-table"><table><thead><tr><th>用户</th><th>状态</th><th>{{ mode === GroupOverrideMode.RATE ? '专属倍率' : 'RPM 覆盖' }}</th><th>操作</th></tr></thead><tbody>
        <tr v-if="loading"><td colspan="4">加载中…</td></tr><tr v-else-if="filtered.length === 0"><td colspan="4">没有匹配用户</td></tr>
        <tr v-for="row in filtered" :key="row.user_id"><td><strong>{{ row.user_name || row.user_email }}</strong><small>{{ row.user_email }} · {{ row.user_notes || '无备注' }}</small></td><td>{{ row.user_status }}</td><td><input v-model="values[row.user_id]" type="number" :min="mode === GroupOverrideMode.RATE ? '0.000001' : '0'" :step="mode === GroupOverrideMode.RATE ? 'any' : '1'" placeholder="使用默认值" /></td><td><button type="button" class="resource-link resource-link--danger" @click="removeUser(row.user_id)">移除</button></td></tr>
      </tbody></table></div>
    </div>
  </SurfaceDialog>
</template>

<style scoped>
.override-add-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(150px, 1fr); gap: 10px; }
.override-user-results { max-height: 200px; overflow: auto; display: grid; gap: 6px; }
.override-user-results button { padding: 9px 11px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--text-primary); background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 9px; cursor: pointer; text-align: left; }
.override-user-results button:hover { border-color: var(--accent); }
.override-user-results span { color: var(--text-secondary); font-size: var(--font-body-sm); }
.batch-factor { display: inline-flex; align-items: center; gap: 7px; }
.batch-factor input { width: 130px; }
@media (max-width: 650px) { .override-add-grid { grid-template-columns: 1fr; } .override-user-results button { align-items: flex-start; flex-direction: column; } }
</style>
