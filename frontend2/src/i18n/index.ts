import { createI18n } from 'vue-i18n'

export enum LocaleCode {
  EN = 'en',
  ZH = 'zh'
}

type LocaleMessages = Record<string, unknown>

const LOCALE_KEY = 'sub2api_locale'
const DEFAULT_LOCALE = LocaleCode.EN
const loadedLocales = new Set<LocaleCode>()

const localeLoaders: Record<LocaleCode, () => Promise<{ default: LocaleMessages }>> = {
  [LocaleCode.EN]: () => import('@shared-i18n/locales/en'),
  [LocaleCode.ZH]: () => import('@shared-i18n/locales/zh')
}

function isLocaleCode(value: string): value is LocaleCode {
  return Object.values(LocaleCode).includes(value as LocaleCode)
}

function preferredLocale(): LocaleCode {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCALE_KEY)
  if (saved && isLocaleCode(saved)) return saved
  const browserLanguage = typeof navigator === 'undefined' ? '' : navigator.language
  return browserLanguage.toLowerCase().startsWith('zh') ? LocaleCode.ZH : DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: preferredLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages: {},
  warnHtmlMessage: false
})

export async function loadLocaleMessages(locale: LocaleCode): Promise<void> {
  if (loadedLocales.has(locale)) return
  const module = await localeLoaders[locale]()
  i18n.global.setLocaleMessage(locale, module.default)
  loadedLocales.add(locale)
}

export function getLocale(): LocaleCode {
  const current = i18n.global.locale.value
  return isLocaleCode(current) ? current : DEFAULT_LOCALE
}

export async function initI18n(): Promise<void> {
  const locale = getLocale()
  await loadLocaleMessages(locale)
  document.documentElement.lang = locale
}

export async function setLocale(locale: string): Promise<void> {
  if (!isLocaleCode(locale)) return
  await loadLocaleMessages(locale)
  i18n.global.locale.value = locale
  if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_KEY, locale)
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

export const availableLocales = [
  { code: LocaleCode.EN, name: 'English', flag: '🇺🇸' },
  { code: LocaleCode.ZH, name: '中文', flag: '🇨🇳' }
] as const

export default i18n
