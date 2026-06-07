import { create } from 'zustand'
import { logFrontend } from '../lib/app-log-commands'
import { getSetting, setSetting } from '../lib/tauri-commands'
import type { ObjectType } from '../types/schema'

const COMMAND_PALETTE_RECENTS_KEY = 'commandPalette.recents'
export const COMMAND_PALETTE_RECENTS_MAX_PER_PROFILE = 50

type CommandPaletteRecentObjectType = Extract<
  ObjectType,
  'table' | 'view' | 'procedure' | 'function' | 'trigger'
>

export interface CommandPaletteRecentEntry {
  database: string
  objectType: CommandPaletteRecentObjectType
  name: string
  lastUsedAt: string
}

export interface CommandPaletteRecentSelection {
  database: string
  objectType: CommandPaletteRecentObjectType
  name: string
}

interface CommandPaletteRecentsState {
  recentsByProfile: Record<string, CommandPaletteRecentEntry[]>
  isInitialized: boolean
  initializeFromBackend: () => Promise<void>
  loadRecents: (serialized?: string | null) => void
  getRecents: (profileId: string) => CommandPaletteRecentEntry[]
  recordSelection: (profileId: string, entry: CommandPaletteRecentSelection) => void
}

function isRecentObjectType(value: unknown): value is CommandPaletteRecentObjectType {
  return (
    value === 'table' ||
    value === 'view' ||
    value === 'procedure' ||
    value === 'function' ||
    value === 'trigger'
  )
}

function isRecentEntry(value: unknown): value is CommandPaletteRecentEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.database === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.lastUsedAt === 'string' &&
    isRecentObjectType(entry.objectType)
  )
}

function sanitizeRecents(parsed: unknown): Record<string, CommandPaletteRecentEntry[]> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }

  const sanitized: Record<string, CommandPaletteRecentEntry[]> = {}

  for (const [profileId, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue
    sanitized[profileId] = value
      .filter(isRecentEntry)
      .slice(0, COMMAND_PALETTE_RECENTS_MAX_PER_PROFILE)
  }

  return sanitized
}

function persistRecents(recentsByProfile: Record<string, CommandPaletteRecentEntry[]>): void {
  const serialized = JSON.stringify(recentsByProfile)
  setSetting(COMMAND_PALETTE_RECENTS_KEY, serialized).catch((error: unknown) => {
    logFrontend(
      'error',
      ['[command-palette-recents-store] Failed to persist recents:', error].map(String).join(' ')
    )
  })
}

export const useCommandPaletteRecentsStore = create<CommandPaletteRecentsState>()((set, get) => ({
  recentsByProfile: {},
  isInitialized: false,

  initializeFromBackend: async () => {
    try {
      const serialized = await getSetting(COMMAND_PALETTE_RECENTS_KEY)
      get().loadRecents(serialized)
    } catch (error) {
      logFrontend(
        'error',
        ['[command-palette-recents-store] Failed to load recents from backend:', error]
          .map(String)
          .join(' ')
      )
      set({ recentsByProfile: {}, isInitialized: true })
    }
  },

  loadRecents: (serialized?: string | null) => {
    if (!serialized) {
      set({ recentsByProfile: {}, isInitialized: true })
      return
    }

    try {
      const parsed = JSON.parse(serialized) as unknown
      set({ recentsByProfile: sanitizeRecents(parsed), isInitialized: true })
    } catch (error) {
      logFrontend(
        'error',
        ['[command-palette-recents-store] Failed to parse recents:', error].map(String).join(' ')
      )
      set({ recentsByProfile: {}, isInitialized: true })
    }
  },

  getRecents: (profileId: string) => {
    const recents = get().recentsByProfile[profileId] ?? []
    return [...recents]
  },

  recordSelection: (profileId: string, entry: CommandPaletteRecentSelection) => {
    const existing = get().recentsByProfile[profileId] ?? []
    const nextEntry: CommandPaletteRecentEntry = {
      ...entry,
      lastUsedAt: new Date().toISOString(),
    }

    const filtered = existing.filter(
      (recent) =>
        !(
          recent.database === entry.database &&
          recent.objectType === entry.objectType &&
          recent.name === entry.name
        )
    )
    const nextProfileRecents = [nextEntry, ...filtered].slice(
      0,
      COMMAND_PALETTE_RECENTS_MAX_PER_PROFILE
    )
    const recentsByProfile = {
      ...get().recentsByProfile,
      [profileId]: nextProfileRecents,
    }

    set({ recentsByProfile, isInitialized: true })
    persistRecents(recentsByProfile)
  },
}))
