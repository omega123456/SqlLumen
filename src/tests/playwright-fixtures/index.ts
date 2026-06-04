import { AI_MODELS_BY_ENDPOINT, DEFAULT_AI_MODELS } from './ai-models'
import { BIT_TEST_LIST_COLUMNS, BIT_TEST_TABLE_DATA } from './bit-test'
import { BLOB_SAMPLE_LIST_COLUMNS, BLOB_SAMPLE_TABLE_DATA } from './blob-sample'
import { DEFAULT_BLOB_VALUE, DEFAULT_BLOB_VALUE_BY_KEY } from './blob-value'
import {
  COPY_TO_HOST_OBJECTS,
  COPY_TO_HOST_PROGRESS_COMPLETED,
  COPY_TO_HOST_START_JOB_ID,
  COPY_TO_HOST_TARGET_DATABASES,
} from './copy-to-host'
import { DEFAULT_TABLE_DATA, DEFAULT_TABLE_LIST_COLUMNS } from './default-table'
import { JSON_ANALYZE_QUERY_RESULT, JSON_TABLE_DATA, JSON_TABLE_LIST_COLUMNS } from './json-table'
import {
  DEFAULT_OBJECT_BODY,
  DEFAULT_ROUTINE_PARAMETERS_WITH_RETURN_TYPE,
  FUNCTION_ROUTINE_PARAMETERS_WITH_RETURN_TYPE,
  OBJECT_BODY_BY_TYPE,
} from './object-editor'
import { ORDERS_FOREIGN_KEYS, ORDERS_LIST_COLUMNS, ORDERS_TABLE_DATA } from './orders'
import {
  BLOB_CACHED_ROWS_RESULT,
  BLOB_QUERY_RESULT,
  createCurrentDatabaseQueryResult,
  DEFAULT_CACHED_ROWS_RESULT,
  DEFAULT_SECOND_RESULT_CACHED_ROWS_RESULT,
  DEFAULT_EXECUTE_QUERY_RESULT,
  JSON_CACHED_ROWS_RESULT,
  JSON_QUERY_RESULT,
  SCROLL_TEST_QUERY_RESULT,
} from './query-results'
import { DEFAULT_SCHEMA_INFO, SCHEMA_INFO_BY_OBJECT_TYPE } from './schema-info'
import { SCROLL_TEST_TABLE_DATA } from './scroll-test'
import type { AiModelInfo } from '../../lib/ai-commands'
import type { BlobValueResponse } from '../../types/schema'
import type { CopyProgress, CopyableObjects } from '../../lib/copy-to-host-commands'
import type {
  PlaywrightAnalyzeQueryResult,
  PlaywrightCachedRowsResult,
  PlaywrightForeignKey,
  PlaywrightListColumn,
  PlaywrightQueryResult,
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
  | 'queryResult'
  | 'cachedRows'
  | 'analyzeQueryForEdit'
  | 'objectBody'
  | 'routineParams'
  | 'copyableObjects'
  | 'targetDatabases'
  | 'copyToHostStart'
  | 'copyProgress'
  | 'copyCancel'
  | 'blobValue'
  | 'aiModels'

type QueryResultFixtureFactory = (activeMockDb: string | null) => PlaywrightQueryResult

type FixtureOverrides = {
  tableData: Record<string, PlaywrightTableDataResult>
  columns: Record<string, PlaywrightListColumn[]>
  foreignKeys: Record<string, PlaywrightForeignKey[]>
  schemaInfo: Record<string, PlaywrightSchemaInfo>
  queryResult: Record<string, QueryResultFixtureFactory>
  cachedRows: Record<string, PlaywrightCachedRowsResult>
  analyzeQueryForEdit: Record<string, PlaywrightAnalyzeQueryResult>
  objectBody: Record<string, string>
  routineParams: Record<string, PlaywrightRoutineParametersResponse>
  copyableObjects: Record<string, CopyableObjects>
  targetDatabases: Record<string, string[]>
  copyToHostStart: Record<string, string>
  copyProgress: Record<string, CopyProgress>
  copyCancel: Record<string, null>
  blobValue: Record<string, BlobValueResponse>
  aiModels: Record<string, AiModelInfo[]>
}

type FixtureOverrideValueMap = {
  tableData: PlaywrightTableDataResult
  columns: PlaywrightListColumn[]
  foreignKeys: PlaywrightForeignKey[]
  schemaInfo: PlaywrightSchemaInfo
  queryResult: PlaywrightQueryResult
  cachedRows: PlaywrightCachedRowsResult
  analyzeQueryForEdit: PlaywrightAnalyzeQueryResult
  objectBody: string
  routineParams: PlaywrightRoutineParametersResponse
  copyableObjects: CopyableObjects
  targetDatabases: string[]
  copyToHostStart: string
  copyProgress: CopyProgress
  copyCancel: null
  blobValue: BlobValueResponse
  aiModels: AiModelInfo[]
}

type FixtureRegistryApi = {
  getTableDataFixture: (table: string | null | undefined) => PlaywrightTableDataResult
  getColumnsFixture: (table: string | null | undefined) => PlaywrightListColumn[]
  getForeignKeysFixture: (table: string | null | undefined) => PlaywrightForeignKey[]
  getSchemaInfoFixture: (objectType: string | null | undefined) => PlaywrightSchemaInfo
  getQueryResultFixture: (
    sql: string | null | undefined,
    activeMockDb: string | null
  ) => PlaywrightQueryResult
  getCachedRowsFixture: (
    queryId: string | null | undefined,
    resultIndex: number | null | undefined
  ) => PlaywrightCachedRowsResult
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
  getBlobValueFixture: (column: string | null | undefined) => BlobValueResponse
  getAiModelsFixture: (endpoint: string | null | undefined) => AiModelInfo[]
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
  json_sample: () => JSON_QUERY_RESULT,
  blob_sample: () => BLOB_QUERY_RESULT,
  default: () => DEFAULT_EXECUTE_QUERY_RESULT,
}

const DEFAULT_CACHED_ROWS_BY_KEY: Record<string, PlaywrightCachedRowsResult> = {
  'mock-query-id-1__0': DEFAULT_CACHED_ROWS_RESULT,
  'mock-query-id-1__1': DEFAULT_SECOND_RESULT_CACHED_ROWS_RESULT,
  'mock-query-json__0': JSON_CACHED_ROWS_RESULT,
  'mock-query-blob__0': BLOB_CACHED_ROWS_RESULT,
  default: DEFAULT_CACHED_ROWS_RESULT,
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

const DEFAULT_BLOB_VALUE_LOOKUP: Record<string, BlobValueResponse> = DEFAULT_BLOB_VALUE_BY_KEY

const overrides: FixtureOverrides = {
  tableData: {},
  columns: {},
  foreignKeys: {},
  schemaInfo: {},
  queryResult: {},
  cachedRows: {},
  analyzeQueryForEdit: {},
  objectBody: {},
  routineParams: {},
  copyableObjects: {},
  targetDatabases: {},
  copyToHostStart: {},
  copyProgress: {},
  copyCancel: {},
  blobValue: {},
  aiModels: {},
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

export function getQueryResultFixture(
  sql: string | null | undefined,
  activeMockDb: string | null
): PlaywrightQueryResult {
  const queryKey = getQueryResultLookupKey(sql)
  const overrideFactory = overrides.queryResult[queryKey]
  const defaultFactory =
    DEFAULT_QUERY_RESULT_BY_KEY[queryKey] ?? DEFAULT_QUERY_RESULT_BY_KEY.default

  return (overrideFactory ?? defaultFactory)(activeMockDb)
}

function getCachedRowsLookupKey(
  queryId: string | null | undefined,
  resultIndex: number | null | undefined
): string {
  const normalizedQueryId = normalizeLookupKey(queryId)
  const normalizedResultIndex = typeof resultIndex === 'number' ? resultIndex : 0
  return `${normalizedQueryId}__${normalizedResultIndex}`
}

export function getCachedRowsFixture(
  queryId: string | null | undefined,
  resultIndex: number | null | undefined
): PlaywrightCachedRowsResult {
  const lookupKey = getCachedRowsLookupKey(queryId, resultIndex)

  return (
    overrides.cachedRows[lookupKey] ??
    DEFAULT_CACHED_ROWS_BY_KEY[lookupKey] ??
    overrides.cachedRows.default ??
    DEFAULT_CACHED_ROWS_BY_KEY.default
  )
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
  return (
    overrides.aiModels[endpointKey] ?? AI_MODELS_BY_ENDPOINT[endpointKey] ?? DEFAULT_AI_MODELS
  )
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
    overrides.queryResult[normalizedKey] = () => data as PlaywrightQueryResult
    return
  }

  ;(overrides[domain] as Record<string, FixtureOverrideValueMap[TDomain]>)[normalizedKey] = data
}

export function resetFixtureOverrides(): void {
  overrides.tableData = {}
  overrides.columns = {}
  overrides.foreignKeys = {}
  overrides.schemaInfo = {}
  overrides.queryResult = {}
  overrides.cachedRows = {}
  overrides.analyzeQueryForEdit = {}
  overrides.objectBody = {}
  overrides.routineParams = {}
  overrides.copyableObjects = {}
  overrides.targetDatabases = {}
  overrides.copyToHostStart = {}
  overrides.copyProgress = {}
  overrides.copyCancel = {}
  overrides.blobValue = {}
  overrides.aiModels = {}
}

const fixtureRegistry: FixtureRegistryApi = {
  getTableDataFixture,
  getColumnsFixture,
  getForeignKeysFixture,
  getSchemaInfoFixture,
  getQueryResultFixture,
  getCachedRowsFixture,
  getAnalyzeQueryForEditFixture,
  getObjectBodyFixture,
  getRoutineParamsFixture,
  getCopyableObjectsFixture,
  getTargetDatabasesFixture,
  getCopyToHostStartFixture,
  getCopyProgressFixture,
  getCancelCopyFixture,
  getBlobValueFixture,
  getAiModelsFixture,
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
