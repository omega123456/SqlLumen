import type { SchemaMetadataFull } from '../../types/schema'
import type { LogLevelFilter } from '../log-commands'
import {
  getAiDefaultSettingFixture,
  getCancelCopyFixture,
  getCopyableObjectsFixture,
  getCopyProgressFixture,
  getCopyToHostStartFixture,
  getColumnsFixture,
  getOpenConnectionSessionsFixture,
  getExportLogsFixture,
  getLogsPageFixture,
  getSchemaMetadataFullFixture,
  getSchemaInfoFixture,
  getTargetDatabasesFixture,
  getSchemaObjectsFixture,
  getStaticFixture,
  getTableDdlPreviewFixture,
  getWindowBackdropFixture,
} from '../../tests/playwright-fixtures'
import { returnEmptyList, returnNull, returnUndefined } from './mock-handler-types'
import type { ArgumentCommandHandlers, PayloadCommandHandlers } from './mock-handler-types'
import {
  COMMAND_PALETTE_RECENTS_SETTING_KEY,
  getCommandPaletteRecentsValue,
  maybeDelaySchemaMetadata,
  openMockConnection,
  selectMockDatabase,
} from './mock-session-state'

const PLAYWRIGHT_LOG_LEVEL_FILTERS: ReadonlySet<string> = new Set<LogLevelFilter>([
  'all',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
])

function isPlaywrightLogLevelFilter(level: string): level is LogLevelFilter {
  return PLAYWRIGHT_LOG_LEVEL_FILTERS.has(level)
}

function getMockSetting({ key }: { key: string }): unknown {
  if (key === COMMAND_PALETTE_RECENTS_SETTING_KEY) {
    return getCommandPaletteRecentsValue()
  }
  return getAiDefaultSettingFixture(key)
}

function listMockLogs({ page, level }: { page: number; level: string }): unknown {
  const normalizedLevel = isPlaywrightLogLevelFilter(level) ? level : 'all'
  return getLogsPageFixture(page, normalizedLevel)
}

export const APP_PAYLOAD_HANDLERS = {
  set_setting: returnNull,
  log_frontend: returnNull,
  list_logs: listMockLogs,
  export_logs: (payload) => getExportLogsFixture(payload.startTimestamp, payload.endTimestamp),
} satisfies Partial<PayloadCommandHandlers>

export const APP_ARGUMENT_HANDLERS = {
  get_setting: getMockSetting,
  get_all_settings: () => ({
    ...getStaticFixture('appSettings'),
    [COMMAND_PALETTE_RECENTS_SETTING_KEY]: getCommandPaletteRecentsValue(),
  }),
  get_app_info: () => getStaticFixture('appInfo'),
  set_window_theme: returnNull,
  get_window_backdrop: () => getWindowBackdropFixture(),
  'plugin:webview|set_webview_zoom': returnNull,
} satisfies Partial<ArgumentCommandHandlers>

export const CONNECTION_PAYLOAD_HANDLERS = {
  open_connection: openMockConnection,
  select_database: selectMockDatabase,
  update_connection: returnNull,
  update_connection_group: returnNull,
  save_schema_cache_snapshot: returnNull,
} satisfies Partial<PayloadCommandHandlers>

export const CONNECTION_ARGUMENT_HANDLERS = {
  list_connections: () => [getStaticFixture('savedConnection')],
  list_connection_groups: returnEmptyList,
  list_open_connection_sessions: () => getOpenConnectionSessionsFixture(),
  test_connection: () => getStaticFixture('testConnection'),
  save_connection: () => getStaticFixture('newConnectionId'),
  delete_connection: returnNull,
  get_connection: () => getStaticFixture('savedConnection'),
  create_connection_group: () => getStaticFixture('newConnectionGroupId'),
  delete_connection_group: returnNull,
  close_connection: returnNull,
  get_connection_status: () => 'connected',
  load_schema_cache_snapshot: returnNull,
} satisfies Partial<ArgumentCommandHandlers>

function fetchMockSchemaMetadataFull(): Promise<SchemaMetadataFull> {
  const fixtureMetadata = getSchemaMetadataFullFixture()
  const baseMetadata = globalThis.__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__
  return maybeDelaySchemaMetadata().then((): SchemaMetadataFull => ({
    databases: baseMetadata?.databases ?? fixtureMetadata.databases,
    tables: baseMetadata?.tables ?? fixtureMetadata.tables,
    views: fixtureMetadata.views,
    columns: baseMetadata?.columns ?? fixtureMetadata.columns,
    routines: baseMetadata?.routines ?? fixtureMetadata.routines,
    triggers: fixtureMetadata.triggers,
    foreignKeys: fixtureMetadata.foreignKeys,
    indexes: fixtureMetadata.indexes,
  }))
}

export const SCHEMA_PAYLOAD_HANDLERS = {
  list_copyable_objects: (payload) => getCopyableObjectsFixture(payload.database),
  list_schema_objects: (payload) => getSchemaObjectsFixture(payload.objectType),
  list_columns: (payload) => getColumnsFixture(payload.table),
  get_schema_info: (payload) => getSchemaInfoFixture(payload.objectType ?? 'table'),
  get_database_details: () => getStaticFixture('databaseDetails'),
  load_table_for_designer: () => getStaticFixture('tableDesignerSchema'),
  apply_table_ddl: returnUndefined,
  create_database: returnNull,
  drop_database: returnNull,
  alter_database: returnNull,
  rename_database: returnNull,
  drop_table: returnNull,
  truncate_table: returnNull,
  rename_table: returnNull,
} satisfies Partial<PayloadCommandHandlers>

export const SCHEMA_ARGUMENT_HANDLERS = {
  list_databases: () => getTargetDatabasesFixture(),
  list_charsets: () => getStaticFixture('charsets'),
  list_collations: () => getStaticFixture('collations'),
  generate_table_ddl: (argument) => getTableDdlPreviewFixture(argument.request?.mode),
  invalidate_metadata_cache: returnNull,
  fetch_schema_metadata: () =>
    globalThis.__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__ ?? getStaticFixture('schemaMetadata'),
  fetch_schema_metadata_full: fetchMockSchemaMetadataFull,
} satisfies Partial<ArgumentCommandHandlers>

export const COPY_TO_HOST_ARGUMENT_HANDLERS = {
  start_copy_to_host: () => getCopyToHostStartFixture(),
  get_copy_progress: (argument) => getCopyProgressFixture(argument.jobId),
  cancel_copy: (argument) => getCancelCopyFixture(argument.jobId),
} satisfies Partial<ArgumentCommandHandlers>
