import type { getCache } from '../schema-metadata-cache'

export interface TableRef {
  database: string | null
  table: string
}

export type ParseFallbackMode =
  | { type: 'all' }
  | { type: 'databases' }
  | { type: 'databasesAndTables'; database: string }
  | { type: 'tables'; database: string }
  | { type: 'none' }

export type SchemaCache = ReturnType<typeof getCache>

export interface CaretText {
  statementPrefix: string
  statementText: string
  cursorPrefix: string
  currentWordPrefix: string
}
