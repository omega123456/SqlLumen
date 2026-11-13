import type { Theme } from '../stores/theme-store'
import { invokeArgumentCommand, invokeCommand, NO_ARGUMENTS } from './ipc/dispatch'

export async function getSetting(key: string): Promise<string | null> {
  return invokeArgumentCommand({ command: 'get_setting', argument: { key } })
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invokeCommand({ command: 'set_setting', payload: { key, value } })
}

export async function getAllSettings(): Promise<Record<string, string>> {
  return invokeArgumentCommand({ command: 'get_all_settings', argument: NO_ARGUMENTS })
}

const THEMES: ReadonlySet<string> = new Set<Theme>(['light', 'dark', 'system'])

/**
 * Get the saved theme preference, or null if not set.
 */
export async function getThemeSetting(): Promise<Theme | null> {
  const value = await getSetting('theme')
  if (isTheme(value)) {
    return value
  }
  return null
}

export function isTheme(value: string | null): value is Theme {
  return value !== null && THEMES.has(value)
}

/**
 * Save the theme preference.
 */
export async function setThemeSetting(theme: Theme): Promise<void> {
  return setSetting('theme', theme)
}
