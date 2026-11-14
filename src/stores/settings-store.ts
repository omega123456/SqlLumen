import { create } from 'zustand'
import { getAllSettings, setSetting } from '../lib/tauri-commands'
import { DEFAULT_UPDATE_INTERVAL } from '../lib/update-intervals'
import type { SettingsSection } from '../types/schema'

import { logFrontendError } from '../lib/app-log-commands'

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

const GENERAL_SETTING_KEYS = new Set([
  'theme',
  'session.restore',
  'session.state',
  'snapshots.frequency',
  'snapshots.keep',
])

const SECTION_BY_KEY_PREFIX: Record<string, SettingsSection> = {
  'connection.': 'general',
  'appearance.': 'general',
  'editor.': 'editor',
  'results.': 'results',
  'log.': 'logging',
  'ai.': 'ai',
  'updates.': 'updates',
}

function sectionForKey(key: string): SettingsSection | null {
  if (GENERAL_SETTING_KEYS.has(key)) return 'general'
  if (key === 'shortcuts') return 'shortcuts'
  const prefix = Object.keys(SECTION_BY_KEY_PREFIX).find((candidate) => key.startsWith(candidate))
  return prefix ? SECTION_BY_KEY_PREFIX[prefix] : null
}

export const RESULTS_MAX_ROWS_MIN = 1_000

export const RESULTS_MAX_ROWS_MAX = 1_000_000

export const RESULTS_MAX_ROWS_ERROR = 'Enter a whole number from 1,000 to 1,000,000.'

export const SETTINGS_VALIDATORS: Record<string, (value: string) => string | null> = {
  'results.maxRows': (value) => {
    const trimmed = value.trim()
    if (!/^\d+$/.test(trimmed)) return RESULTS_MAX_ROWS_ERROR
    const parsed = Number(trimmed)
    const isWithinRange = parsed >= RESULTS_MAX_ROWS_MIN && parsed <= RESULTS_MAX_ROWS_MAX
    return isWithinRange ? null : RESULTS_MAX_ROWS_ERROR
  },
}

function isKeyInSection(settingKey: string, section: SettingsSection): boolean {
  return sectionForKey(settingKey) === section
}

function keysForSection(section: SettingsSection): string[] {
  return Object.keys(SETTINGS_DEFAULTS).filter((settingKey) => isKeyInSection(settingKey, section))
}

interface SettingsState {
  settings: Record<string, string>
  pendingChanges: Record<string, string>
  validationErrors: Record<string, string>
  isLoading: boolean
  isDirty: boolean
  activeSection: SettingsSection

  isDialogOpen: boolean
  dialogSection: string | undefined

  loadSettings: () => Promise<void>
  setPendingChange: (key: string, value: string) => void
  validateSetting: (key: string) => boolean
  save: () => Promise<void>
  discard: () => void
  resetSection: (section: SettingsSection) => void
  getSetting: (key: string) => string
  getEffectiveSetting: (key: string) => string
  setActiveSection: (section: SettingsSection) => void
  openDialog: (section?: string) => void
  closeDialog: () => void
}

async function loadSettings(): Promise<void> {
  useSettingsStore.setState({ isLoading: true })
  try {
    const loaded = await getAllSettings()
    useSettingsStore.setState({
      settings: loaded,
      pendingChanges: {},
      isDirty: false,
      isLoading: false,
    })
  } catch (error) {
    logFrontendError('[settings-store] Failed to load settings:', error)
    useSettingsStore.setState({ isLoading: false })
  }
}

function setPendingChange(key: string, value: string): void {
  const state = useSettingsStore.getState()
  const newPending = { ...state.pendingChanges, [key]: value }
  useSettingsStore.setState({
    pendingChanges: newPending,
    isDirty: Object.keys(newPending).length > 0,
  })
}

function validateSetting(key: string): boolean {
  const validator = SETTINGS_VALIDATORS[key]
  const error = validator ? validator(useSettingsStore.getState().getEffectiveSetting(key)) : null
  const current = useSettingsStore.getState().validationErrors
  if (error === (current[key] ?? null)) return error === null
  const next = { ...current }
  delete next[key]
  if (error) next[key] = error
  useSettingsStore.setState({ validationErrors: next })
  return error === null
}

async function save(): Promise<void> {
  const pendingKeys = Object.keys(useSettingsStore.getState().pendingChanges)
  const allValid = pendingKeys
    .map((key) => useSettingsStore.getState().validateSetting(key))
    .every(Boolean)
  const hasValidationErrors = Object.keys(useSettingsStore.getState().validationErrors).length > 0
  const canSave = allValid && !hasValidationErrors
  if (!canSave) return

  const state = useSettingsStore.getState()
  const entries = Object.entries(state.pendingChanges)
  const errors: string[] = []

  for (const [key, value] of entries) {
    try {
      await setSetting(key, value)
    } catch (error) {
      logFrontendError(`[settings-store] Failed to save setting "${key}":`, error)
      errors.push(key)
    }
  }

  const failedKeys = new Set(errors)
  const remaining: Record<string, string> = {}
  for (const settingKey of errors) {
    remaining[settingKey] = state.pendingChanges[settingKey]
  }
  const updatedSettings = { ...state.settings }
  for (const [key, value] of entries) {
    if (!failedKeys.has(key)) {
      updatedSettings[key] = value
    }
  }
  useSettingsStore.setState({
    settings: updatedSettings,
    pendingChanges: remaining,
    isDirty: Object.keys(remaining).length > 0,
  })
}

function discard(): void {
  useSettingsStore.setState({ pendingChanges: {}, isDirty: false, validationErrors: {} })
}

function resetSection(section: SettingsSection): void {
  const state = useSettingsStore.getState()
  const keys = keysForSection(section)
  const newPending = { ...state.pendingChanges }
  const newErrors = { ...state.validationErrors }
  for (const key of keys) {
    newPending[key] = SETTINGS_DEFAULTS[key]
    delete newErrors[key]
  }
  useSettingsStore.setState({
    pendingChanges: newPending,
    isDirty: Object.keys(newPending).length > 0,
    validationErrors: newErrors,
  })
}

function getSetting(key: string): string {
  const state = useSettingsStore.getState()
  if (key in state.settings) return state.settings[key]
  return SETTINGS_DEFAULTS[key] ?? ''
}

function getEffectiveSetting(key: string): string {
  const state = useSettingsStore.getState()
  if (key in state.pendingChanges) return state.pendingChanges[key]
  if (key in state.settings) return state.settings[key]
  return SETTINGS_DEFAULTS[key] ?? ''
}

function setActiveSection(section: SettingsSection): void {
  useSettingsStore.setState({ activeSection: section })
}

function openDialog(section?: string): void {
  useSettingsStore.setState({ isDialogOpen: true, dialogSection: section })
}

function closeDialog(): void {
  useSettingsStore.setState({ isDialogOpen: false, dialogSection: undefined })
}

export const useSettingsStore = create<SettingsState>()(() => ({
  settings: {},
  pendingChanges: {},
  validationErrors: {},
  isLoading: false,
  isDirty: false,
  activeSection: 'general',
  isDialogOpen: false,
  dialogSection: undefined,
  loadSettings: loadSettings,
  setPendingChange: setPendingChange,
  validateSetting: validateSetting,
  save: save,
  discard: discard,
  resetSection: resetSection,
  getSetting: getSetting,
  getEffectiveSetting: getEffectiveSetting,
  setActiveSection: setActiveSection,
  openDialog: openDialog,
  closeDialog: closeDialog,
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
  return useSettingsStore((state) => {
    if (key in state.pendingChanges) return state.pendingChanges[key]
    if (key in state.settings) return state.settings[key]
    return SETTINGS_DEFAULTS[key] ?? ''
  })
}

export function useBottomTableTabsEnabled(): boolean {
  return useSettingsStore(
    (state) =>
      (state.settings['results.tableTabsInBottomPanel'] ??
        SETTINGS_DEFAULTS['results.tableTabsInBottomPanel']) === 'true'
  )
}
