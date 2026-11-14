export interface RoutineParameter {
  name: string
  dataType: string
  mode: string
  ordinalPosition: number
}

export interface SaveObjectResponse {
  success: boolean
  errorMessage: string | null
  dropSucceeded: boolean
  savedObjectName: string | null
}

export type SettingsSection =
  'general' | 'editor' | 'results' | 'logging' | 'shortcuts' | 'ai' | 'updates'

export interface ShortcutBinding {
  key: string
  modifiers: string[]
}

export interface ShortcutActionDescriptor {
  id: string
  label: string
  description: string
}

export interface AppInfo {
  rustLogOverride: boolean
  appVersion: string
}

export interface HistoryEntry {
  id: number
  connectionId: string
  databaseName: string | null
  sqlText: string
  timestamp: string
  durationMs: number | null
  rowCount: number | null
  affectedRows: number | null
  success: boolean
  errorMessage: string | null
}

export interface HistoryPage {
  entries: HistoryEntry[]
  total: number
  page: number
  pageSize: number
}

export interface FavoriteEntry {
  id: number
  name: string
  sqlText: string
  description: string | null
  category: string | null
  connectionId: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateFavoriteInput {
  name: string
  sqlText: string
  description?: string | null
  category?: string | null
  connectionId?: string | null
}

export interface UpdateFavoriteInput {
  name: string
  sqlText: string
  description?: string | null
  category?: string | null
  connectionId?: string | null
}
