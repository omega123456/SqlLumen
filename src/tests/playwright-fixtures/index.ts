import { AI_MODELS_BY_ENDPOINT, DEFAULT_AI_MODELS } from './ai-models'
import { BIT_TEST_LIST_COLUMNS, BIT_TEST_TABLE_DATA } from './bit-test'
import { BLOB_SAMPLE_LIST_COLUMNS, BLOB_SAMPLE_TABLE_DATA } from './blob-sample'
import { DEFAULT_BLOB_VALUE, DEFAULT_BLOB_VALUE_BY_KEY } from './blob-value'
import { COMMAND_PALETTE_RECENTS_FIXTURE, COMMAND_PALETTE_SCHEMA_FIXTURE } from './command-palette'
import { DEFAULT_OPEN_CONNECTION_SESSIONS } from './connections'
import {
  COPY_TO_HOST_OBJECTS,
  COPY_TO_HOST_PROGRESS_COMPLETED,
  COPY_TO_HOST_START_JOB_ID,
  COPY_TO_HOST_TARGET_DATABASES,
} from './copy-to-host'
import { DEFAULT_TABLE_DATA, DEFAULT_TABLE_LIST_COLUMNS } from './default-table'
import { JSON_ANALYZE_QUERY_RESULT, JSON_TABLE_DATA, JSON_TABLE_LIST_COLUMNS } from './json-table'
import {
  getExportLogsFixture as getDefaultExportLogsFixture,
  getLogsPageFixture as getDefaultLogsPageFixture,
} from './logs'
import {
  DEFAULT_OBJECT_BODY,
  DEFAULT_ROUTINE_PARAMETERS_WITH_RETURN_TYPE,
  FUNCTION_ROUTINE_PARAMETERS_WITH_RETURN_TYPE,
  OBJECT_BODY_BY_TYPE,
} from './object-editor'
import { ORDERS_FOREIGN_KEYS, ORDERS_LIST_COLUMNS, ORDERS_TABLE_DATA } from './orders'
import { RESULT_EXPORT_JOB_ID, RESULT_EXPORT_PROGRESS_COMPLETED } from './result-export'
import {
  BLOB_QUERY_RESULT,
  buildResultView,
  createCurrentDatabaseQueryResult,
  createLargeQueryResult,
  createReexecuteResultFixture,
  createTruncatedCallQueryResults,
  createTruncatedQueryResult,
  DEFAULT_CALL_QUERY_RESULTS,
  DEFAULT_EXECUTE_QUERY_RESULT,
  DEFAULT_MULTI_QUERY_RESULTS,
  FIRST_WINDOW_ROWS,
  JSON_QUERY_RESULT,
  SCROLL_TEST_QUERY_RESULT,
  sliceResultWindow,
  toWindowedQueryResult,
} from './query-results'
import { DEFAULT_SCHEMA_INFO, SCHEMA_INFO_BY_OBJECT_TYPE } from './schema-info'
import { DEFAULT_SCHEMA_OBJECTS_BY_TYPE } from './schema-objects'
import { SCROLL_TEST_TABLE_DATA } from './scroll-test'
import {
  DEFAULT_CREATED_SNAPSHOT_ID,
  DEFAULT_SNAPSHOT_STATE_JSON,
  DEFAULT_SNAPSHOT_SUMMARIES,
} from './snapshots'
import type { AiModelInfo } from '../../lib/ai-commands'
import type { LogLevelFilter, LogPage } from '../../lib/log-commands'
import type { SnapshotSummary } from '../../lib/session-snapshot-commands'
import type { OpenConnectionSession } from '../../types/connection'
import type { BlobValueResponse, SchemaMetadataFull } from '../../types/schema'
import type { CopyProgress, CopyableObjects } from '../../lib/copy-to-host-commands'
import type { ResultExportProgress } from '../../lib/export-commands'
import type {
  PlaywrightAnalyzeQueryResult,
  PlaywrightForeignKey,
  PlaywrightListColumn,
  PlaywrightQueryResult,
  PlaywrightQueryResultFixture,
  PlaywrightResultWindow,
  PlaywrightViewSpec,
  PlaywrightRoutineParametersResponse,
  PlaywrightSchemaInfo,
  PlaywrightTableDataResult,
} from './types'
import {
  USERS_ANALYZE_QUERY_RESULT,
  USERS_FOREIGN_KEYS,
  USERS_LIST_COLUMNS,
  USERS_TABLE_DATA,
} from './users'
import { USER_STATS_VIEW_TABLE_DATA } from './user-stats-view'
import { DEFAULT_WINDOW_BACKDROP } from './window-chrome'
import type { WindowBackdrop } from '../../lib/window-commands'

export {
  getGlobalMemoriesFixture,
  getGroupMemoriesFixture,
  getConnectionMemoriesFixture,
  getSavedMemoryFixture,
  getMovedMemoryFixture,
} from './memory'

type FixtureOverrideDomain =
  | 'tableData'
  | 'columns'
  | 'foreignKeys'
  | 'schemaInfo'
  | 'schemaObjects'
  | 'queryResult'
  | 'analyzeQueryForEdit'
  | 'objectBody'
  | 'routineParams'
  | 'copyableObjects'
  | 'targetDatabases'
  | 'copyToHostStart'
  | 'copyProgress'
  | 'copyCancel'
  | 'resultExportStart'
  | 'resultExportProgress'
  | 'resultExportCancel'
  | 'blobValue'
  | 'aiModels'
  | 'logsPage'
  | 'logsExport'
  | 'snapshotList'
  | 'snapshotState'
  | 'snapshotCreatedId'
  | 'schemaMetadataFull'
  | 'commandPaletteRecents'
  | 'openConnectionSessions'
  | 'windowBackdrop'

type QueryResultFixtureFactory = (activeMockDb: string | null) => PlaywrightQueryResultFixture

type FixtureOverrides = {
  tableData: Record<string, PlaywrightTableDataResult>
  columns: Record<string, PlaywrightListColumn[]>
  foreignKeys: Record<string, PlaywrightForeignKey[]>
  schemaInfo: Record<string, PlaywrightSchemaInfo>
  schemaObjects: Record<string, string[]>
  queryResult: Record<string, QueryResultFixtureFactory>
  analyzeQueryForEdit: Record<string, PlaywrightAnalyzeQueryResult>
  objectBody: Record<string, string>
  routineParams: Record<string, PlaywrightRoutineParametersResponse>
  copyableObjects: Record<string, CopyableObjects>
  targetDatabases: Record<string, string[]>
  copyToHostStart: Record<string, string>
  copyProgress: Record<string, CopyProgress>
  copyCancel: Record<string, null>
  resultExportStart: Record<string, string>
  resultExportProgress: Record<string, ResultExportProgress>
  resultExportCancel: Record<string, null>
  blobValue: Record<string, BlobValueResponse>
  aiModels: Record<string, AiModelInfo[]>
  logsPage: Record<string, LogPage>
  logsExport: Record<string, number>
  snapshotList: Record<string, SnapshotSummary[]>
  snapshotState: Record<string, string | null>
  snapshotCreatedId: Record<string, number>
  schemaMetadataFull: Record<string, SchemaMetadataFull>
  commandPaletteRecents: Record<string, string>
  openConnectionSessions: Record<string, OpenConnectionSession[]>
  windowBackdrop: Record<string, WindowBackdrop>
}

type FixtureOverrideValueMap = {
  tableData: PlaywrightTableDataResult
  columns: PlaywrightListColumn[]
  foreignKeys: PlaywrightForeignKey[]
  schemaInfo: PlaywrightSchemaInfo
  schemaObjects: string[]
  queryResult: PlaywrightQueryResultFixture
  analyzeQueryForEdit: PlaywrightAnalyzeQueryResult
  objectBody: string
  routineParams: PlaywrightRoutineParametersResponse
  copyableObjects: CopyableObjects
  targetDatabases: string[]
  copyToHostStart: string
  copyProgress: CopyProgress
  copyCancel: null
  resultExportStart: string
  resultExportProgress: ResultExportProgress
  resultExportCancel: null
  blobValue: BlobValueResponse
  aiModels: AiModelInfo[]
  logsPage: LogPage
  logsExport: number
  snapshotList: SnapshotSummary[]
  snapshotState: string | null
  snapshotCreatedId: number
  schemaMetadataFull: SchemaMetadataFull
  commandPaletteRecents: string
  openConnectionSessions: OpenConnectionSession[]
  windowBackdrop: WindowBackdrop
}

type FixtureRegistryApi = {
  getTableDataFixture: (table: string | null | undefined) => PlaywrightTableDataResult
  getColumnsFixture: (table: string | null | undefined) => PlaywrightListColumn[]
  getForeignKeysFixture: (table: string | null | undefined) => PlaywrightForeignKey[]
  getSchemaInfoFixture: (objectType: string | null | undefined) => PlaywrightSchemaInfo
  getSchemaObjectsFixture: (objectType: string | null | undefined) => string[]
  getQueryResultFixture: (
    sql: string | null | undefined,
    activeMockDb: string | null
  ) => PlaywrightQueryResultFixture
  executeQueryFixture: (args: ExecuteQueryFixtureArgs) => PlaywrightQueryResult
  executeMultiQueryFixture: (args: { tabId: string }) => { results: PlaywrightQueryResult[] }
  executeCallQueryFixture: (args: { tabId: string; sql: string }) => {
    results: PlaywrightQueryResult[]
  }
  reexecuteSingleResultFixture: (args: ReexecuteFixtureArgs) => PlaywrightQueryResult
  setResultViewFixture: (args: SetResultViewFixtureArgs) => SetResultViewFixtureResult
  fetchResultWindowFixture: (args: FetchResultWindowFixtureArgs) => FetchResultWindowFixtureResult
  removeResultRowsFixture: (args: RemoveResultRowsFixtureArgs) => RemoveResultRowsFixtureResult
  getResultWindowRequests: () => ResultWindowRequest[]
  getAnalyzeQueryForEditFixture: (sql: string | null | undefined) => PlaywrightAnalyzeQueryResult
  getObjectBodyFixture: (objectType: string | null | undefined) => string
  getRoutineParamsFixture: (
    routineType: string | null | undefined
  ) => PlaywrightRoutineParametersResponse
  getCopyableObjectsFixture: (database: string | null | undefined) => CopyableObjects
  getTargetDatabasesFixture: () => string[]
  getCopyToHostStartFixture: () => string
  getCopyProgressFixture: (jobId: string | null | undefined) => CopyProgress
  getCancelCopyFixture: (jobId: string | null | undefined) => null
  getResultExportStartFixture: () => string
  getResultExportProgressFixture: (jobId: string | null | undefined) => ResultExportProgress
  getCancelResultExportFixture: (jobId: string | null | undefined) => null
  getBlobValueFixture: (column: string | null | undefined) => BlobValueResponse
  getAiModelsFixture: (endpoint: string | null | undefined) => AiModelInfo[]
  getLogsPageFixture: (
    page: number | null | undefined,
    level: LogLevelFilter | null | undefined
  ) => LogPage
  getExportLogsFixture: (
    startTimestamp: string | null | undefined,
    endTimestamp: string | null | undefined
  ) => number
  getSnapshotListFixture: () => SnapshotSummary[]
  getSnapshotStateFixture: (id: number | null | undefined) => string | null
  getSnapshotCreatedIdFixture: () => number
  getSchemaMetadataFullFixture: () => SchemaMetadataFull
  getCommandPaletteRecentsFixture: () => string
  getOpenConnectionSessionsFixture: () => OpenConnectionSession[]
  getWindowBackdropFixture: () => WindowBackdrop
  overrideFixture: <TDomain extends FixtureOverrideDomain>(
    domain: TDomain,
    key: string,
    data: FixtureOverrideValueMap[TDomain]
  ) => void
  resetFixtureOverrides: () => void
}

const DEFAULT_TABLE_DATA_BY_TABLE: Record<string, PlaywrightTableDataResult> = {
  scroll_test: SCROLL_TEST_TABLE_DATA,
  users: USERS_TABLE_DATA,
  bit_test: BIT_TEST_TABLE_DATA,
  json_sample: JSON_TABLE_DATA,
  orders: ORDERS_TABLE_DATA,
  user_stats_view: USER_STATS_VIEW_TABLE_DATA,
  blob_sample: BLOB_SAMPLE_TABLE_DATA,
}

const DEFAULT_COLUMNS_BY_TABLE: Record<string, PlaywrightListColumn[]> = {
  users: USERS_LIST_COLUMNS,
  orders: ORDERS_LIST_COLUMNS,
  bit_test: BIT_TEST_LIST_COLUMNS,
  json_sample: JSON_TABLE_LIST_COLUMNS,
  blob_sample: BLOB_SAMPLE_LIST_COLUMNS,
}

const DEFAULT_FOREIGN_KEYS_BY_TABLE: Record<string, PlaywrightForeignKey[]> = {
  users: USERS_FOREIGN_KEYS,
  orders: ORDERS_FOREIGN_KEYS,
}

const DEFAULT_QUERY_RESULT_BY_KEY: Record<string, QueryResultFixtureFactory> = {
  current_database: (activeMockDb) => createCurrentDatabaseQueryResult(activeMockDb),
  scroll_test: () => SCROLL_TEST_QUERY_RESULT,
  large_result: () => createLargeQueryResult(),
  truncated_result: () => createTruncatedQueryResult(),
  json_sample: () => JSON_QUERY_RESULT,
  blob_sample: () => BLOB_QUERY_RESULT,
  default: () => DEFAULT_EXECUTE_QUERY_RESULT,
}

const DEFAULT_ANALYZE_QUERY_FOR_EDIT_BY_KEY: Record<string, PlaywrightAnalyzeQueryResult> = {
  json_sample: JSON_ANALYZE_QUERY_RESULT,
  default: USERS_ANALYZE_QUERY_RESULT,
}

const DEFAULT_COPYABLE_OBJECTS_BY_KEY: Record<string, CopyableObjects> = {
  ecommerce_db: COPY_TO_HOST_OBJECTS,
  default: COPY_TO_HOST_OBJECTS,
}

const DEFAULT_TARGET_DATABASES_BY_KEY: Record<string, string[]> = {
  default: COPY_TO_HOST_TARGET_DATABASES,
}

const DEFAULT_COPY_TO_HOST_START_BY_KEY: Record<string, string> = {
  default: COPY_TO_HOST_START_JOB_ID,
}

const DEFAULT_COPY_PROGRESS_BY_KEY: Record<string, CopyProgress> = {
  [COPY_TO_HOST_START_JOB_ID]: COPY_TO_HOST_PROGRESS_COMPLETED,
  default: COPY_TO_HOST_PROGRESS_COMPLETED,
}

const DEFAULT_COPY_CANCEL_BY_KEY: Record<string, null> = {
  default: null,
}

const DEFAULT_RESULT_EXPORT_START_BY_KEY: Record<string, string> = {
  default: RESULT_EXPORT_JOB_ID,
}

const DEFAULT_RESULT_EXPORT_PROGRESS_BY_KEY: Record<string, ResultExportProgress> = {
  [RESULT_EXPORT_JOB_ID]: RESULT_EXPORT_PROGRESS_COMPLETED,
}

const DEFAULT_BLOB_VALUE_LOOKUP: Record<string, BlobValueResponse> = DEFAULT_BLOB_VALUE_BY_KEY
const DEFAULT_SCHEMA_METADATA_FULL_BY_KEY: Record<string, SchemaMetadataFull> = {
  default: COMMAND_PALETTE_SCHEMA_FIXTURE,
}
const DEFAULT_COMMAND_PALETTE_RECENTS_BY_KEY: Record<string, string> = {
  default: COMMAND_PALETTE_RECENTS_FIXTURE,
}

const overrides: FixtureOverrides = {
  tableData: {},
  columns: {},
  foreignKeys: {},
  schemaInfo: {},
  schemaObjects: {},
  queryResult: {},
  analyzeQueryForEdit: {},
  objectBody: {},
  routineParams: {},
  copyableObjects: {},
  targetDatabases: {},
  copyToHostStart: {},
  copyProgress: {},
  copyCancel: {},
  resultExportStart: {},
  resultExportProgress: {},
  resultExportCancel: {},
  blobValue: {},
  aiModels: {},
  logsPage: {},
  logsExport: {},
  snapshotList: {},
  snapshotState: {},
  snapshotCreatedId: {},
  schemaMetadataFull: {},
  commandPaletteRecents: {},
  openConnectionSessions: {},
  windowBackdrop: {},
}

function getLogsPageLookupKey(
  page: number | null | undefined,
  level: LogLevelFilter | null | undefined
): string {
  const normalizedPage = Number.isFinite(page) && typeof page === 'number' && page > 0 ? page : 1
  const normalizedLevel = normalizeLookupKey(level ?? 'all')
  return `${normalizedLevel}__${normalizedPage}`
}

function getLogsExportLookupKey(
  startTimestamp: string | null | undefined,
  endTimestamp: string | null | undefined
): string {
  return `${normalizeLookupKey(startTimestamp)}__${normalizeLookupKey(endTimestamp)}`
}

function normalizeLookupKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function getQueryResultLookupKey(sql: string | null | undefined): string {
  const normalizedSql = String(sql ?? '').trim()

  if (/^\s*SELECT\s+DATABASE\s*\(\s*\)\s*;?\s*$/i.test(normalizedSql)) {
    return 'current_database'
  }

  if (/scroll_test/i.test(normalizedSql)) {
    return 'scroll_test'
  }

  if (/large_result/i.test(normalizedSql)) {
    return 'large_result'
  }

  if (/truncated_result/i.test(normalizedSql)) {
    return 'truncated_result'
  }

  if (/json_sample/i.test(normalizedSql)) {
    return 'json_sample'
  }

  if (/blob_sample/i.test(normalizedSql)) {
    return 'blob_sample'
  }

  return 'default'
}

function getOverrideOrDefault<TKey extends string, TValue>(
  overrideMap: Record<string, TValue>,
  defaultMap: Record<string, TValue>,
  key: TKey,
  fallback: TValue
): TValue {
  return overrideMap[key] ?? defaultMap[key] ?? fallback
}

export function getTableDataFixture(table: string | null | undefined): PlaywrightTableDataResult {
  const tableKey = normalizeLookupKey(table)

  return getOverrideOrDefault(
    overrides.tableData,
    DEFAULT_TABLE_DATA_BY_TABLE,
    tableKey,
    DEFAULT_TABLE_DATA
  )
}

export function getColumnsFixture(table: string | null | undefined): PlaywrightListColumn[] {
  const tableKey = normalizeLookupKey(table)

  return getOverrideOrDefault(
    overrides.columns,
    DEFAULT_COLUMNS_BY_TABLE,
    tableKey,
    DEFAULT_TABLE_LIST_COLUMNS
  )
}

export function getForeignKeysFixture(table: string | null | undefined): PlaywrightForeignKey[] {
  const tableKey = normalizeLookupKey(table)

  return getOverrideOrDefault(overrides.foreignKeys, DEFAULT_FOREIGN_KEYS_BY_TABLE, tableKey, [])
}

export function getSchemaInfoFixture(objectType: string | null | undefined): PlaywrightSchemaInfo {
  const objectTypeKey = normalizeLookupKey(objectType)

  return getOverrideOrDefault(
    overrides.schemaInfo,
    SCHEMA_INFO_BY_OBJECT_TYPE,
    objectTypeKey,
    DEFAULT_SCHEMA_INFO
  )
}

export function getSchemaObjectsFixture(objectType: string | null | undefined): string[] {
  const objectTypeKey = normalizeLookupKey(objectType)

  return getOverrideOrDefault(
    overrides.schemaObjects,
    DEFAULT_SCHEMA_OBJECTS_BY_TYPE,
    objectTypeKey,
    []
  )
}

export function getQueryResultFixture(
  sql: string | null | undefined,
  activeMockDb: string | null
): PlaywrightQueryResultFixture {
  const queryKey = getQueryResultLookupKey(sql)
  const overrideFactory = overrides.queryResult[queryKey]
  const defaultFactory =
    DEFAULT_QUERY_RESULT_BY_KEY[queryKey] ?? DEFAULT_QUERY_RESULT_BY_KEY.default

  return (overrideFactory ?? defaultFactory)(activeMockDb)
}

// ---------------------------------------------------------------------------
// Windowed query results: per-tab result state served like the Rust cache
// ---------------------------------------------------------------------------

interface ResultSlotArgs {
  tabId: string
  resultIndex: number
  queryId: string
}

interface ExecuteQueryFixtureArgs {
  tabId: string
  sql: string
  activeMockDb: string | null
  viewSpec?: PlaywrightViewSpec | null
}

interface ReexecuteFixtureArgs {
  tabId: string
  resultIndex: number
  sql: string
  viewSpec?: PlaywrightViewSpec | null
}

interface SetResultViewFixtureArgs extends ResultSlotArgs {
  baseViewVersion: number
  viewSpec: PlaywrightViewSpec
}

interface SetResultViewFixtureResult {
  viewVersion: number
  viewRowCount: number
  totalRows: number
  firstWindow: PlaywrightResultWindow
}

interface FetchResultWindowFixtureArgs extends ResultSlotArgs {
  viewVersion: number
  offset: number
  limit: number
}

type FetchResultWindowFixtureResult = PlaywrightResultWindow & {
  viewRowCount: number
  viewVersion: number
}

interface RemoveResultRowsFixtureArgs extends ResultSlotArgs {
  baseViewVersion: number
  baseIndices: number[]
}

interface RemoveResultRowsFixtureResult {
  viewVersion: number
  viewRowCount: number
  totalRows: number
}

/** A `fetch_result_window` request, recorded so E2E specs can assert on paging. */
interface ResultWindowRequest {
  tabId: string
  resultIndex: number
  offset: number
  limit: number
}

interface ResultSlotState {
  fixture: PlaywrightQueryResultFixture
  viewVersion: number
  view: number[]
  tombstones: Set<number>
  spec: PlaywrightViewSpec | null
}

const resultSlots = new Map<string, ResultSlotState>()
let resultWindowRequests: ResultWindowRequest[] = []

function slotKey(tabId: string, resultIndex: number): string {
  return `${tabId}:${resultIndex}`
}

function liveRowCount(state: ResultSlotState): number {
  return state.fixture.rows.length - state.tombstones.size
}

function storeResult(
  tabId: string,
  resultIndex: number,
  fixture: PlaywrightQueryResultFixture,
  spec: PlaywrightViewSpec | null
): PlaywrightQueryResult {
  const state: ResultSlotState = {
    fixture,
    viewVersion: 1,
    view: buildResultView(fixture, spec),
    tombstones: new Set(),
    spec,
  }
  resultSlots.set(slotKey(tabId, resultIndex), state)
  return toWindowedQueryResult(fixture, state.view, state.viewVersion, liveRowCount(state))
}

/** The slot for a request; a replaced query or a missing slot is refused like Rust does. */
function requireSlot({ tabId, resultIndex, queryId }: ResultSlotArgs): ResultSlotState {
  const state = resultSlots.get(slotKey(tabId, resultIndex))
  if (!state) {
    throw new Error('results_expired: Results expired. Re-run the query.')
  }
  if (state.fixture.queryId !== queryId) {
    throw new Error('Results were refreshed. Re-run the query to see the latest rows.')
  }
  return state
}

export function executeQueryFixture(args: ExecuteQueryFixtureArgs): PlaywrightQueryResult {
  const fixture = getQueryResultFixture(args.sql, args.activeMockDb)
  // A single statement replaces every result of the tab.
  for (const key of [...resultSlots.keys()]) {
    if (key.startsWith(`${args.tabId}:`)) resultSlots.delete(key)
  }
  return storeResult(args.tabId, 0, fixture, args.viewSpec ?? null)
}

function storeAll(tabId: string, fixtures: PlaywrightQueryResultFixture[]) {
  for (const key of [...resultSlots.keys()]) {
    if (key.startsWith(`${tabId}:`)) resultSlots.delete(key)
  }
  return { results: fixtures.map((fixture, index) => storeResult(tabId, index, fixture, null)) }
}

export function executeMultiQueryFixture(args: { tabId: string }) {
  return storeAll(args.tabId, DEFAULT_MULTI_QUERY_RESULTS)
}

export function executeCallQueryFixture(args: { tabId: string; sql: string }) {
  return storeAll(
    args.tabId,
    /truncated_call/i.test(args.sql)
      ? createTruncatedCallQueryResults()
      : DEFAULT_CALL_QUERY_RESULTS
  )
}

export function reexecuteSingleResultFixture(args: ReexecuteFixtureArgs): PlaywrightQueryResult {
  return storeResult(
    args.tabId,
    args.resultIndex,
    createReexecuteResultFixture(args.sql),
    args.viewSpec ?? null
  )
}

export function setResultViewFixture(args: SetResultViewFixtureArgs): SetResultViewFixtureResult {
  const state = requireSlot(args)
  // Compare-and-swap, as in Rust (D15).
  if (args.baseViewVersion !== state.viewVersion) {
    throw new Error(`view_superseded: current=${state.viewVersion}`)
  }
  const sortColumn = args.viewSpec.sort?.column
  if (sortColumn && !state.fixture.columns.some((column) => column.name === sortColumn)) {
    throw new Error(`Column '${sortColumn}' not found in result`)
  }
  state.spec = args.viewSpec
  state.view = buildResultView(state.fixture, args.viewSpec, state.tombstones)
  state.viewVersion += 1
  return {
    viewVersion: state.viewVersion,
    viewRowCount: state.view.length,
    totalRows: liveRowCount(state),
    firstWindow: sliceResultWindow(state.fixture, state.view, 0, FIRST_WINDOW_ROWS),
  }
}

export function fetchResultWindowFixture(
  args: FetchResultWindowFixtureArgs
): FetchResultWindowFixtureResult {
  const state = requireSlot(args)
  if (args.viewVersion !== state.viewVersion) {
    throw new Error(`view_stale: requested ${args.viewVersion}, current ${state.viewVersion}`)
  }
  resultWindowRequests.push({
    tabId: args.tabId,
    resultIndex: args.resultIndex,
    offset: args.offset,
    limit: args.limit,
  })
  return {
    ...sliceResultWindow(state.fixture, state.view, args.offset, args.limit),
    viewRowCount: state.view.length,
    viewVersion: state.viewVersion,
  }
}

export function removeResultRowsFixture(
  args: RemoveResultRowsFixtureArgs
): RemoveResultRowsFixtureResult {
  const state = requireSlot(args)
  if (args.baseViewVersion !== state.viewVersion) {
    throw new Error(`view_superseded: current=${state.viewVersion}`)
  }
  args.baseIndices.forEach((base) => state.tombstones.add(base))
  state.view = buildResultView(state.fixture, state.spec, state.tombstones)
  state.viewVersion += 1
  return {
    viewVersion: state.viewVersion,
    viewRowCount: state.view.length,
    totalRows: liveRowCount(state),
  }
}

export function getResultWindowRequests(): ResultWindowRequest[] {
  return resultWindowRequests.slice()
}

export function getAnalyzeQueryForEditFixture(
  sql: string | null | undefined
): PlaywrightAnalyzeQueryResult {
  const queryKey = getQueryResultLookupKey(sql)
  return (
    overrides.analyzeQueryForEdit[queryKey] ??
    DEFAULT_ANALYZE_QUERY_FOR_EDIT_BY_KEY[queryKey] ??
    DEFAULT_ANALYZE_QUERY_FOR_EDIT_BY_KEY.default
  )
}

export function getObjectBodyFixture(objectType: string | null | undefined): string {
  const objectTypeKey = normalizeLookupKey(objectType)

  return getOverrideOrDefault(
    overrides.objectBody,
    OBJECT_BODY_BY_TYPE,
    objectTypeKey,
    DEFAULT_OBJECT_BODY
  )
}

export function getRoutineParamsFixture(
  routineType: string | null | undefined
): PlaywrightRoutineParametersResponse {
  const routineTypeKey = normalizeLookupKey(routineType)

  return getOverrideOrDefault(
    overrides.routineParams,
    {
      function: FUNCTION_ROUTINE_PARAMETERS_WITH_RETURN_TYPE,
    },
    routineTypeKey,
    DEFAULT_ROUTINE_PARAMETERS_WITH_RETURN_TYPE
  )
}

export function getCopyableObjectsFixture(database: string | null | undefined): CopyableObjects {
  const databaseKey = normalizeLookupKey(database)

  return (
    overrides.copyableObjects[databaseKey] ??
    DEFAULT_COPYABLE_OBJECTS_BY_KEY[databaseKey] ??
    overrides.copyableObjects.default ??
    DEFAULT_COPYABLE_OBJECTS_BY_KEY.default
  )
}

export function getTargetDatabasesFixture(): string[] {
  return overrides.targetDatabases.default ?? DEFAULT_TARGET_DATABASES_BY_KEY.default
}

export function getCopyToHostStartFixture(): string {
  return overrides.copyToHostStart.default ?? DEFAULT_COPY_TO_HOST_START_BY_KEY.default
}

export function getCopyProgressFixture(jobId: string | null | undefined): CopyProgress {
  const jobKey = normalizeLookupKey(jobId)

  return (
    overrides.copyProgress[jobKey] ??
    DEFAULT_COPY_PROGRESS_BY_KEY[jobKey] ??
    overrides.copyProgress.default ??
    DEFAULT_COPY_PROGRESS_BY_KEY.default
  )
}

export function getCancelCopyFixture(jobId: string | null | undefined): null {
  const jobKey = normalizeLookupKey(jobId)

  return (
    overrides.copyCancel[jobKey] ??
    DEFAULT_COPY_CANCEL_BY_KEY[jobKey] ??
    overrides.copyCancel.default ??
    DEFAULT_COPY_CANCEL_BY_KEY.default
  )
}

export function getResultExportStartFixture(): string {
  return overrides.resultExportStart.default ?? DEFAULT_RESULT_EXPORT_START_BY_KEY.default
}

export function getResultExportProgressFixture(
  jobId: string | null | undefined
): ResultExportProgress {
  const jobKey = normalizeLookupKey(jobId)

  return (
    overrides.resultExportProgress[jobKey] ??
    DEFAULT_RESULT_EXPORT_PROGRESS_BY_KEY[jobKey] ??
    overrides.resultExportProgress.default ??
    RESULT_EXPORT_PROGRESS_COMPLETED
  )
}

export function getCancelResultExportFixture(jobId: string | null | undefined): null {
  const jobKey = normalizeLookupKey(jobId)

  return overrides.resultExportCancel[jobKey] ?? overrides.resultExportCancel.default ?? null
}

export function getBlobValueFixture(column: string | null | undefined): BlobValueResponse {
  const columnKey = normalizeLookupKey(column)

  return (
    overrides.blobValue[columnKey] ??
    DEFAULT_BLOB_VALUE_LOOKUP[columnKey] ??
    overrides.blobValue.default ??
    DEFAULT_BLOB_VALUE_LOOKUP.default ??
    DEFAULT_BLOB_VALUE
  )
}

export function getAiModelsFixture(endpoint: string | null | undefined): AiModelInfo[] {
  const endpointKey = String(endpoint ?? '').trim()
  return overrides.aiModels[endpointKey] ?? AI_MODELS_BY_ENDPOINT[endpointKey] ?? DEFAULT_AI_MODELS
}

export function getLogsPageFixture(
  page: number | null | undefined,
  level: LogLevelFilter | null | undefined
): LogPage {
  const lookupKey = getLogsPageLookupKey(page, level)

  return (
    overrides.logsPage[lookupKey] ??
    getDefaultLogsPageFixture(
      typeof page === 'number' ? page : 1,
      (level ?? 'all') as LogLevelFilter
    )
  )
}

export function getExportLogsFixture(
  startTimestamp: string | null | undefined,
  endTimestamp: string | null | undefined
): number {
  const lookupKey = getLogsExportLookupKey(startTimestamp, endTimestamp)

  return (
    overrides.logsExport[lookupKey] ??
    overrides.logsExport.default ??
    getDefaultExportLogsFixture(String(startTimestamp ?? ''), String(endTimestamp ?? ''))
  )
}

export function getSnapshotListFixture(): SnapshotSummary[] {
  return overrides.snapshotList.default ?? DEFAULT_SNAPSHOT_SUMMARIES
}

export function getSnapshotStateFixture(id: number | null | undefined): string | null {
  const idKey = normalizeLookupKey(id == null ? null : String(id))
  if (idKey in overrides.snapshotState) {
    return overrides.snapshotState[idKey]
  }
  if ('default' in overrides.snapshotState) {
    return overrides.snapshotState.default
  }
  return DEFAULT_SNAPSHOT_STATE_JSON
}

export function getSnapshotCreatedIdFixture(): number {
  return overrides.snapshotCreatedId.default ?? DEFAULT_CREATED_SNAPSHOT_ID
}

export function getSchemaMetadataFullFixture(): SchemaMetadataFull {
  return overrides.schemaMetadataFull.default ?? DEFAULT_SCHEMA_METADATA_FULL_BY_KEY.default
}

export function getCommandPaletteRecentsFixture(): string {
  return overrides.commandPaletteRecents.default ?? DEFAULT_COMMAND_PALETTE_RECENTS_BY_KEY.default
}

export function getOpenConnectionSessionsFixture(): OpenConnectionSession[] {
  return overrides.openConnectionSessions.default ?? DEFAULT_OPEN_CONNECTION_SESSIONS
}

export function getWindowBackdropFixture(): WindowBackdrop {
  return overrides.windowBackdrop.default ?? DEFAULT_WINDOW_BACKDROP
}

export function overrideFixture<TDomain extends FixtureOverrideDomain>(
  domain: TDomain,
  key: string,
  data: FixtureOverrideValueMap[TDomain]
): void {
  const normalizedKey = normalizeLookupKey(key)

  if (!normalizedKey) {
    return
  }

  if (domain === 'queryResult') {
    overrides.queryResult[normalizedKey] = () => data as PlaywrightQueryResultFixture
    return
  }

  ;(overrides[domain] as Record<string, FixtureOverrideValueMap[TDomain]>)[normalizedKey] = data
}

export function resetFixtureOverrides(): void {
  overrides.tableData = {}
  overrides.columns = {}
  overrides.foreignKeys = {}
  overrides.schemaInfo = {}
  overrides.schemaObjects = {}
  overrides.queryResult = {}
  overrides.analyzeQueryForEdit = {}
  resultSlots.clear()
  resultWindowRequests = []
  overrides.objectBody = {}
  overrides.routineParams = {}
  overrides.copyableObjects = {}
  overrides.targetDatabases = {}
  overrides.copyToHostStart = {}
  overrides.copyProgress = {}
  overrides.copyCancel = {}
  overrides.resultExportStart = {}
  overrides.resultExportProgress = {}
  overrides.resultExportCancel = {}
  overrides.blobValue = {}
  overrides.aiModels = {}
  overrides.logsPage = {}
  overrides.logsExport = {}
  overrides.snapshotList = {}
  overrides.snapshotState = {}
  overrides.snapshotCreatedId = {}
  overrides.schemaMetadataFull = {}
  overrides.commandPaletteRecents = {}
  overrides.openConnectionSessions = {}
  overrides.windowBackdrop = {}
}

const fixtureRegistry: FixtureRegistryApi = {
  getTableDataFixture,
  getColumnsFixture,
  getForeignKeysFixture,
  getSchemaInfoFixture,
  getSchemaObjectsFixture,
  getQueryResultFixture,
  executeQueryFixture,
  executeMultiQueryFixture,
  executeCallQueryFixture,
  reexecuteSingleResultFixture,
  setResultViewFixture,
  fetchResultWindowFixture,
  removeResultRowsFixture,
  getResultWindowRequests,
  getAnalyzeQueryForEditFixture,
  getObjectBodyFixture,
  getRoutineParamsFixture,
  getCopyableObjectsFixture,
  getTargetDatabasesFixture,
  getCopyToHostStartFixture,
  getCopyProgressFixture,
  getCancelCopyFixture,
  getResultExportStartFixture,
  getResultExportProgressFixture,
  getCancelResultExportFixture,
  getBlobValueFixture,
  getAiModelsFixture,
  getLogsPageFixture,
  getExportLogsFixture,
  getSnapshotListFixture,
  getSnapshotStateFixture,
  getSnapshotCreatedIdFixture,
  getSchemaMetadataFullFixture,
  getCommandPaletteRecentsFixture,
  getOpenConnectionSessionsFixture,
  getWindowBackdropFixture,
  overrideFixture,
  resetFixtureOverrides,
}

declare global {
  interface Window {
    __PLAYWRIGHT_FIXTURE_REGISTRY__?: FixtureRegistryApi
  }
}

if (typeof window !== 'undefined') {
  window.__PLAYWRIGHT_FIXTURE_REGISTRY__ = fixtureRegistry
}

export type { FixtureOverrideDomain, FixtureRegistryApi, FixtureOverrideValueMap }
