import { useCallback, useEffect, useRef, useState } from 'react'
import { evictTableData, fetchTableData } from '../../../lib/table-data-commands'
import type {
  TableDataColumnMeta,
  TableDataResponse,
  PrimaryKeyInfo,
  FilterCondition,
} from '../../../types/schema'
import { logFrontend } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'
import {
  LOOKUP_PAGE_SIZE,
  initialLookupFilter,
  lookupSortRequest,
  toLookupRows,
  type LookupPageRequest,
  type LookupRow,
  type LookupSort,
} from './fk-lookup-model'

export interface FkLookupSource {
  connectionId: string
  database: string
  referencedTable: string
}

interface LoadedLookupPage {
  columns: TableDataColumnMeta[]
  rows: LookupRow[]
  primaryKey: PrimaryKeyInfo | null
  executionTimeMs: number
}

const EMPTY_LOOKUP_PAGE: LoadedLookupPage = {
  columns: [],
  rows: [],
  primaryKey: null,
  executionTimeMs: 0,
}

export interface LookupQuery {
  currentPage: number
  pageSize: number
  filterModel: FilterCondition[]
  sort: LookupSort | null
}

const INITIAL_PAGE = 1

function initialQuery(filterModel: FilterCondition[]): LookupQuery {
  return {
    currentPage: INITIAL_PAGE,
    pageSize: LOOKUP_PAGE_SIZE,
    filterModel: filterModel,
    sort: null,
  }
}

function cacheTabIdOf({ connectionId, database, referencedTable }: FkLookupSource): string {
  return `fk-lookup-${connectionId}-${database}-${referencedTable}`
}

function toPageRequest(query: LookupQuery): LookupPageRequest {
  return {
    page: query.currentPage,
    size: query.pageSize,
    filters: query.filterModel,
    sortInfo: query.sort,
  }
}

function paramsKeyOf(query: LookupQuery): string {
  return JSON.stringify({
    filterModel: query.filterModel,
    sort: query.sort,
    currentPage: query.currentPage,
    pageSize: query.pageSize,
  })
}

function toLoadedPage(response: TableDataResponse): LoadedLookupPage {
  return {
    columns: response.columns,
    rows: toLookupRows(response),
    primaryKey: response.primaryKey,
    executionTimeMs: response.executionTimeMs,
  }
}

function useMountedRef() {
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  return mountedRef
}

function useLookupState() {
  const [query, setQuery] = useState<LookupQuery>(() => initialQuery([]))
  const [page, setPage] = useState<LoadedLookupPage>(EMPTY_LOOKUP_PAGE)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null)
  return {
    query,
    setQuery,
    page,
    setPage,
    isLoading,
    setIsLoading,
    error,
    setError,
    selectedRowKey,
    setSelectedRowKey,
  }
}

type LookupState = ReturnType<typeof useLookupState>

function useLoadLookupPage(source: FkLookupSource, state: LookupState) {
  const { connectionId, database, referencedTable } = source
  const cacheTabId = cacheTabIdOf(source)
  const mountedRef = useMountedRef()
  const loadRequestTokenRef = useRef(0)
  const { setQuery, setPage, setIsLoading, setError, setSelectedRowKey } = state
  return useCallback(
    async ({ page, size, filters, sortInfo }: LookupPageRequest) => {
      const thisToken = ++loadRequestTokenRef.current
      const isCurrentRequest = () => mountedRef.current && loadRequestTokenRef.current === thisToken
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchTableData({
          connectionId: connectionId,
          tabId: cacheTabId,
          database: database,
          table: referencedTable,
          page: page,
          pageSize: size,
          ...lookupSortRequest(sortInfo),
          filterModel: filters.length > 0 ? filters : undefined,
        })
        if (!isCurrentRequest()) return
        setPage(toLoadedPage(response))
        setQuery((current) => ({
          ...current,
          currentPage: response.currentPage,
          pageSize: response.pageSize,
        }))
      } catch (error) {
        if (!isCurrentRequest()) return
        setError(toErrorMessage(error))
        setPage((current) => ({ ...current, rows: [] }))
        setSelectedRowKey(null)
      } finally {
        if (isCurrentRequest()) setIsLoading(false)
      }
    },
    [
      cacheTabId,
      connectionId,
      database,
      referencedTable,
      mountedRef,
      setQuery,
      setPage,
      setIsLoading,
      setError,
      setSelectedRowKey,
    ]
  )
}

function useEvictCacheOnClose(source: FkLookupSource, isOpen: boolean) {
  const { connectionId } = source
  const cacheTabId = cacheTabIdOf(source)
  useEffect(() => {
    if (!isOpen) return
    return () => {
      evictTableData({ connectionId: connectionId, tabId: cacheTabId }).catch((error: unknown) => {
        const errorMessage = toErrorMessage(error)
        logFrontend('warn', `FK lookup cache cleanup failed for ${cacheTabId}: ${errorMessage}`)
      })
    }
  }, [cacheTabId, connectionId, isOpen])
}

export interface LookupOpenRequest {
  isOpen: boolean
  currentValue: unknown
  referencedColumn: string
}

interface LookupReloadInputs {
  request: LookupOpenRequest
  state: LookupState
  loadData: (request: LookupPageRequest) => Promise<void>
}

function useLookupReloads({ request, state, loadData }: LookupReloadInputs) {
  const { isOpen, currentValue, referencedColumn } = request
  const { query, setQuery, setPage, setError } = state
  const hasInitializedRef = useRef(false)
  const previousParamsRef = useRef<string>('')
  const suppressReloadRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      hasInitializedRef.current = false
      return
    }
    if (hasInitializedRef.current) return
    hasInitializedRef.current = true
    const openingQuery = initialQuery(initialLookupFilter(currentValue, referencedColumn))
    setQuery(openingQuery)
    setError(null)
    setPage((current) => ({ ...current, rows: [], columns: [] }))
    previousParamsRef.current = paramsKeyOf(openingQuery)
    suppressReloadRef.current = true
    void loadData(toPageRequest(openingQuery))
  }, [isOpen, currentValue, referencedColumn, loadData, setQuery, setError, setPage])

  useEffect(() => {
    if (!isOpen) return
    if (!hasInitializedRef.current) return
    if (suppressReloadRef.current) {
      suppressReloadRef.current = false
      return
    }
    const paramsKey = paramsKeyOf(query)
    if (paramsKey === previousParamsRef.current) return
    previousParamsRef.current = paramsKey
    void loadData(toPageRequest(query))
  }, [isOpen, query, loadData])
}

export function useFkLookupData(source: FkLookupSource, request: LookupOpenRequest) {
  const state = useLookupState()
  const loadData = useLoadLookupPage(source, state)
  useEvictCacheOnClose(source, request.isOpen)
  useLookupReloads({ request: request, state: state, loadData: loadData })
  const { query } = state
  const retry = useCallback(() => void loadData(toPageRequest(query)), [loadData, query])
  return { ...state, retry }
}

export type FkLookupData = ReturnType<typeof useFkLookupData>
