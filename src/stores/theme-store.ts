import { create } from 'zustand'
import { logFrontend } from '../lib/app-log-commands'
import { getThemeSetting, setThemeSetting } from '../lib/tauri-commands'
import { applyResolvedTheme } from '../lib/theme-tokens'
import { syncNativeTheme } from '../lib/window-commands'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return getSystemTheme()
  return theme
}

function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme)
  applyResolvedTheme(resolved)
  void syncNativeTheme(theme)
  return resolved
}

function applyThemeState(theme: Theme, set: (partial: Partial<ThemeState>) => void): void {
  set({ theme: theme, resolvedTheme: applyTheme(theme) })
}

interface ThemeState {
  theme: Theme
  resolvedTheme: ResolvedTheme
  _previewSnapshot: Theme | null
  setTheme: (theme: Theme) => Promise<void>
  initialize: () => Promise<void>
  previewTheme: (theme: Theme) => void
  revertPreview: () => void
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: 'system',
  resolvedTheme: 'light',
  _previewSnapshot: null,

  setTheme: async (theme: Theme) => {
    applyThemeState(theme, set)
    set({ _previewSnapshot: null })
    try {
      await setThemeSetting(theme)
    } catch (error) {
      logFrontend('warn', `[theme-store] Persisting the theme failed: ${String(error)}`)
    }
  },

  initialize: async () => {
    try {
      const savedTheme = await getThemeSetting()
      if (savedTheme !== null) {
        applyThemeState(savedTheme, set)
        return
      }
    } catch (error) {
      logFrontend('warn', `[theme-store] Reading the saved theme failed: ${String(error)}`)
    }
    applyThemeState('system', set)
  },

  previewTheme: (theme: Theme) => {
    const state = get()
    const snapshot = state._previewSnapshot ?? state.theme
    set({ resolvedTheme: applyTheme(theme), _previewSnapshot: snapshot })
  },

  revertPreview: () => {
    const state = get()
    if (state._previewSnapshot !== null) {
      applyThemeState(state._previewSnapshot, set)
      set({ _previewSnapshot: null })
    }
  },
}))
