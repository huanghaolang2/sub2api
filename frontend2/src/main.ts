import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { i18n, initI18n } from './i18n'
import { router } from './router'
import { useAppStore } from './stores/app'
import './styles/index.css'

async function bootstrap(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  useAppStore().initFromInjectedConfig()
  await initI18n()
  app.use(i18n)
  app.use(router)
  app.mount('#app')
}

void bootstrap()
