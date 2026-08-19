<script setup lang="ts">
import { ref, watch } from 'vue'
import * as groupsAPI from '@shared-api/admin/groups'
import type { AdminGroup } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean; groups: AdminGroup[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const app = useAppStore()
const rows = ref<AdminGroup[]>([])
const saving = ref(false)

function move(index: number, offset: number): void {
  const target = index + offset
  if (target < 0 || target >= rows.value.length) return
  const copy = [...rows.value]
  const [item] = copy.splice(index, 1)
  if (!item) return
  copy.splice(target, 0, item)
  rows.value = copy
}

async function save(): Promise<void> {
  saving.value = true
  try { await groupsAPI.updateSortOrder(rows.value.map((group, index) => ({ id: group.id, sort_order: index }))); app.showSuccess('分组排序已保存'); emit('saved'); emit('close') }
  catch (caught) { app.showError((caught as { message?: string }).message || '排序保存失败') }
  finally { saving.value = false }
}

watch(() => props.show, (show) => { if (show) rows.value = [...props.groups].sort((a, b) => a.sort_order - b.sort_order) })
</script>

<template>
  <SurfaceDialog :show="show" title="调整分组排序" description="该顺序同时影响管理列表和用户可见分组顺序。" :width="DialogWidth.STANDARD" @close="emit('close')">
    <ol class="sort-list"><li v-for="(group, index) in rows" :key="group.id"><span>{{ index + 1 }}</span><div><strong>{{ group.name }}</strong><small>{{ group.platform }}</small></div><button type="button" :disabled="index === 0" @click="move(index, -1)">↑</button><button type="button" :disabled="index === rows.length - 1" @click="move(index, 1)">↓</button></li></ol>
    <template #footer><button class="button button--secondary" @click="emit('close')">取消</button><button class="button button--primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存排序' }}</button></template>
  </SurfaceDialog>
</template>

<style scoped>.sort-list { margin: 0; padding: 0; display: grid; gap: 7px; list-style: none; }.sort-list li { padding: 11px; display: grid; grid-template-columns: 26px 1fr auto auto; align-items: center; gap: 8px; background: var(--surface-canvas); border-radius: 10px; }.sort-list li > span, .sort-list small { color: var(--text-secondary); font-size: var(--font-meta); }.sort-list div { display: grid; gap: 3px; }.sort-list button { width: 32px; height: 32px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; }</style>
