import { create } from 'zustand'

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

/** Entries older than this are discarded. */
const EXPIRY_MS = 30 * 60 * 1000 // 30 minutes

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Stable key for deduplication. */
function entryKey(connectionId: string, dbName: string, tableName: string): string {
  return `${connectionId}\0${dbName}\0${tableName}`
}

/** Whether an entry has exceeded the 30-minute TTL. */
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
      for (const e of state.entries) {
        map.set(entryKey(e.connectionId, e.dbName, e.tableName), e)
      }
      for (const t of tables) {
        const key = entryKey(connectionId, t.dbName, t.tableName)
        const existing = map.get(key)
        if (existing) {
          map.set(key, { ...existing, lastSeenAt: now })
        } else {
          map.set(key, { dbName: t.dbName, tableName: t.tableName, connectionId, lastSeenAt: now })
        }
      }
      return { entries: Array.from(map.values()) }
    })
  },

  getAcceptedTables: (connectionId) => {
    const now = Date.now()
    return get()
      .entries.filter((e) => e.connectionId === connectionId && !isExpired(e, now))
      .map((e) => ({
        dbName: e.dbName,
        tableName: e.tableName,
        weight: computeWeight(e, now),
      }))
  },

  cleanup: () => {
    const now = Date.now()
    set((state) => ({
      entries: state.entries.filter((e) => !isExpired(e, now)),
    }))
  },
}))
