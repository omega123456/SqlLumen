import { create } from 'zustand'
import { getAllSettings, setSetting } from '../lib/tauri-commands'
import type { SettingsSection } from '../types/schema'

// ---------------------------------------------------------------------------
// Default values for all settings keys
// ---------------------------------------------------------------------------

export const SETTINGS_DEFAULTS: Record<string, string> = {
  theme: 'system',
  'log.level': 'info',
  'session.restore': 'true',
  'editor.fontFamily': 'JetBrains Mono',
  'editor.fontSize': '14',
  'editor.lineHeight': '1.6',
  'editor.wordWrap': 'false',
  'editor.minimap': 'false',
  'editor.lineNumbers': 'true',
  'results.pageSize': '500',
  'results.nullDisplay': 'NULL',
  'connection.defaultTimeout': '10',
  'connection.defaultKeepalive': '60',
  shortcuts: '{}',
  'session.state': 'null',
}

/** Maps a settings key prefix to its SettingsSection. */
function sectionForKey(key: string): SettingsSection | null {
  if (
    key === 'theme' ||
    key === 'session.restore' ||
    key === 'session.state' ||
    key.startsWith('connection.')
  )
    return 'general'
  if (key.startsWith('editor.')) return 'editor'
  if (key.startsWith('results.')) return 'results'
  if (key.startsWith('log.')) return 'logging'
  if (key === 'shortcuts') return 'shortcuts'
  return null
}

/** Returns all default keys for a given section. */
function keysForSection(section: SettingsSection): string[] {
  return Object.keys(SETTINGS_DEFAULTS).filter((k) => sectionForKey(k) === section)
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SettingsState {
  /** Settings as loaded from the backend. */
  settings: Record<string, string>
  /** Unsaved changes not yet persisted. */
  pendingChanges: Record<string, string>
  /** Whether loadSettings has been called and is in progress. */
  isLoading: boolean
  /** True when there are unsaved pending changes. */
  isDirty: boolean
  /** Currently active settings section in the UI. */
  activeSection: SettingsSection

  // Actions
  loadSettings: () => Promise<void>
  setPendingChange: (key: string, value: string) => void
  save: () => Promise<void>
  discard: () => void
  resetSection: (section: SettingsSection) => void
  getSetting: (key: string) => string
  setActiveSection: (section: SettingsSection) => void
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: {},
  pendingChanges: {},
  isLoading: false,
  isDirty: false,
  activeSection: 'general',

  loadSettings: async () => {
    set({ isLoading: true })
    try {
      const loaded = await getAllSettings()
      set({ settings: loaded, pendingChanges: {}, isDirty: false, isLoading: false })
    } catch (error) {
      console.error('[settings-store] Failed to load settings:', error)
      set({ isLoading: false })
    }
  },

  setPendingChange: (key: string, value: string) => {
    const state = get()
    const newPending = { ...state.pendingChanges, [key]: value }
    set({ pendingChanges: newPending, isDirty: Object.keys(newPending).length > 0 })
  },

  save: async () => {
    const state = get()
    const entries = Object.entries(state.pendingChanges)
    const errors: string[] = []

    for (const [key, value] of entries) {
      try {
        await setSetting(key, value)
      } catch (error) {
        console.error(`[settings-store] Failed to save setting "${key}":`, error)
        errors.push(key)
      }
    }

    if (errors.length > 0) {
      // Keep failed entries in pendingChanges
      const remaining: Record<string, string> = {}
      for (const k of errors) {
        remaining[k] = state.pendingChanges[k]
      }
      const updatedSettings = { ...state.settings }
      for (const [key, value] of entries) {
        if (!errors.includes(key)) {
          updatedSettings[key] = value
        }
      }
      set({
        settings: updatedSettings,
        pendingChanges: remaining,
        isDirty: Object.keys(remaining).length > 0,
      })
    } else {
      // All succeeded
      const updatedSettings = { ...state.settings }
      for (const [key, value] of entries) {
        updatedSettings[key] = value
      }
      set({ settings: updatedSettings, pendingChanges: {}, isDirty: false })
    }
  },

  discard: () => {
    set({ pendingChanges: {}, isDirty: false })
  },

  resetSection: (section: SettingsSection) => {
    const state = get()
    const keys = keysForSection(section)
    const newPending = { ...state.pendingChanges }
    for (const key of keys) {
      newPending[key] = SETTINGS_DEFAULTS[key]
    }
    set({ pendingChanges: newPending, isDirty: Object.keys(newPending).length > 0 })
  },

  getSetting: (key: string): string => {
    const state = get()
    // Pending takes precedence over loaded, which takes precedence over default
    if (key in state.pendingChanges) return state.pendingChanges[key]
    if (key in state.settings) return state.settings[key]
    return SETTINGS_DEFAULTS[key] ?? ''
  },

  setActiveSection: (section: SettingsSection) => {
    set({ activeSection: section })
  },
}))

/**
 * React hook that returns the effective value for a single settings key.
 *
 * Unlike selecting `s.getSetting` (which returns a stable function reference
 * and therefore never triggers re-renders), this hook's selector returns the
 * computed **string value**, so Zustand correctly re-renders the component
 * whenever `pendingChanges` or `settings` changes the resolved value.
 */
export function useSettingValue(key: string): string {
  return useSettingsStore((s) => {
    if (key in s.pendingChanges) return s.pendingChanges[key]
    if (key in s.settings) return s.settings[key]
    return SETTINGS_DEFAULTS[key] ?? ''
  })
}
