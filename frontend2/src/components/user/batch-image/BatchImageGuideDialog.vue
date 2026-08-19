<script setup lang="ts">
import { computed } from 'vue'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ show: boolean; endpointBase: string }>()
defineEmits<{ close: [] }>()
const app = useAppStore()

const instruction = computed(() => `---
name: sub2api-batch-image
description: 当用户希望用 Gemini 或 Vertex 批量生成图片、批量跑提示词、下载结果或重试失败图片时使用。
---

你是批量生图执行 Agent。请从聊天、附件或文件中整理任务名称、Prompt 清单和输出目录；只有缺少关键决策时才询问用户。

端点：${props.endpointBase}

执行要求：
1. 通过 GET ${props.endpointBase}/v1/images/batches/models 获取当前 Key 可用模型。
2. 为每条 Prompt 生成稳定且唯一的 custom_id，例如 img_001。
3. output_count 默认 1、每条最多 4；提交前计算预计输出总数，单任务最多 200 张，超过必须拆分。
4. Gemini 2.5 Flash Image 每条最多 3 张参考图；Gemini 3 Pro Image 每条最多 14 张。参考图很多或总体积较大时主动拆分任务。
5. 参考图随 output_count 重复消耗上游输入 Token；大量复用时优先使用 gs:// file_uri 或拆分任务。
6. 提交 POST ${props.endpointBase}/v1/images/batches，并设置 Idempotency-Key。
7. 查询 GET ${props.endpointBase}/v1/images/batches/{id}；明细 GET ${props.endpointBase}/v1/images/batches/{id}/items。
8. 下载 GET ${props.endpointBase}/v1/images/batches/{id}/download；取消 POST ${props.endpointBase}/v1/images/batches/{id}/cancel。
9. 只下载成功图片。部分失败时先报告 custom_id、错误码、错误来源和原因；重试只能提交失败项，不能重复成功项。
10. 取消前提醒：已被系统索引为成功的图片仍会结算，其余冻结金额会释放。

提交体：
{
  "model": "<所选 Key 支持的模型>",
  "task_name": "<任务名>",
  "image_size": "1K",
  "response_mime_type": "image/png",
  "items": [
    {
      "custom_id": "img_001",
      "prompt": "<完整 Prompt>",
      "output_count": 1,
      "reference_images": [
        {
          "id": "subject",
          "type": "reference",
          "mime_type": "image/png",
          "data": "<base64，不含 data URL 前缀>"
        }
      ]
    }
  ]
}

安全与恢复：
- 不要把 API Key、参考图 base64 写入仓库、日志、提交记录或最终回复。
- 提交后在用户输出目录保存 batch-image-resume.json，不保存 API Key。
- 恢复记录至少包含 endpoint、task_name、batch_id、model、output_dir、request_file、submitted_at、last_status、status_url、items_url、download_url、prompt_count、expected_output_count，以及 custom_id 到 Prompt 的映射或请求文件路径。
- 每次查询后更新 last_checked_at、last_status、成功数、失败数、实际扣费和失败摘要。
- 首次查询等待约 20–30 秒；queued 每 60–120 秒；running 每约 60 秒；processing_results 每 20–45 秒。连续 3 次仍 queued 时暂停主动查询并保留恢复记录。
- 完成后报告任务名、任务 ID、成功数、失败数、实际扣费和保存路径。`)

async function copyInstruction(): Promise<void> {
  try {
    await navigator.clipboard.writeText(instruction.value)
    app.showSuccess('Agent 执行说明已复制。')
  } catch {
    app.showError('复制失败，请在文本框中手动全选复制。')
  }
}
</script>

<template>
  <SurfaceDialog :show="show" title="批量图片使用指南" description="页面操作与 Agent 自动执行遵循同一套 API 和限制。" :width="DialogWidth.WIDE" @close="$emit('close')">
    <div class="guide-content">
      <section><strong>页面操作</strong><ol><li>选择已授权的 Gemini API Key，页面会实时加载该 Key 可用模型。</li><li>逐条添加 Prompt、输出数量和参考图，确认预计输出不超过 200 张。</li><li>提交后在任务列表查看状态；进入详情可刷新、取消、预览、下载或仅重试失败项。</li><li>批量勾选已完成任务可下载 ZIP；终态任务可批量删除记录。</li></ol></section>
      <section><header><div><strong>Agent 自动执行说明</strong><span>不包含任何真实 API Key</span></div><button type="button" class="button button--secondary" @click="copyInstruction">复制完整说明</button></header><textarea :value="instruction" readonly aria-label="Agent 批量图片执行说明"></textarea></section>
    </div>
    <template #footer><button type="button" class="button button--secondary" @click="$emit('close')">关闭</button><button type="button" class="button button--primary" @click="copyInstruction">复制完整说明</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.guide-content { display: grid; gap: 15px; }.guide-content > section { padding: 13px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }.guide-content > section > strong { font-size: var(--font-meta); }.guide-content ol { margin: 9px 0 0; padding-left: 18px; color: var(--text-secondary); font-size: var(--font-meta); line-height: 1.8; }.guide-content section header { margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }.guide-content header div { display: grid; gap: 4px; }.guide-content header strong { font-size: var(--font-meta); }.guide-content header span { color: var(--text-secondary); font-size: var(--font-caption); }.guide-content textarea { width: 100%; min-height: 420px; padding: 12px; resize: vertical; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 8px; font: var(--font-meta)/1.65 var(--font-mono); }
</style>
