export enum ThemeMode {
  LIGHT = 'light',
  DARK = 'dark',
  SYSTEM = 'system'
}

// Keep the existing frontend key so a replacement deployment preserves the
// user's visual preference. Authentication storage remains origin-local.
export const THEME_STORAGE_KEY = 'theme'
