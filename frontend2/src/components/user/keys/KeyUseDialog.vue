<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GroupPlatform } from '@/types'
import SurfaceDialog from '@/components/base/SurfaceDialog.vue'
import { DialogWidth } from '@/components/base/dialog'
import { CodexAuthMode, KeyClient, ShellMode } from '@/features/user/keys/model'
import { useAppStore } from '@/stores/app'

interface ConfigFile {
  path: string
  content: string
  hint?: string
}

const props = defineProps<{
  show: boolean
  apiKey: string
  baseUrl: string
  platform: GroupPlatform | null
  allowMessagesDispatch: boolean
}>()
const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const client = ref(KeyClient.CLAUDE_CODE)
const shell = ref(ShellMode.UNIX)
const codexAuthMode = ref(CodexAuthMode.LEGACY)
const copiedIndex = ref<number | null>(null)

const normalizedRoot = computed(() => (props.baseUrl || window.location.origin).replace(/\/+$/, '').replace(/\/v1$/, ''))
const clients = computed(() => {
  switch (props.platform) {
    case 'openai': return [KeyClient.CODEX, KeyClient.CODEX_WS, ...(props.allowMessagesDispatch ? [KeyClient.CLAUDE_CODE] : []), KeyClient.OPENCODE]
    case 'gemini': return [KeyClient.GEMINI_CLI, KeyClient.OPENCODE]
    case 'antigravity': return [KeyClient.CLAUDE_CODE, KeyClient.GEMINI_CLI, KeyClient.OPENCODE]
    case 'grok': return [KeyClient.GROK_CLI, KeyClient.CLAUDE_CODE, KeyClient.CODEX, KeyClient.OPENCODE]
    default: return [KeyClient.CLAUDE_CODE, KeyClient.OPENCODE]
  }
})
const shells = computed(() => client.value === KeyClient.CODEX || client.value === KeyClient.CODEX_WS
  ? [ShellMode.UNIX, ShellMode.WINDOWS]
  : [ShellMode.UNIX, ShellMode.CMD, ShellMode.POWERSHELL])

const clientLabels: Record<KeyClient, string> = {
  [KeyClient.CLAUDE_CODE]: 'Claude Code',
  [KeyClient.CODEX]: 'Codex CLI',
  [KeyClient.CODEX_WS]: 'Codex CLI · WebSocket',
  [KeyClient.GEMINI_CLI]: 'Gemini CLI',
  [KeyClient.GROK_CLI]: 'Grok CLI',
  [KeyClient.OPENCODE]: 'OpenCode'
}
const shellLabels: Record<ShellMode, string> = {
  [ShellMode.UNIX]: 'macOS / Linux',
  [ShellMode.WINDOWS]: 'Windows',
  [ShellMode.CMD]: 'Windows CMD',
  [ShellMode.POWERSHELL]: 'PowerShell'
}

function withVersion(root: string, suffix: string): string {
  return `${root.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

function shellEnvironment(entries: Record<string, string>): ConfigFile[] {
  const pairs = Object.entries(entries)
  if (shell.value === ShellMode.CMD) {
    return [{ path: 'Windows CMD', content: pairs.map(([key, value]) => `set ${key}=${value}`).join('\n') }]
  }
  if (shell.value === ShellMode.POWERSHELL || shell.value === ShellMode.WINDOWS) {
    return [{ path: 'PowerShell', content: pairs.map(([key, value]) => `$env:${key}="${value}"`).join('\n') }]
  }
  return [{ path: '~/.zshrc 或当前终端', content: pairs.map(([key, value]) => `export ${key}="${value}"`).join('\n') }]
}

function openCodeConfig(provider: string, baseURL: string): ConfigFile {
  return {
    path: 'opencode.json',
    content: JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        sub2api: {
          npm: provider,
          name: 'Sub2API',
          options: { baseURL, apiKey: props.apiKey }
        }
      }
    }, null, 2)
  }
}

const files = computed<ConfigFile[]>(() => {
  const root = normalizedRoot.value
  if (client.value === KeyClient.OPENCODE) {
    if (props.platform === 'gemini') return [openCodeConfig('@ai-sdk/google', withVersion(root, 'v1beta'))]
    if (props.platform === 'antigravity') return [
      openCodeConfig('@ai-sdk/anthropic', withVersion(root, 'antigravity/v1')),
      { ...openCodeConfig('@ai-sdk/google', withVersion(root, 'antigravity/v1beta')), path: 'opencode.gemini.json' }
    ]
    return [openCodeConfig(props.platform === 'openai' || props.platform === 'grok' ? '@ai-sdk/openai' : '@ai-sdk/anthropic', withVersion(root, 'v1'))]
  }
  if (client.value === KeyClient.CODEX || client.value === KeyClient.CODEX_WS) {
    const config = [
      'model_provider = "sub2api"',
      'model = "gpt-5"',
      '',
      '[model_providers.sub2api]',
      'name = "Sub2API"',
      `base_url = "${withVersion(root, 'v1')}"`,
      'wire_api = "responses"',
      'requires_openai_auth = true'
    ]
    if (client.value === KeyClient.CODEX_WS) config.push('', '[features]', 'responses_websockets = true')
    const auth = codexAuthMode.value === CodexAuthMode.API_KEY
      ? shellEnvironment({ OPENAI_API_KEY: props.apiKey })
      : [{ path: shell.value === ShellMode.WINDOWS ? '%USERPROFILE%\\.codex\\auth.json' : '~/.codex/auth.json', content: JSON.stringify({ OPENAI_API_KEY: props.apiKey }, null, 2) }]
    return [
      { path: shell.value === ShellMode.WINDOWS ? '%USERPROFILE%\\.codex\\config.toml' : '~/.codex/config.toml', content: config.join('\n') },
      ...auth
    ]
  }
  if (client.value === KeyClient.GEMINI_CLI) {
    const base = props.platform === 'antigravity' ? withVersion(root, 'antigravity/v1beta') : withVersion(root, 'v1beta')
    return shellEnvironment({ GEMINI_API_KEY: props.apiKey, GOOGLE_GEMINI_BASE_URL: base })
  }
  if (client.value === KeyClient.GROK_CLI) {
    return shellEnvironment({ GROK_API_KEY: props.apiKey, GROK_BASE_URL: withVersion(root, 'v1') })
  }
  const base = props.platform === 'antigravity' ? withVersion(root, 'antigravity/v1') : withVersion(root, 'v1')
  return shellEnvironment({ ANTHROPIC_AUTH_TOKEN: props.apiKey, ANTHROPIC_BASE_URL: base })
})

const description = computed(() => {
  if (!props.platform) return '请先为 Key 选择分组，系统才能给出对应平台的接入配置。'
  return `以下配置已按 ${props.platform} 平台和 ${clientLabels[client.value]} 生成。复制后重新启动对应客户端。`
})

async function copyFile(file: ConfigFile, index: number): Promise<void> {
  try {
    await navigator.clipboard.writeText(file.content)
    copiedIndex.value = index
    app.showSuccess('配置已复制')
    window.setTimeout(() => { if (copiedIndex.value === index) copiedIndex.value = null }, 1200)
  } catch {
    app.showError('复制失败，请手动选择配置内容')
  }
}

watch(() => [props.show, props.platform] as const, ([show]) => {
  if (!show) return
  client.value = clients.value[0] ?? KeyClient.CLAUDE_CODE
  shell.value = ShellMode.UNIX
  codexAuthMode.value = CodexAuthMode.LEGACY
  copiedIndex.value = null
}, { immediate: true })

watch(client, () => {
  shell.value = ShellMode.UNIX
  codexAuthMode.value = CodexAuthMode.LEGACY
})
</script>

<template>
  <SurfaceDialog :show="show" title="使用 API Key" :description="description" :width="DialogWidth.WIDE" @close="emit('close')">
    <div v-if="!platform" class="key-warning"><strong>尚未绑定访问分组</strong><p>关闭本窗口，在 Key 列表中选择分组后再查看接入指引。</p></div>
    <div v-else class="use-workspace">
      <nav class="client-tabs" aria-label="客户端类型"><button v-for="item in clients" :key="item" type="button" :class="{ active: client === item }" @click="client = item">{{ clientLabels[item] }}</button></nav>
      <div v-if="client === KeyClient.CODEX || client === KeyClient.CODEX_WS" class="auth-mode">
        <div><strong>Codex 鉴权方式</strong><small>选择客户端读取 Key 的位置。</small></div>
        <button type="button" :class="{ active: codexAuthMode === CodexAuthMode.LEGACY }" @click="codexAuthMode = CodexAuthMode.LEGACY">auth.json</button>
        <button type="button" :class="{ active: codexAuthMode === CodexAuthMode.API_KEY }" @click="codexAuthMode = CodexAuthMode.API_KEY">环境变量</button>
      </div>
      <nav v-if="client !== KeyClient.OPENCODE" class="shell-tabs" aria-label="操作系统"><button v-for="item in shells" :key="item" type="button" :class="{ active: shell === item }" @click="shell = item">{{ shellLabels[item] }}</button></nav>
      <div class="config-stack">
        <article v-for="(file, index) in files" :key="`${file.path}-${index}`">
          <header><div><strong>{{ file.path }}</strong><small v-if="file.hint">{{ file.hint }}</small></div><button type="button" @click="copyFile(file, index)">{{ copiedIndex === index ? '已复制' : '复制' }}</button></header>
          <pre><code>{{ file.content }}</code></pre>
        </article>
      </div>
      <p v-if="codexAuthMode === CodexAuthMode.API_KEY && (client === KeyClient.CODEX || client === KeyClient.CODEX_WS)" class="restart-note">修改环境变量后需完全退出并重新启动 Codex CLI。</p>
    </div>
    <template #footer><button type="button" class="button button--secondary" @click="emit('close')">关闭</button></template>
  </SurfaceDialog>
</template>

<style scoped>
.key-warning { padding: 18px; color: #8a5a00; background: #fff8df; border: 1px solid #f0d98a; border-radius: 12px; }
.key-warning p { margin: 7px 0 0; font-size: var(--font-body-sm); }
.use-workspace { display: grid; gap: 15px; }
.client-tabs, .shell-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--border-subtle); }
.client-tabs button, .shell-tabs button { min-height: 40px; padding: 0 12px; flex: 0 0 auto; color: var(--text-secondary); background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; font-size: var(--font-meta); }
.client-tabs button.active, .shell-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
.auth-mode { padding: 11px; display: flex; align-items: center; gap: 6px; background: var(--surface-canvas); border: 1px solid var(--border-subtle); border-radius: 10px; }
.auth-mode > div { margin-right: auto; display: grid; gap: 2px; }
.auth-mode strong { font-size: var(--font-body-sm); }.auth-mode small { color: var(--text-secondary); font-size: var(--font-meta); }
.auth-mode button { min-height: 34px; padding: 0 9px; color: var(--text-secondary); background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; }
.auth-mode button.active { color: var(--accent); border-color: var(--accent); }
.config-stack { display: grid; gap: 10px; }
.config-stack article { overflow: hidden; color: #eef1f7; background: #11131a; border: 1px solid #292d39; border-radius: 12px; }
.config-stack header { min-height: 43px; padding: 0 13px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #191c25; border-bottom: 1px solid #292d39; }
.config-stack header > div { min-width: 0; display: grid; gap: 2px; }
.config-stack header strong { overflow: hidden; color: #aeb6c8; font: 600 var(--font-meta)/1.2 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.config-stack header small { color: #777f92; font-size: var(--font-meta); }
.config-stack header button { min-height: 28px; padding: 0 9px; color: #dfe5f2; background: #292d39; border: 0; border-radius: 6px; cursor: pointer; }
.config-stack pre { max-height: 280px; margin: 0; padding: 15px; overflow: auto; font: var(--font-meta)/1.7 var(--font-mono); white-space: pre; }
.restart-note { margin: 0; padding: 9px 11px; color: #8a5a00; background: #fff8df; border-left: 3px solid #d29b18; border-radius: 5px; font-size: var(--font-meta); }
@media (max-width: 620px) { .auth-mode { align-items: stretch; flex-wrap: wrap; }.auth-mode > div { width: 100%; }.auth-mode button { flex: 1; } }
</style>
