import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

const frontend2Source = fileURLToPath(new URL('./src', import.meta.url))
const sharedFrontendSource = fileURLToPath(new URL('../frontend/src', import.meta.url))

const sharedAliases = [
  { find: '@shared-api', replacement: `${sharedFrontendSource}/api` },
  { find: '@shared-stores', replacement: `${sharedFrontendSource}/stores` },
  { find: '@shared-composables', replacement: `${sharedFrontendSource}/composables` },
  { find: '@shared-i18n', replacement: `${sharedFrontendSource}/i18n` },
  { find: '@shared-utils', replacement: `${sharedFrontendSource}/utils` },
  { find: '@shared-prompt-audit', replacement: `${sharedFrontendSource}/features/prompt-audit` },
  { find: /^@\/utils\/tencentCaptcha$/, replacement: `${sharedFrontendSource}/utils/tencentCaptcha.ts` },
  { find: /^@\/api$/, replacement: `${sharedFrontendSource}/api/index.ts` },
  { find: /^@\/api\/(.*)$/, replacement: `${sharedFrontendSource}/api/$1` },
  { find: /^@\/types$/, replacement: `${sharedFrontendSource}/types/index.ts` },
  { find: /^@\/types\/payment$/, replacement: `${sharedFrontendSource}/types/payment.ts` },
  { find: /^@\/constants\/channel$/, replacement: `${sharedFrontendSource}/constants/channel.ts` },
  { find: /^@\/constants\/channelMonitor$/, replacement: `${sharedFrontendSource}/constants/channelMonitor.ts` },
  { find: '@', replacement: frontend2Source }
]

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The comparison workspace serves the existing full application (and its API)
  // on 13001. Keep frontend2 on the same data source by default; standalone
  // backend development can still override this with VITE_DEV_PROXY_TARGET.
  const backend = env.VITE_DEV_PROXY_TARGET || 'http://localhost:13001'

  return {
    plugins: [vue()],
    resolve: {
      dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n', 'axios'],
      alias: [
        ...sharedAliases,
        {
          find: 'vue-i18n',
          replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js'
        }
      ]
    },
    define: { __INTLIFY_JIT_COMPILATION__: true },
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_DEV_PORT || 3002),
      fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/v1': { target: backend, changeOrigin: true },
        '/setup/': { target: backend, changeOrigin: true }
      }
    }
  }
})
