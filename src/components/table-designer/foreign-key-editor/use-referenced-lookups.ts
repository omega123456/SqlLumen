import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { logFrontendError } from '../../../lib/app-log-commands'
import { listColumns, listDatabases, listSchemaObjects } from '../../../lib/schema-commands'
import type { TableDesignerForeignKeyDef } from '../../../types/schema'
import {
  REFERENCED_TARGET_SEPARATOR,
  referencedDatabasesFor,
  referencedTargetsFor,
} from './foreign-key-editor-model'

type NamesByKey = Record<string, string[]>
type LoadingByKey = Record<string, boolean>
type NameLoader = (connectionId: string, key: string) => Promise<string[]> | null

interface NamedLookupSpec {
  keysFor: (foreignKeys: TableDesignerForeignKeyDef[], databaseName: string) => string[]
  load: NameLoader
  failureMessage: string
}

interface LookupSource {
  connectionId: string | undefined
  databaseName: string | undefined
  foreignKeys: TableDesignerForeignKeyDef[]
}

interface NamedLookupContext {
  spec: NamedLookupSpec
  connectionId: string
  loadedRef: RefObject<Set<string>>
  loadingRef: RefObject<Set<string>>
  setNamesByKey: Dispatch<SetStateAction<NamesByKey>>
  setLoadingByKey: Dispatch<SetStateAction<LoadingByKey>>
}

export interface ReferencedLookups {
  tablesByDatabase: NamesByKey
  loadingTablesByDatabase: LoadingByKey
  columnsByTarget: NamesByKey
  loadingColumnsByTarget: LoadingByKey
}

function loadReferencedTables(connectionId: string, referencedDatabase: string) {
  return listSchemaObjects(connectionId, referencedDatabase, 'table')
}

function loadReferencedColumns(connectionId: string, targetKey: string): Promise<string[]> | null {
  const [referencedDatabase, referencedTable] = targetKey.split(REFERENCED_TARGET_SEPARATOR)
  if (!referencedDatabase) return null
  if (!referencedTable) return null
  return listColumns(connectionId, referencedDatabase, referencedTable).then((loadedColumns) =>
    loadedColumns.map((column) => column.name)
  )
}

const REFERENCED_TABLES_LOOKUP: NamedLookupSpec = {
  keysFor: referencedDatabasesFor,
  load: loadReferencedTables,
  failureMessage: '[foreign-key-editor] Failed to load referenced tables',
}

const REFERENCED_COLUMNS_LOOKUP: NamedLookupSpec = {
  keysFor: referencedTargetsFor,
  load: loadReferencedColumns,
  failureMessage: '[foreign-key-editor] Failed to load referenced columns',
}

function isLookupRequested(context: NamedLookupContext, key: string): boolean {
  return context.loadedRef.current.has(key) || context.loadingRef.current.has(key)
}

function withKey<TValue>(key: string, value: TValue) {
  return (current: Record<string, TValue>) => ({ ...current, [key]: value })
}

function requestLookup(context: NamedLookupContext, key: string): void {
  if (isLookupRequested(context, key)) return
  const pending = context.spec.load(context.connectionId, key)
  if (!pending) return
  context.loadingRef.current.add(key)
  context.setLoadingByKey(withKey(key, true))
  void pending
    .then((names) => {
      context.loadedRef.current.add(key)
      context.setNamesByKey(withKey(key, names))
    })
    .catch((error) => {
      logFrontendError(context.spec.failureMessage, error)
      context.setNamesByKey(withKey<string[]>(key, []))
    })
    .finally(() => {
      context.loadingRef.current.delete(key)
      context.setLoadingByKey(withKey(key, false))
    })
}

function resetLookupRequests(
  loadedRef: RefObject<Set<string>>,
  loadingRef: RefObject<Set<string>>
): void {
  loadedRef.current = new Set()
  loadingRef.current = new Set()
}

function useNamedLookup(spec: NamedLookupSpec, source: LookupSource) {
  const { connectionId, databaseName, foreignKeys } = source
  const [namesByKey, setNamesByKey] = useState<NamesByKey>({})
  const [loadingByKey, setLoadingByKey] = useState<LoadingByKey>({})
  const loadedRef = useRef<Set<string>>(new Set())
  const loadingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    resetLookupRequests(loadedRef, loadingRef)
    queueMicrotask(() => {
      setNamesByKey({})
      setLoadingByKey({})
    })
  }, [connectionId, databaseName])

  useEffect(() => {
    if (!connectionId) return
    if (!databaseName) return
    const context = { spec, connectionId, loadedRef, loadingRef, setNamesByKey, setLoadingByKey }
    spec.keysFor(foreignKeys, databaseName).forEach((key) => requestLookup(context, key))
  }, [connectionId, databaseName, foreignKeys, spec])

  return { namesByKey, loadingByKey }
}

export function useReferencedLookups(source: LookupSource): ReferencedLookups {
  const tables = useNamedLookup(REFERENCED_TABLES_LOOKUP, source)
  const columns = useNamedLookup(REFERENCED_COLUMNS_LOOKUP, source)
  return {
    tablesByDatabase: tables.namesByKey,
    loadingTablesByDatabase: tables.loadingByKey,
    columnsByTarget: columns.namesByKey,
    loadingColumnsByTarget: columns.loadingByKey,
  }
}

function withCurrentDatabase(databases: string[], databaseName: string): string[] {
  return databases.includes(databaseName) ? databases : [databaseName, ...databases]
}

export function useAvailableDatabases(
  connectionId: string | undefined,
  databaseName: string | undefined
) {
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([])
  const [isDatabasesLoading, setIsDatabasesLoading] = useState(false)

  useEffect(() => {
    if (!connectionId) return
    if (!databaseName) return

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setIsDatabasesLoading(true)
    })

    void listDatabases(connectionId)
      .then((databases) => {
        if (!cancelled) setAvailableDatabases(withCurrentDatabase(databases, databaseName))
      })
      .catch((error) => {
        logFrontendError('[foreign-key-editor] Failed to load referenced databases', error)
        if (!cancelled) setAvailableDatabases(databaseName ? [databaseName] : [])
      })
      .finally(() => {
        if (!cancelled) setIsDatabasesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, databaseName])

  return { availableDatabases, isDatabasesLoading }
}
