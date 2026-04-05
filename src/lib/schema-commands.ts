import { invoke } from '@tauri-apps/api/core'
import type {
  ColumnInfo,
  SchemaInfoResponse,
  DatabaseDetails,
  CharsetInfo,
  CollationInfo,
  ForeignKeyInfo,
  ObjectType,
} from '../types/schema'

// ---------------------------------------------------------------------------
// Read-only query commands
// ---------------------------------------------------------------------------

/** List all databases for a connection. */
export async function listDatabases(connectionId: string): Promise<string[]> {
  return invoke<string[]>('list_databases', { connectionId })
}

/** List schema objects of a given type within a database. */
export async function listSchemaObjects(
  connectionId: string,
  database: string,
  objectType: string
): Promise<string[]> {
  return invoke<string[]>('list_schema_objects', { connectionId, database, objectType })
}

/** List columns for a table (or view). */
export async function listColumns(
  connectionId: string,
  database: string,
  table: string
): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>('list_columns', { connectionId, database, table })
}

/** Get full schema info (columns, indexes, FKs, DDL, metadata) for an object. */
export async function getSchemaInfo(
  connectionId: string,
  database: string,
  objectName: string,
  objectType: ObjectType
): Promise<SchemaInfoResponse> {
  return invoke<SchemaInfoResponse>('get_schema_info', {
    connectionId,
    database,
    objectName,
    objectType,
  })
}

/** Get database-level details (charset, collation). */
export async function getDatabaseDetails(
  connectionId: string,
  database: string
): Promise<DatabaseDetails> {
  return invoke<DatabaseDetails>('get_database_details', { connectionId, database })
}

/** List available character sets on the server. */
export async function listCharsets(connectionId: string): Promise<CharsetInfo[]> {
  return invoke<CharsetInfo[]>('list_charsets', { connectionId })
}

/** List available collations on the server. */
export async function listCollations(connectionId: string): Promise<CollationInfo[]> {
  return invoke<CollationInfo[]>('list_collations', { connectionId })
}

/** Get foreign key constraints for a table. */
export async function getTableForeignKeys(
  connectionId: string,
  database: string,
  table: string
): Promise<ForeignKeyInfo[]> {
  return invoke<ForeignKeyInfo[]>('get_table_foreign_keys', { connectionId, database, table })
}

// ---------------------------------------------------------------------------
// Mutating commands
// ---------------------------------------------------------------------------

/** Create a new database. */
export async function createDatabase(
  connectionId: string,
  name: string,
  charset?: string,
  collation?: string
): Promise<void> {
  return invoke<void>('create_database', {
    connectionId,
    name,
    charset: charset ?? null,
    collation: collation ?? null,
  })
}

/** Drop a database. */
export async function dropDatabase(connectionId: string, name: string): Promise<void> {
  return invoke<void>('drop_database', { connectionId, name })
}

/** Alter a database's charset/collation. */
export async function alterDatabase(
  connectionId: string,
  name: string,
  charset?: string,
  collation?: string
): Promise<void> {
  return invoke<void>('alter_database', {
    connectionId,
    name,
    charset: charset ?? null,
    collation: collation ?? null,
  })
}

/** Rename a database (create new → move tables → drop old). */
export async function renameDatabase(
  connectionId: string,
  oldName: string,
  newName: string
): Promise<void> {
  return invoke<void>('rename_database', { connectionId, oldName, newName })
}

/** Drop a table from a database. */
export async function dropTable(
  connectionId: string,
  database: string,
  table: string
): Promise<void> {
  return invoke<void>('drop_table', { connectionId, database, table })
}

/** Truncate a table (delete all rows, reset auto-increment). */
export async function truncateTable(
  connectionId: string,
  database: string,
  table: string
): Promise<void> {
  return invoke<void>('truncate_table', { connectionId, database, table })
}

/** Rename a table within a database. */
export async function renameTable(
  connectionId: string,
  database: string,
  oldName: string,
  newName: string
): Promise<void> {
  return invoke<void>('rename_table', { connectionId, database, oldName, newName })
}
