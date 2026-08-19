import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const frontend2Source = fileURLToPath(new URL('./src', import.meta.url))
const sharedFrontendSource = fileURLToPath(new URL('../frontend/src', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    dedupe: ['vue', 'pinia', 'vue-router', 'vue-i18n', 'axios'],
    alias: [
      { find: '@shared-api', replacement: `${sharedFrontendSource}/api` },
      { find: '@shared-stores', replacement: `${sharedFrontendSource}/stores` },
      { find: '@shared-composables', replacement: `${sharedFrontendSource}/composables` },
      { find: '@shared-i18n', replacement: `${sharedFrontendSource}/i18n` },
      { find: '@shared-utils', replacement: `${sharedFrontendSource}/utils` },
      { find: /^@\/utils\/tencentCaptcha$/, replacement: `${sharedFrontendSource}/utils/tencentCaptcha.ts` },
      { find: /^@\/api$/, replacement: `${sharedFrontendSource}/api/index.ts` },
      { find: /^@\/api\/(.*)$/, replacement: `${sharedFrontendSource}/api/$1` },
      { find: /^@\/types$/, replacement: `${sharedFrontendSource}/types/index.ts` },
      { find: /^@\/types\/payment$/, replacement: `${sharedFrontendSource}/types/payment.ts` },
      { find: /^@\/constants\/channel$/, replacement: `${sharedFrontendSource}/constants/channel.ts` },
      { find: /^@\/constants\/channelMonitor$/, replacement: `${sharedFrontendSource}/constants/channelMonitor.ts` },
      { find: 'vue-i18n', replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' },
      { find: '@', replacement: frontend2Source }
    ]
  },
  test: { environment: 'jsdom' }
})
