import { invoke } from '@tauri-apps/api/core'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchemaIndexStatus {
  status: 'not_configured' | 'building' | 'ready' | 'stale' | 'error'
  tablesDone?: number
  tablesTotal?: number
  error?: string
}

export interface SearchResult {
  chunkId: number
  chunkKey: string
  dbName: string
  tableName: string
  chunkType: 'table' | 'fk'
  ddlText: string
  refDbName?: string | null
  refTableName?: string | null
  score: number
}

export interface IndexedTableInfo {
  dbName: string
  tableName: string
  chunkType: string
  embeddedAt: string
  modelId: string
}

// ---------------------------------------------------------------------------
// IPC wrappers
// ---------------------------------------------------------------------------

export async function buildSchemaIndex(sessionId: string): Promise<void> {
  return invoke('build_schema_index', { sessionId })
}

export async function forceRebuildSchemaIndex(sessionId: string): Promise<void> {
  return invoke('force_rebuild_schema_index', { sessionId })
}

export async function semanticSearch(
  sessionId: string,
  queries: string[]
): Promise<SearchResult[]> {
  return invoke('semantic_search', { sessionId, queries })
}

export async function getIndexStatus(sessionId: string): Promise<SchemaIndexStatus> {
  return invoke('get_index_status', { sessionId })
}

export async function invalidateSchemaIndex(sessionId: string, tables: string[]): Promise<void> {
  return invoke('invalidate_schema_index', { sessionId, tables })
}

export async function listIndexedTables(sessionId: string): Promise<IndexedTableInfo[]> {
  return invoke('list_indexed_tables', { sessionId })
}
