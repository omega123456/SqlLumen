import { invokeArgumentCommand, NO_ARGUMENTS } from './ipc/dispatch'
import { logFrontend } from './app-log-commands'
import { PERCENT_SCALE } from './units'

const MAIN_WEBVIEW_LABEL = 'main'

export type WindowBackdrop = 'mica' | 'solid'
export type WindowThemePreference = 'light' | 'dark' | 'system'

export async function setWindowTheme(theme: 'light' | 'dark' | null): Promise<void> {
  await invokeArgumentCommand({ command: 'set_window_theme', argument: { theme } })
}

export async function setWebviewZoom(level: number): Promise<void> {
  await invokeArgumentCommand({
    command: 'plugin:webview|set_webview_zoom',
    argument: { label: MAIN_WEBVIEW_LABEL, value: level / PERCENT_SCALE },
  })
}

export async function getWindowBackdrop(): Promise<WindowBackdrop> {
  return invokeArgumentCommand({ command: 'get_window_backdrop', argument: NO_ARGUMENTS })
}

export async function syncNativeTheme(preference: WindowThemePreference): Promise<void> {
  try {
    await setWindowTheme(preference === 'system' ? null : preference)
  } catch (error) {
    logFrontend('warn', `set_window_theme failed (${preference}): ${String(error)}`)
  }
}

export async function applyWindowBackdrop(): Promise<void> {
  try {
    const backdrop = await getWindowBackdrop()
    document.documentElement.classList.toggle('mica', backdrop === 'mica')
  } catch (error) {
    logFrontend('warn', `get_window_backdrop failed: ${String(error)}`)
  }
}
