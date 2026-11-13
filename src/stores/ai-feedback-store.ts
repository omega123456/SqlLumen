import { create } from 'zustand'
import { MILLISECONDS_PER_MINUTE } from '../lib/units'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AcceptedEntry {
  dbName: string
  tableName: string
  connectionId: string
  lastSeenAt: number // Date.now()
}

interface AiFeedbackState {
  entries: AcceptedEntry[]

  recordAccepted: (
    connectionId: string,
    tables: Array<{ dbName: string; tableName: string }>
  ) => void

  getAcceptedTables: (
    connectionId: string
  ) => Array<{ dbName: string; tableName: string; weight: number }>

  cleanup: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPIRY_MINUTES = 30
const EXPIRY_MS = EXPIRY_MINUTES * MILLISECONDS_PER_MINUTE

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Stable key for deduplication. */
function entryKey(connectionId: string, dbName: string, tableName: string): string {
  return `${connectionId}\0${dbName}\0${tableName}`
}

/** Whether an entry has exceeded the 30-minute TTL. */
function isActiveEntryOf(entry: AcceptedEntry, connectionId: string, now: number): boolean {
  return entry.connectionId === connectionId && !isExpired(entry, now)
}

function isExpired(entry: AcceptedEntry, now: number = Date.now()): boolean {
  return now - entry.lastSeenAt >= EXPIRY_MS
}

/** Recency-based weight: 1.0 at creation, decaying to ~0.0 at expiry. */
function computeWeight(entry: AcceptedEntry, now: number = Date.now()): number {
  const age = now - entry.lastSeenAt
  return Math.max(0, 1.0 - age / EXPIRY_MS)
}

// ---------------------------------------------------------------------------
// Store (session-only — no SQLite persistence)
// ---------------------------------------------------------------------------

export const useAiFeedbackStore = create<AiFeedbackState>()((set, get) => ({
  entries: [],

  recordAccepted: (connectionId, tables) => {
    const now = Date.now()

    set((state) => {
      // Build a Map for O(1) dedup/merge
      const map = new Map<string, AcceptedEntry>()
      for (const entry of state.entries) {
        map.set(entryKey(entry.connectionId, entry.dbName, entry.tableName), entry)
      }
      for (const table of tables) {
        const key = entryKey(connectionId, table.dbName, table.tableName)
        const existing = map.get(key) ?? {
          dbName: table.dbName,
          tableName: table.tableName,
          connectionId: connectionId,
        }
        map.set(key, { ...existing, lastSeenAt: now })
      }
      return { entries: Array.from(map.values()) }
    })
  },

  getAcceptedTables: (connectionId) => {
    const now = Date.now()
    return get()
      .entries.filter((entry) => isActiveEntryOf(entry, connectionId, now))
      .map((entry) => ({
        dbName: entry.dbName,
        tableName: entry.tableName,
        weight: computeWeight(entry, now),
      }))
  },

  cleanup: () => {
    const now = Date.now()
    set((state) => ({
      entries: state.entries.filter((entry) => !isExpired(entry, now)),
    }))
  },
}))
