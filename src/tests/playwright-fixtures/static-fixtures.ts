import type { AiQueryExpandResponse } from '../../lib/ai-commands'
import type { ExportResult } from '../../lib/export-commands'
import type { ProcessRow } from '../../lib/processlist-commands'
import type { SchemaIndexStatus, SearchResult } from '../../lib/schema-index-commands'
import type {
  DumpJobProgress,
  ExportableDatabase,
  ImportJobProgress,
} from '../../lib/sql-dump-commands'
import type { ConnectionGroup, SavedConnection, TestConnectionResult } from '../../types/connection'
import type {
  AppInfo,
  CharsetInfo,
  CollationInfo,
  DatabaseDetails,
  FavoriteEntry,
  HistoryPage,
  RoutineParameter,
  SaveObjectResponse,
  SchemaMetadataResponse,
  TableDesignerSchema,
} from '../../types/schema'
import { AI_CHAT_FIXTURE, AI_QUERY_EXPANSION, type PlaywrightAiChatFixture } from './ai-chat'
import { APP_INFO, PLAYWRIGHT_PLATFORM } from './app-info'
import { AI_DEFAULT_SETTINGS, DEFAULT_APP_SETTINGS } from './app-settings'
import {
  DEFAULT_CONNECTION_GROUPS,
  NO_OPEN_CONNECTION_DENIAL,
  DEFAULT_SAVED_CONNECTIONS,
  NEW_CONNECTION_GROUP_ID,
  NEW_CONNECTION_ID,
  PLAYWRIGHT_MOCK_CONNECTION,
  PLAYWRIGHT_MOCK_SERVER_VERSION,
  TEST_CONNECTION_RESULT,
  type OpenConnectionDenial,
} from './connections'
import { CHARSETS, COLLATIONS, DATABASE_DETAILS } from './database-encoding'
import { CREATED_FAVORITE_ID, FAVORITES, HISTORY_PAGE } from './history-favorites'
import { OPENED_SQL_FILE_CONTENT, ROUTINE_PARAMETERS, SAVED_OBJECT_RESPONSE } from './object-editor'
import { PROCESS_LIST } from './processlist'
import {
  EXPORT_RESULTS_SUMMARY,
  QUERY_SIMULATION,
  type PlaywrightQuerySimulationFixture,
} from './query-execution'
import { SCHEMA_INDEX_STATUS, SEMANTIC_SEARCH_RESULTS } from './schema-index'
import { EXPORTABLE_DATABASES, SCHEMA_METADATA } from './schema-metadata'
import { SQL_DUMP_JOB_ID, SQL_DUMP_PROGRESS_COMPLETED } from './sql-dump'
import { SQL_IMPORT_JOB_ID, SQL_IMPORT_PROGRESS_RUNNING } from './sql-import'
import { USERS_DESIGNER_SCHEMA } from './table-designer'
import { UPDATE_FIXTURE, type PlaywrightUpdateFixture } from './updater'
import { INSERTED_USER_ROW } from './users'

export interface PlaywrightStaticFixtures {
  appInfo: AppInfo
  platform: string
  appSettings: Record<string, string>
  aiDefaultSettings: Record<string, string>
  update: PlaywrightUpdateFixture
  savedConnection: SavedConnection
  savedConnections: SavedConnection[]
  openConnectionDenial: OpenConnectionDenial | null
  connectionGroups: ConnectionGroup[]
  serverVersion: string
  testConnection: TestConnectionResult
  newConnectionId: string
  newConnectionGroupId: string
  databaseDetails: DatabaseDetails
  charsets: CharsetInfo[]
  collations: CollationInfo[]
  tableDesignerSchema: TableDesignerSchema
  querySimulation: PlaywrightQuerySimulationFixture
  exportResults: ExportResult
  schemaMetadata: SchemaMetadataResponse
  insertedRow: [string, unknown][]
  savedObject: SaveObjectResponse
  routineParameters: RoutineParameter[]
  openedFileContent: string
  exportableDatabases: ExportableDatabase[]
  sqlDumpJobId: string
  sqlDumpProgress: DumpJobProgress
  sqlImportJobId: string
  sqlImportProgress: ImportJobProgress
  processList: ProcessRow[]
  historyPage: HistoryPage
  favorites: FavoriteEntry[]
  createdFavoriteId: number
  aiChat: PlaywrightAiChatFixture
  aiQueryExpansion: AiQueryExpandResponse
  semanticSearchResults: SearchResult[]
  schemaIndexStatus: SchemaIndexStatus
}

export type PlaywrightStaticFixtureName = keyof PlaywrightStaticFixtures

export const DEFAULT_STATIC_FIXTURES: PlaywrightStaticFixtures = {
  appInfo: APP_INFO,
  platform: PLAYWRIGHT_PLATFORM,
  appSettings: DEFAULT_APP_SETTINGS,
  aiDefaultSettings: AI_DEFAULT_SETTINGS,
  update: UPDATE_FIXTURE,
  savedConnection: PLAYWRIGHT_MOCK_CONNECTION,
  savedConnections: DEFAULT_SAVED_CONNECTIONS,
  openConnectionDenial: NO_OPEN_CONNECTION_DENIAL,
  connectionGroups: DEFAULT_CONNECTION_GROUPS,
  serverVersion: PLAYWRIGHT_MOCK_SERVER_VERSION,
  testConnection: TEST_CONNECTION_RESULT,
  newConnectionId: NEW_CONNECTION_ID,
  newConnectionGroupId: NEW_CONNECTION_GROUP_ID,
  databaseDetails: DATABASE_DETAILS,
  charsets: CHARSETS,
  collations: COLLATIONS,
  tableDesignerSchema: USERS_DESIGNER_SCHEMA,
  querySimulation: QUERY_SIMULATION,
  exportResults: EXPORT_RESULTS_SUMMARY,
  schemaMetadata: SCHEMA_METADATA,
  insertedRow: INSERTED_USER_ROW,
  savedObject: SAVED_OBJECT_RESPONSE,
  routineParameters: ROUTINE_PARAMETERS,
  openedFileContent: OPENED_SQL_FILE_CONTENT,
  exportableDatabases: EXPORTABLE_DATABASES,
  sqlDumpJobId: SQL_DUMP_JOB_ID,
  sqlDumpProgress: SQL_DUMP_PROGRESS_COMPLETED,
  sqlImportJobId: SQL_IMPORT_JOB_ID,
  sqlImportProgress: SQL_IMPORT_PROGRESS_RUNNING,
  processList: PROCESS_LIST,
  historyPage: HISTORY_PAGE,
  favorites: FAVORITES,
  createdFavoriteId: CREATED_FAVORITE_ID,
  aiChat: AI_CHAT_FIXTURE,
  aiQueryExpansion: AI_QUERY_EXPANSION,
  semanticSearchResults: SEMANTIC_SEARCH_RESULTS,
  schemaIndexStatus: SCHEMA_INDEX_STATUS,
}
