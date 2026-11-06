import { create } from 'zustand'
import { getAllSettings, setSetting } from '../lib/tauri-commands'
import { DEFAULT_UPDATE_INTERVAL } from '../lib/update-intervals'
import type { SettingsSection } from '../types/schema'

import { logFrontend } from '../lib/app-log-commands'
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
  'editor.autocompleteBackticks': 'false',
  'results.pageSize': '500',
  'results.maxRows': '100000',
  'results.nullDisplay': 'NULL',
  'results.cacheTTL': '1800',
  'results.tableTabsInBottomPanel': 'false',
  'results.maxTabsPerGroup': '0',
  'connection.defaultTimeout': '10',
  'appearance.zoom': '100',
  'connection.defaultKeepalive': '60',
  'updates.checkInterval': DEFAULT_UPDATE_INTERVAL,
  shortcuts: '{}',
  'commandPalette.recents': '{}',
  'session.state': 'null',
  'snapshots.frequency': 'daily',
  'snapshots.keep': '10',
  'ai.enabled': 'false',
  'ai.endpoint': '',
  'ai.embeddingEndpoint': '',
  'ai.model': '',
  'ai.embeddingModel': '',
  'ai.temperature': '0.3',
  'ai.maxTokens': '32000',
  'ai.enableReasoning': 'true',
  'ai.preferResponsesApi': 'false',
  'ai.rememberScope': 'connection',
  'ai.retrieval.topKPerQuery': '30',
  'ai.retrieval.topN': '20',
  'ai.retrieval.fkFanoutCap': '30',
  'ai.retrieval.lexicalWeight': '0.2',
  'ai.retrieval.rerankEnabled': 'false',
  'ai.retrieval.tokenBudget': '30000',
  'ai.retrieval.embedRichText': 'true',
  'ai.retrieval.hydeEnabled': 'true',
  'ai.retrieval.expansionMaxQueries': '8',
  'ai.retrieval.graphDepth': '2',
  'ai.retrieval.feedbackBoost': '0.15',
  'ai.retrieval.recentQueryWindow': '20',
}

/** Maps a settings key prefix to its SettingsSection. */
function sectionForKey(key: string): SettingsSection | null {
  if (
    key === 'theme' ||
    key === 'session.restore' ||
    key === 'session.state' ||
    key === 'snapshots.frequency' ||
    key === 'snapshots.keep' ||
    key.startsWith('connection.') ||
    key.startsWith('appearance.')
  )
    return 'general'
  if (key.startsWith('editor.')) return 'editor'
  if (key.startsWith('results.')) return 'results'
  if (key.startsWith('log.')) return 'logging'
  if (key === 'shortcuts') return 'shortcuts'
  if (key.startsWith('ai.')) return 'ai'
  if (key.startsWith('updates.')) return 'updates'
  return null
}

/** Smallest accepted `results.maxRows` (Rust clamps to the same range). */
export const RESULTS_MAX_ROWS_MIN = 1_000
/** Largest accepted `results.maxRows`. */
export const RESULTS_MAX_ROWS_MAX = 1_000_000
/** Validation message for `results.maxRows`. */
export const RESULTS_MAX_ROWS_ERROR = 'Enter a whole number from 1,000 to 1,000,000.'

/**
 * Validators for settings that need one. Each returns an error message, or
 * null when the value is valid. Values are never silently clamped.
 */
export const SETTINGS_VALIDATORS: Record<string, (value: string) => string | null> = {
  'results.maxRows': (value) => {
    const trimmed = value.trim()
    if (!/^\d+$/.test(trimmed)) return RESULTS_MAX_ROWS_ERROR
    const parsed = Number(trimmed)
    return parsed >= RESULTS_MAX_ROWS_MIN && parsed <= RESULTS_MAX_ROWS_MAX
      ? null
      : RESULTS_MAX_ROWS_ERROR
  },
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
  /** Validation error per pending key (set on blur and on save). Save is blocked while any exists. */
  validationErrors: Record<string, string>
  /** Whether loadSettings has been called and is in progress. */
  isLoading: boolean
  /** True when there are unsaved pending changes. */
  isDirty: boolean
  /** Currently active settings section in the UI. */
  activeSection: SettingsSection

  /** Whether the settings dialog is open. */
  isDialogOpen: boolean
  /** Which section to focus when opening the dialog. */
  dialogSection: string | undefined

  // Actions
  loadSettings: () => Promise<void>
  setPendingChange: (key: string, value: string) => void
  /**
   * Run the key's validator against its effective value and record the result
   * (called on blur). Returns true when the value is valid.
   */
  validateSetting: (key: string) => boolean
  /** Saves pending changes. Does nothing while any validation error exists. */
  save: () => Promise<void>
  discard: () => void
  resetSection: (section: SettingsSection) => void
  getSetting: (key: string) => string
  getEffectiveSetting: (key: string) => string
  setActiveSection: (section: SettingsSection) => void
  openDialog: (section?: string) => void
  closeDialog: () => void
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: {},
  pendingChanges: {},
  validationErrors: {},
  isLoading: false,
  isDirty: false,
  activeSection: 'general',
  isDialogOpen: false,
  dialogSection: undefined,

  loadSettings: async () => {
    set({ isLoading: true })
    try {
      const loaded = await getAllSettings()
      set({ settings: loaded, pendingChanges: {}, isDirty: false, isLoading: false })
    } catch (error) {
      logFrontend(
        'error',
        ['[settings-store] Failed to load settings:', error].map(String).join(' ')
      )
      set({ isLoading: false })
    }
  },

  setPendingChange: (key: string, value: string) => {
    const state = get()
    const newPending = { ...state.pendingChanges, [key]: value }
    set({ pendingChanges: newPending, isDirty: Object.keys(newPending).length > 0 })
  },

  validateSetting: (key: string): boolean => {
    const validator = SETTINGS_VALIDATORS[key]
    const error = validator ? validator(get().getEffectiveSetting(key)) : null
    const current = get().validationErrors
    if (error === (current[key] ?? null)) return error === null
    const next = { ...current }
    if (error) next[key] = error
    else delete next[key]
    set({ validationErrors: next })
    return error === null
  },

  save: async () => {
    // Validate every pending key first; an invalid value blocks the whole save.
    const pendingKeys = Object.keys(get().pendingChanges)
    const allValid = pendingKeys.map((key) => get().validateSetting(key)).every(Boolean)
    if (!allValid || Object.keys(get().validationErrors).length > 0) return

    const state = get()
    const entries = Object.entries(state.pendingChanges)
    const errors: string[] = []

    for (const [key, value] of entries) {
      try {
        await setSetting(key, value)
      } catch (error) {
        logFrontend(
          'error',
          [`[settings-store] Failed to save setting "${key}":`, error].map(String).join(' ')
        )
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
    set({ pendingChanges: {}, isDirty: false, validationErrors: {} })
  },

  resetSection: (section: SettingsSection) => {
    const state = get()
    const keys = keysForSection(section)
    const newPending = { ...state.pendingChanges }
    const newErrors = { ...state.validationErrors }
    for (const key of keys) {
      newPending[key] = SETTINGS_DEFAULTS[key]
      delete newErrors[key]
    }
    set({
      pendingChanges: newPending,
      isDirty: Object.keys(newPending).length > 0,
      validationErrors: newErrors,
    })
  },

  getSetting: (key: string): string => {
    const state = get()
    // Only committed (saved) values — pending changes are excluded so that
    // subscribers (e.g. schema-index-store) don't react until save() is called.
    // UI form fields should use the useSettingValue() hook instead.
    if (key in state.settings) return state.settings[key]
    return SETTINGS_DEFAULTS[key] ?? ''
  },

  getEffectiveSetting: (key: string): string => {
    const state = get()
    if (key in state.pendingChanges) return state.pendingChanges[key]
    if (key in state.settings) return state.settings[key]
    return SETTINGS_DEFAULTS[key] ?? ''
  },

  setActiveSection: (section: SettingsSection) => {
    set({ activeSection: section })
  },

  openDialog: (section?: string) => {
    set({ isDialogOpen: true, dialogSection: section })
  },

  closeDialog: () => {
    set({ isDialogOpen: false, dialogSection: undefined })
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
