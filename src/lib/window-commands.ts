import { invoke } from '@tauri-apps/api/core'
import { logFrontend } from './app-log-commands'

export type WindowBackdrop = 'mica' | 'solid'
export type WindowThemePreference = 'light' | 'dark' | 'system'

/** Sets the native title bar theme; `null` lets it follow the OS. */
export async function setWindowTheme(theme: 'light' | 'dark' | null): Promise<void> {
  await invoke<void>('set_window_theme', { theme })
}

/** `mica` when the window got the Windows 11 backdrop, `solid` otherwise. */
export async function getWindowBackdrop(): Promise<WindowBackdrop> {
  return invoke<WindowBackdrop>('get_window_backdrop')
}

/** Keeps the OS-drawn title bar in the app theme; `system` lets it follow the OS. */
export async function syncNativeTheme(preference: WindowThemePreference): Promise<void> {
  try {
    await setWindowTheme(preference === 'system' ? null : preference)
  } catch (error) {
    logFrontend('warn', `set_window_theme failed (${preference}): ${String(error)}`)
  }
}

/**
 * Marks `<html>` with `mica` when Rust applied the Windows 11 backdrop, so the title and
 * connection strip base surfaces turn transparent and let it show through.
 */
export async function applyWindowBackdrop(): Promise<void> {
  try {
    const backdrop = await getWindowBackdrop()
    document.documentElement.classList.toggle('mica', backdrop === 'mica')
  } catch (error) {
    logFrontend('warn', `get_window_backdrop failed: ${String(error)}`)
  }
}
