import { create } from 'zustand'
import { getThemeSetting, setThemeSetting } from '../lib/tauri-commands'

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

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved)
}

// Internal helper — resolve theme, apply to DOM, update state
function applyThemeState(theme: Theme, set: (partial: Partial<ThemeState>) => void): void {
  const resolved = resolveTheme(theme)
  applyTheme(resolved)
  set({ theme, resolvedTheme: resolved })
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
    const resolved = resolveTheme(theme)
    applyTheme(resolved)
    set({ resolvedTheme: resolved, _previewSnapshot: snapshot })
  },

  revertPreview: () => {
    const state = get()
    if (state._previewSnapshot !== null) {
      applyThemeState(state._previewSnapshot, set)
      set({ _previewSnapshot: null })
    }
  },
}))
