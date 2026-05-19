import { BIT_TEST_LIST_COLUMNS, BIT_TEST_TABLE_DATA } from './bit-test'
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
  createCurrentDatabaseQueryResult,
  DEFAULT_EXECUTE_QUERY_RESULT,
  JSON_QUERY_RESULT,
  SCROLL_TEST_QUERY_RESULT,
} from './query-results'
import { DEFAULT_SCHEMA_INFO, SCHEMA_INFO_BY_OBJECT_TYPE } from './schema-info'
import { SCROLL_TEST_TABLE_DATA } from './scroll-test'
import type {
  PlaywrightAnalyzeQueryResult,
  PlaywrightForeignKey,
  PlaywrightListColumn,
  PlaywrightQueryResult,
  PlaywrightRoutineParametersResponse,
  PlaywrightSchemaInfo,
  PlaywrightTableDataResult,
} from './types'
import { USERS_ANALYZE_QUERY_RESULT, USERS_FOREIGN_KEYS, USERS_LIST_COLUMNS, USERS_TABLE_DATA } from './users'
import { USER_STATS_VIEW_TABLE_DATA } from './user-stats-view'

type FixtureOverrideDomain =
  | 'tableData'
  | 'columns'
  | 'foreignKeys'
  | 'schemaInfo'
  | 'queryResult'
  | 'analyzeQueryForEdit'
  | 'objectBody'
  | 'routineParams'

type QueryResultFixtureFactory = (activeMockDb: string | null) => PlaywrightQueryResult

type FixtureOverrides = {
  tableData: Record<string, PlaywrightTableDataResult>
  columns: Record<string, PlaywrightListColumn[]>
  foreignKeys: Record<string, PlaywrightForeignKey[]>
  schemaInfo: Record<string, PlaywrightSchemaInfo>
  queryResult: Record<string, QueryResultFixtureFactory>
  analyzeQueryForEdit: Record<string, PlaywrightAnalyzeQueryResult>
  objectBody: Record<string, string>
  routineParams: Record<string, PlaywrightRoutineParametersResponse>
}

type FixtureOverrideValueMap = {
  tableData: PlaywrightTableDataResult
  columns: PlaywrightListColumn[]
  foreignKeys: PlaywrightForeignKey[]
  schemaInfo: PlaywrightSchemaInfo
  queryResult: PlaywrightQueryResult
  analyzeQueryForEdit: PlaywrightAnalyzeQueryResult
  objectBody: string
  routineParams: PlaywrightRoutineParametersResponse
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
  getAnalyzeQueryForEditFixture: (sql: string | null | undefined) => PlaywrightAnalyzeQueryResult
  getObjectBodyFixture: (objectType: string | null | undefined) => string
  getRoutineParamsFixture: (
    routineType: string | null | undefined
  ) => PlaywrightRoutineParametersResponse
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
}

const DEFAULT_COLUMNS_BY_TABLE: Record<string, PlaywrightListColumn[]> = {
  users: USERS_LIST_COLUMNS,
  orders: ORDERS_LIST_COLUMNS,
  bit_test: BIT_TEST_LIST_COLUMNS,
  json_sample: JSON_TABLE_LIST_COLUMNS,
}

const DEFAULT_FOREIGN_KEYS_BY_TABLE: Record<string, PlaywrightForeignKey[]> = {
  users: USERS_FOREIGN_KEYS,
  orders: ORDERS_FOREIGN_KEYS,
}

const DEFAULT_QUERY_RESULT_BY_KEY: Record<string, QueryResultFixtureFactory> = {
  current_database: (activeMockDb) => createCurrentDatabaseQueryResult(activeMockDb),
  scroll_test: () => SCROLL_TEST_QUERY_RESULT,
  json_sample: () => JSON_QUERY_RESULT,
  default: () => DEFAULT_EXECUTE_QUERY_RESULT,
}

const DEFAULT_ANALYZE_QUERY_FOR_EDIT_BY_KEY: Record<string, PlaywrightAnalyzeQueryResult> = {
  json_sample: JSON_ANALYZE_QUERY_RESULT,
  default: USERS_ANALYZE_QUERY_RESULT,
}

const overrides: FixtureOverrides = {
  tableData: {},
  columns: {},
  foreignKeys: {},
  schemaInfo: {},
  queryResult: {},
  analyzeQueryForEdit: {},
  objectBody: {},
  routineParams: {},
}

function normalizeLookupKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
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

export function getSchemaInfoFixture(
  objectType: string | null | undefined
): PlaywrightSchemaInfo {
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
  overrides.analyzeQueryForEdit = {}
  overrides.objectBody = {}
  overrides.routineParams = {}
}

const fixtureRegistry: FixtureRegistryApi = {
  getTableDataFixture,
  getColumnsFixture,
  getForeignKeysFixture,
  getSchemaInfoFixture,
  getQueryResultFixture,
  getAnalyzeQueryForEditFixture,
  getObjectBodyFixture,
  getRoutineParamsFixture,
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
