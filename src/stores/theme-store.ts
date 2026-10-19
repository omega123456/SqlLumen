import { create } from 'zustand'
import { getThemeSetting, setThemeSetting } from '../lib/tauri-commands'
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

// Applies the theme to the DOM and the native title bar; returns the resolved theme.
// The native sync is fire-and-forget: it logs its own failures and never blocks the UI.
function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme)
  document.documentElement.setAttribute('data-theme', resolved)
  void syncNativeTheme(theme)
  return resolved
}

// Internal helper — resolve theme, apply to DOM, update state
function applyThemeState(theme: Theme, set: (partial: Partial<ThemeState>) => void): void {
  set({ theme, resolvedTheme: applyTheme(theme) })
}

interface ThemeState {
  theme: Theme
  resolvedTheme: ResolvedTheme
  /** Snapshot of `theme` before a preview started (null when not previewing). */
  _previewSnapshot: Theme | null
  setTheme: (theme: Theme) => Promise<void>
  initialize: () => Promise<void>
  /** Temporarily apply a theme without persisting (used by settings dialog preview). */
  previewTheme: (theme: Theme) => void
  /** Revert to the theme captured before previewing started. */
  revertPreview: () => void
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: 'system',
  resolvedTheme: 'light',
  _previewSnapshot: null,

  setTheme: async (theme: Theme) => {
    applyThemeState(theme, set)
    set({ _previewSnapshot: null })
    // Fire-and-forget persistence — don't block theme switching on IPC
    try {
      await setThemeSetting(theme)
    } catch {
      // Silently ignore persistence errors — theme still changes in UI
    }
  },

  initialize: async () => {
    try {
      // Attempt to read saved theme from SQLite
      const savedTheme = await getThemeSetting()
      if (savedTheme !== null) {
        applyThemeState(savedTheme, set)
        return
      }
    } catch {
      // Fall through to system preference on any IPC error
    }
    // Fallback: use system preference
    applyThemeState('system', set)
  },

  previewTheme: (theme: Theme) => {
    const state = get()
    // Capture the current theme on the first preview call only
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
