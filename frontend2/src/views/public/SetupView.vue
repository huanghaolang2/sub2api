<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getSetupStatus, install, testDatabase, testRedis, type InstallRequest } from '@/api/setup'
import PublicShell from '@/components/layout/PublicShell.vue'
import { useAppStore } from '@/stores/app'
import { DatabaseSSLMode, ServerRunMode, SetupWizardStep, emailIsValid } from '@/features/public/model'

const router = useRouter()
const app = useAppStore()
const steps = [
  { id: SetupWizardStep.DATABASE, label: '数据库' },
  { id: SetupWizardStep.REDIS, label: 'Redis' },
  { id: SetupWizardStep.ADMIN, label: '管理员' },
  { id: SetupWizardStep.REVIEW, label: '确认安装' },
]
const activeStep = ref(SetupWizardStep.DATABASE)
const checking = ref(true)
const testing = ref('')
const installing = ref(false)
const completed = ref(false)
const pollingRestart = ref(false)
const serviceReady = ref(false)
const error = ref('')
const confirmPassword = ref('')
const databaseVerified = ref(false)
const redisVerified = ref(false)
let readinessAttempts = 0
let readinessTimer: number | null = null

function currentPort(): number {
  const port = Number.parseInt(window.location.port, 10)
  if (Number.isFinite(port) && port > 0) return port
  return window.location.protocol === 'https:' ? 443 : 80
}

const form = reactive<InstallRequest>({
  database: { host: 'localhost', port: 5432, user: 'postgres', password: '', dbname: 'sub2api', sslmode: DatabaseSSLMode.DISABLE },
  redis: { host: 'localhost', port: 6379, username: '', password: '', db: 0, enable_tls: false },
  admin: { email: '', password: '' },
  server: { host: '0.0.0.0', port: currentPort(), mode: ServerRunMode.RELEASE },
})

const activeIndex = computed(() => steps.findIndex((step) => step.id === activeStep.value))
const adminError = computed(() => {
  if (!emailIsValid(form.admin.email)) return '请输入有效的管理员邮箱'
  if (form.admin.password.length < 8) return '管理员密码至少需要 8 位'
  if (form.admin.password.length > 128) return '管理员密码不能超过 128 位'
  if (form.admin.password !== confirmPassword.value) return '两次输入的密码不一致'
  return ''
})

function previous(): void {
  const item = steps[activeIndex.value - 1]
  if (item) activeStep.value = item.id
}

function next(): void {
  error.value = ''
  if (activeStep.value === SetupWizardStep.DATABASE && !databaseVerified.value) { error.value = '请先通过数据库连接测试'; return }
  if (activeStep.value === SetupWizardStep.REDIS && !redisVerified.value) { error.value = '请先通过 Redis 连接测试'; return }
  if (activeStep.value === SetupWizardStep.ADMIN && adminError.value) { error.value = adminError.value; return }
  const item = steps[activeIndex.value + 1]
  if (item) activeStep.value = item.id
}

async function checkStatus(): Promise<void> {
  checking.value = true
  error.value = ''
  try {
    const status = await getSetupStatus()
    if (!status.needs_setup) await router.replace('/login')
  } catch (caught) {
    error.value = (caught as { message?: string }).message || '无法确认安装状态，可以继续填写后重试'
  } finally { checking.value = false }
}

async function verifyDatabase(): Promise<void> {
  testing.value = 'database'; error.value = ''; databaseVerified.value = false
  try { await testDatabase({ ...form.database }); databaseVerified.value = true; app.showSuccess('数据库连接成功') }
  catch (caught) { error.value = (caught as { message?: string }).message || '数据库连接失败' }
  finally { testing.value = '' }
}

async function verifyRedis(): Promise<void> {
  testing.value = 'redis'; error.value = ''; redisVerified.value = false
  try { await testRedis({ ...form.redis }); redisVerified.value = true; app.showSuccess('Redis 连接成功') }
  catch (caught) { error.value = (caught as { message?: string }).message || 'Redis 连接失败' }
  finally { testing.value = '' }
}

async function performInstall(): Promise<void> {
  if (adminError.value) { error.value = adminError.value; return }
  installing.value = true; error.value = ''
  try {
    await install(JSON.parse(JSON.stringify(form)) as InstallRequest)
    completed.value = true
    app.showSuccess('安装配置已写入，服务正在启动')
    startReadinessPolling()
  } catch (caught) { error.value = (caught as { message?: string }).message || '安装失败，请检查配置后重试' }
  finally { installing.value = false }
}

function scheduleReadinessCheck(delay = 1000): void {
  if (readinessTimer) window.clearTimeout(readinessTimer)
  readinessTimer = window.setTimeout(() => { void pollServiceReadiness() }, delay)
}

function scheduleLoginRedirect(delay = 1200): void {
  if (readinessTimer) window.clearTimeout(readinessTimer)
  readinessTimer = window.setTimeout(() => { void router.replace('/login') }, delay)
}

function startReadinessPolling(): void {
  readinessAttempts = 0
  serviceReady.value = false
  pollingRestart.value = true
  scheduleReadinessCheck(1500)
}

async function pollServiceReadiness(): Promise<void> {
  readinessAttempts += 1
  try {
    const status = await getSetupStatus()
    if (!status.needs_setup) {
      pollingRestart.value = false
      serviceReady.value = true
      scheduleLoginRedirect()
      return
    }
  } catch {
    // A short connection failure is expected while the installed service restarts.
  }
  if (readinessAttempts >= 60) {
    pollingRestart.value = false
    error.value = '服务尚未恢复，请确认进程已重启后再检查状态'
    return
  }
  scheduleReadinessCheck()
}

onMounted(checkStatus)
onBeforeUnmount(() => { if (readinessTimer) window.clearTimeout(readinessTimer) })
</script>

<template>
  <PublicShell>
    <main class="setup-workspace">
      <header class="setup-heading"><div><p class="eyebrow">FIRST RUN</p><h1>初始化 Sub2API</h1><p>分步验证基础设施，再一次性创建管理员与运行配置。任何失败都停留在当前步骤。</p></div><span>{{ activeIndex + 1 }} / {{ steps.length }}</span></header>
      <nav class="setup-steps" aria-label="安装步骤"><button v-for="(step, index) in steps" :key="step.id" :aria-current="activeStep === step.id ? 'step' : undefined" :disabled="index > activeIndex" @click="activeStep = step.id"><span>{{ index + 1 }}</span>{{ step.label }}</button></nav>

      <section v-if="checking" class="public-state-card">正在确认安装状态…</section>
      <section v-else-if="completed" class="public-state-card public-state-card--success"><span class="public-state-card__mark">✓</span><h2>安装配置已提交</h2><p v-if="serviceReady">服务已恢复，正在前往登录页…</p><p v-else-if="pollingRestart">服务正在重启并自动检查可用状态，通常不超过 60 秒。</p><p v-else>服务重启完成后即可登录。若当前部署由进程管理器托管，请确认服务已经重新拉起。</p><p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="public-inline-actions"><button class="button button--secondary" :disabled="pollingRestart" @click="checkStatus">{{ pollingRestart ? '正在检查…' : '检查启动状态' }}</button><RouterLink class="button button--primary" to="/login">前往登录</RouterLink></div></section>
      <section v-else class="setup-card">
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <template v-if="activeStep === SetupWizardStep.DATABASE"><header><h2>连接 PostgreSQL</h2><p>用于保存账号、策略、订单与审计数据。</p></header><div class="public-form-grid"><label>主机<input v-model="form.database.host" @input="databaseVerified = false" /></label><label>端口<input v-model.number="form.database.port" type="number" @input="databaseVerified = false" /></label><label>用户名<input v-model="form.database.user" autocomplete="username" @input="databaseVerified = false" /></label><label>密码<input v-model="form.database.password" type="password" autocomplete="new-password" @input="databaseVerified = false" /></label><label>数据库名<input v-model="form.database.dbname" @input="databaseVerified = false" /></label><label>SSL 模式<select v-model="form.database.sslmode" @change="databaseVerified = false"><option :value="DatabaseSSLMode.DISABLE">disable</option><option :value="DatabaseSSLMode.REQUIRE">require</option><option :value="DatabaseSSLMode.VERIFY_CA">verify-ca</option><option :value="DatabaseSSLMode.VERIFY_FULL">verify-full</option></select></label></div><button class="button button--secondary" :disabled="testing !== ''" @click="verifyDatabase">{{ testing === 'database' ? '测试中…' : databaseVerified ? '连接已验证' : '测试数据库连接' }}</button></template>

        <template v-else-if="activeStep === SetupWizardStep.REDIS"><header><h2>连接 Redis</h2><p>用于会话、限流、调度状态和实时指标。</p></header><div class="public-form-grid"><label>主机<input v-model="form.redis.host" @input="redisVerified = false" /></label><label>端口<input v-model.number="form.redis.port" type="number" @input="redisVerified = false" /></label><label>用户名<input v-model="form.redis.username" autocomplete="username" @input="redisVerified = false" /></label><label>密码<input v-model="form.redis.password" type="password" autocomplete="new-password" @input="redisVerified = false" /></label><label>数据库编号<input v-model.number="form.redis.db" type="number" min="0" @input="redisVerified = false" /></label><label class="public-check"><input v-model="form.redis.enable_tls" type="checkbox" @change="redisVerified = false" />启用 TLS</label></div><button class="button button--secondary" :disabled="testing !== ''" @click="verifyRedis">{{ testing === 'redis' ? '测试中…' : redisVerified ? '连接已验证' : '测试 Redis 连接' }}</button></template>

        <template v-else-if="activeStep === SetupWizardStep.ADMIN"><header><h2>创建首位管理员</h2><p>此账号拥有全部管理权限，请使用可长期接收通知的邮箱。</p></header><div class="public-form-stack"><label>管理员邮箱<input v-model="form.admin.email" type="email" autocomplete="email" /></label><label>密码<input v-model="form.admin.password" type="password" minlength="8" maxlength="128" autocomplete="new-password" /><small>8–128 位</small></label><label>确认密码<input v-model="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" /></label><label>运行模式<select v-model="form.server.mode"><option :value="ServerRunMode.RELEASE">生产模式（release）</option><option :value="ServerRunMode.DEBUG">调试模式（debug）</option></select></label></div><p v-if="confirmPassword && adminError" class="form-error">{{ adminError }}</p></template>

        <template v-else><header><h2>确认安装配置</h2><p>密码不会在摘要中显示。返回任一步骤修改后，需要重新测试对应连接。</p></header><dl class="public-review"><dt>PostgreSQL</dt><dd>{{ form.database.user }}@{{ form.database.host }}:{{ form.database.port }}/{{ form.database.dbname }} · {{ form.database.sslmode }}</dd><dt>Redis</dt><dd>{{ form.redis.host }}:{{ form.redis.port }}/{{ form.redis.db }} · {{ form.redis.enable_tls ? 'TLS' : '非 TLS' }}</dd><dt>管理员</dt><dd>{{ form.admin.email }}</dd><dt>服务</dt><dd>{{ form.server.host }}:{{ form.server.port }} · {{ form.server.mode }}</dd></dl><button class="button button--primary" :disabled="installing" @click="performInstall">{{ installing ? '正在安装…' : '确认并开始安装' }}</button></template>

        <footer class="setup-card__actions"><button class="button button--secondary" :disabled="activeIndex === 0 || installing" @click="previous">上一步</button><button v-if="activeStep !== SetupWizardStep.REVIEW" class="button button--primary" :disabled="installing" @click="next">下一步</button></footer>
      </section>
    </main>
  </PublicShell>
</template>
