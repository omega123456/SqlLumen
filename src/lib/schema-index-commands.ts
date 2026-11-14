import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'

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
  chunkType: 'table' | 'fk' | 'view' | 'procedure' | 'function'
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

export interface TableHint {
  dbName: string
  tableName: string
  weight: number
}

export interface TableRef {
  dbName: string
  tableName: string
}

export interface RetrievalHints {
  recentTables: TableHint[]
  editorTables: TableRef[]
  acceptedTables: TableHint[]
}

export async function buildSchemaIndex(sessionId: string): Promise<void> {
  return invokeArgumentCommand({ command: 'build_schema_index', argument: { sessionId } })
}

export async function forceRebuildSchemaIndex(sessionId: string): Promise<void> {
  return invokeArgumentCommand({ command: 'force_rebuild_schema_index', argument: { sessionId } })
}

export async function semanticSearch(
  sessionId: string,
  queries: string[],
  hints?: RetrievalHints
): Promise<SearchResult[]> {
  return invokeCommand({
    command: 'semantic_search',
    payload: { sessionId: sessionId, queries: queries, hints: hints ?? null },
  })
}

export async function getIndexStatus(sessionId: string): Promise<SchemaIndexStatus> {
  return invokeArgumentCommand({ command: 'get_index_status', argument: { sessionId } })
}

export async function invalidateSchemaIndex(sessionId: string, tables: string[]): Promise<void> {
  return invokeCommand({ command: 'invalidate_schema_index', payload: { sessionId, tables } })
}

export async function listIndexedTables(sessionId: string): Promise<IndexedTableInfo[]> {
  return invokeArgumentCommand({ command: 'list_indexed_tables', argument: { sessionId } })
}
