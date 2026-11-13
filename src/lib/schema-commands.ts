import type {
  ColumnInfo,
  SchemaInfoResponse,
  DatabaseDetails,
  CharsetInfo,
  CollationInfo,
  ForeignKeyInfo,
} from '../types/schema'
import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'
import type { SchemaObjectRequest } from './ipc/requests'

export interface DatabaseEncodingRequest {
  connectionId: string
  name: string
  charset: string | null
  collation: string | null
}

export interface RenameTableRequest {
  connectionId: string
  database: string
  oldName: string
  newName: string
}

export async function listDatabases(connectionId: string): Promise<string[]> {
  return invokeArgumentCommand({ command: 'list_databases', argument: { connectionId } })
}

export async function listSchemaObjects(
  connectionId: string,
  database: string,
  objectType: string
): Promise<string[]> {
  return invokeCommand({
    command: 'list_schema_objects',
    payload: { connectionId, database, objectType },
  })
}

export async function listColumns(
  connectionId: string,
  database: string,
  table: string
): Promise<ColumnInfo[]> {
  return invokeCommand({ command: 'list_columns', payload: { connectionId, database, table } })
}

export async function getSchemaInfo(request: SchemaObjectRequest): Promise<SchemaInfoResponse> {
  return invokeCommand({ command: 'get_schema_info', payload: request })
}

export async function getDatabaseDetails(
  connectionId: string,
  database: string
): Promise<DatabaseDetails> {
  return invokeCommand({ command: 'get_database_details', payload: { connectionId, database } })
}

export async function listCharsets(connectionId: string): Promise<CharsetInfo[]> {
  return invokeArgumentCommand({ command: 'list_charsets', argument: { connectionId } })
}

export async function listCollations(connectionId: string): Promise<CollationInfo[]> {
  return invokeArgumentCommand({ command: 'list_collations', argument: { connectionId } })
}

export async function getTableForeignKeys(
  connectionId: string,
  database: string,
  table: string
): Promise<ForeignKeyInfo[]> {
  return invokeCommand({
    command: 'get_table_foreign_keys',
    payload: { connectionId, database, table },
  })
}

export async function createDatabase(request: DatabaseEncodingRequest): Promise<void> {
  return invokeCommand({ command: 'create_database', payload: request })
}

export async function dropDatabase(connectionId: string, name: string): Promise<void> {
  return invokeCommand({ command: 'drop_database', payload: { connectionId, name } })
}

export async function alterDatabase(request: DatabaseEncodingRequest): Promise<void> {
  return invokeCommand({ command: 'alter_database', payload: request })
}

export async function renameDatabase(
  connectionId: string,
  oldName: string,
  newName: string
): Promise<void> {
  return invokeCommand({ command: 'rename_database', payload: { connectionId, oldName, newName } })
}

export async function dropTable(
  connectionId: string,
  database: string,
  table: string
): Promise<void> {
  return invokeCommand({ command: 'drop_table', payload: { connectionId, database, table } })
}

export async function truncateTable(
  connectionId: string,
  database: string,
  table: string
): Promise<void> {
  return invokeCommand({ command: 'truncate_table', payload: { connectionId, database, table } })
}

export async function renameTable(request: RenameTableRequest): Promise<void> {
  return invokeCommand({ command: 'rename_table', payload: request })
}

export async function invalidateMetadataCache(connectionId: string): Promise<void> {
  return invokeArgumentCommand({ command: 'invalidate_metadata_cache', argument: { connectionId } })
}
