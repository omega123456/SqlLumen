import { invoke } from '@tauri-apps/api/core'
import type { Theme } from '../stores/theme-store'

/**
 * Get a single setting value by key.
 * Returns null if the key doesn't exist.
 */
export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('get_setting', { key })
}

/**
 * Set a setting value (insert or replace).
 */
export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>('set_setting', { key, value })
}

/**
 * Get all settings as a key-value record.
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('get_all_settings')
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

function isTheme(value: string | null): value is Theme {
  return value !== null && THEMES.has(value)
}

/**
 * Save the theme preference.
 */
export async function setThemeSetting(theme: Theme): Promise<void> {
  return setSetting('theme', theme)
}
