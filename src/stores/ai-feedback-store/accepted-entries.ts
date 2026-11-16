import { milliseconds } from 'date-fns'

export interface AcceptedEntry {
  dbName: string
  tableName: string
  connectionId: string
  lastSeenAt: number
}

export interface AcceptedTable {
  dbName: string
  tableName: string
}

export interface WeightedAcceptedTable extends AcceptedTable {
  weight: number
}

export interface AcceptedTablesRecord {
  connectionId: string
  tables: AcceptedTable[]
  seenAt: number
}

export interface AcceptedTablesQuery {
  connectionId: string
  now: number
}

interface AcceptedEntries {
  entries: AcceptedEntry[]
}

const EXPIRY_MINUTES = 30
const EXPIRY_MS = milliseconds({ minutes: EXPIRY_MINUTES })
const ENTRY_KEY_SEPARATOR = '\0'

function entryKey(entry: Omit<AcceptedEntry, 'lastSeenAt'>): string {
  return [entry.connectionId, entry.dbName, entry.tableName].join(ENTRY_KEY_SEPARATOR)
}

function isExpired(entry: AcceptedEntry, now: number): boolean {
  return now - entry.lastSeenAt >= EXPIRY_MS
}

function recencyWeight(entry: AcceptedEntry, now: number): number {
  const age = now - entry.lastSeenAt
  return Math.max(0, 1 - age / EXPIRY_MS)
}

export function recordAcceptedTables(
  state: AcceptedEntries,
  { connectionId, tables, seenAt }: AcceptedTablesRecord
): AcceptedEntries {
  const entriesByKey = new Map(state.entries.map((entry) => [entryKey(entry), entry]))
  for (const table of tables) {
    const seenEntry = {
      dbName: table.dbName,
      tableName: table.tableName,
      connectionId: connectionId,
      lastSeenAt: seenAt,
    }
    entriesByKey.set(entryKey(seenEntry), seenEntry)
  }
  return { entries: [...entriesByKey.values()] }
}

export function dropExpiredEntries(state: AcceptedEntries, now: number): AcceptedEntries {
  return { entries: state.entries.filter((entry) => !isExpired(entry, now)) }
}

export function weightedAcceptedTables(
  entries: AcceptedEntry[],
  { connectionId, now }: AcceptedTablesQuery
): WeightedAcceptedTable[] {
  return dropExpiredEntries({ entries: entries }, now)
    .entries.filter((entry) => entry.connectionId === connectionId)
    .map((entry) => ({
      dbName: entry.dbName,
      tableName: entry.tableName,
      weight: recencyWeight(entry, now),
    }))
}
