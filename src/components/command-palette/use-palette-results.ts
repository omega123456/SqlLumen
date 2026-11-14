import { useMemo } from 'react'
import { filterColumns } from '../query-editor/schema-metadata-cache'
import {
  buildCommandPaletteSearchIndex,
  getRecentPaletteResults,
  searchPaletteObjects,
  type PaletteSearchResult,
} from '../../lib/command-palette-search'
import { useConnectionStore } from '../../stores/connection-store'
import {
  useCommandPaletteRecentsStore,
  type CommandPaletteRecentEntry,
} from '../../stores/command-palette-recents-store'
import type { SearchableObject } from '../../types/schema'
import { getSearchFilters } from './palette-pills'
import type { CommandPaletteFilterPillValue, CommandPaletteResultsProps } from './palette-types'
import type { PaletteSchemaObjects } from './use-palette-schema-objects'

function getSearchState(args: {
  connectionId: string | null
  query: string
  results: ReadonlyArray<PaletteSearchResult>
  recentResults: ReadonlyArray<PaletteSearchResult>
  objects: ReadonlyArray<SearchableObject>
  isLoading: boolean
}): CommandPaletteResultsProps['state'] {
  if (!args.connectionId) {
    return 'no-connection'
  }

  const isLoadingFirstObjects = args.objects.length === 0 && args.isLoading
  if (isLoadingFirstObjects) {
    return 'loading'
  }

  if (args.query.trim().length === 0) {
    const hasRecentResults = args.recentResults.length > 0
    return hasRecentResults ? 'recents' : 'empty'
  }

  const hasResults = args.results.length > 0
  return hasResults ? 'results' : 'no-results'
}

const MAX_VISIBLE_RESULTS = 50

function isObjectOfTable(object: SearchableObject, database: string, table: string): boolean {
  return object.database === database && object.name === table
}

interface ActiveResultSelection {
  clampedActiveIndex: number
  activeResult: PaletteSearchResult | null
  activeDescendantId: string | undefined
}

function resolveActiveResultSelection(
  visibleResults: PaletteSearchResult[],
  activeIndex: number
): ActiveResultSelection {
  if (visibleResults.length === 0) {
    return { clampedActiveIndex: 0, activeResult: null, activeDescendantId: undefined }
  }
  const clampedActiveIndex = Math.min(activeIndex, visibleResults.length - 1)
  return {
    clampedActiveIndex: clampedActiveIndex,
    activeResult: visibleResults[clampedActiveIndex],
    activeDescendantId: `command-palette-result-${clampedActiveIndex}`,
  }
}

interface TableColumnScope {
  activeConnectionId: string | null
  databasePill: CommandPaletteFilterPillValue | null
  tablePill: CommandPaletteFilterPillValue | null
  searchableObjects: SearchableObject[]
}

function tableColumnObjects({
  activeConnectionId,
  databasePill,
  tablePill,
  searchableObjects,
}: TableColumnScope): SearchableObject[] {
  if (!activeConnectionId) return []
  if (!databasePill) return []
  if (!tablePill) return []
  const hasSelectedTable = searchableObjects.some((object) =>
    isObjectOfTable(object, databasePill.value, tablePill.label)
  )
  if (!hasSelectedTable) {
    return []
  }

  return filterColumns({
    connectionId: activeConnectionId,
    database: databasePill.value,
    table: tablePill.label,
    prefix: '',
  }).map((column) => ({
    database: databasePill.value,
    table: tablePill.label,
    objectType: 'column',
    name: column.name,
    metaLabel: column.dataType,
  }))
}

function columnRecentResult(column: SearchableObject): PaletteSearchResult {
  return { ...column, score: 0, matchIndices: [], recentRank: null }
}

function usePaletteRecents(activeConnectionId: string | null) {
  const getRecents = useCommandPaletteRecentsStore((state) => state.getRecents)
  const profileId = useConnectionStore((state) =>
    activeConnectionId ? (state.activeConnections[activeConnectionId]?.profile.id ?? null) : null
  )
  return useMemo<CommandPaletteRecentEntry[]>(
    () => (profileId ? getRecents(profileId) : []),
    [getRecents, profileId]
  )
}

function usePaletteSearchSources(scope: TableColumnScope) {
  const { activeConnectionId, databasePill, tablePill, searchableObjects } = scope
  const searchIndex = useMemo(
    () => buildCommandPaletteSearchIndex(searchableObjects),
    [searchableObjects]
  )
  const columnObjects = useMemo<SearchableObject[]>(
    () =>
      tableColumnObjects({
        activeConnectionId: activeConnectionId,
        databasePill: databasePill,
        tablePill: tablePill,
        searchableObjects: searchableObjects,
      }),
    [activeConnectionId, databasePill, searchableObjects, tablePill]
  )
  const columnIndex = useMemo(() => buildCommandPaletteSearchIndex(columnObjects), [columnObjects])
  return { searchIndex, columnObjects, columnIndex }
}

export interface PaletteResultsOptions {
  activeConnectionId: string | null
  schemaObjects: PaletteSchemaObjects
  searchInput: {
    pills: CommandPaletteFilterPillValue[]
    debouncedQuery: string
    activeIndex: number
  }
}

export function usePaletteResults({
  activeConnectionId,
  schemaObjects,
  searchInput,
}: PaletteResultsOptions) {
  const { pills, debouncedQuery, activeIndex } = searchInput
  const { searchableObjects, isLoading } = schemaObjects
  const databasePill = pills.find((pill) => pill.kind === 'database') ?? null
  const tablePill = pills.find((pill) => pill.kind === 'table') ?? null
  const { searchIndex, columnObjects, columnIndex } = usePaletteSearchSources({
    activeConnectionId: activeConnectionId,
    databasePill: databasePill,
    tablePill: tablePill,
    searchableObjects: searchableObjects,
  })
  const recents = usePaletteRecents(activeConnectionId)

  const results = useMemo(
    () =>
      searchPaletteObjects(tablePill ? columnIndex : searchIndex, {
        query: debouncedQuery,
        filters: getSearchFilters(pills),
        recents: tablePill ? [] : recents,
        limit: MAX_VISIBLE_RESULTS,
      }),
    [columnIndex, debouncedQuery, pills, recents, searchIndex, tablePill]
  )

  const recentResults = useMemo(() => {
    if (tablePill) {
      return columnObjects.map(columnRecentResult)
    }

    return getRecentPaletteResults(searchableObjects, {
      filters: getSearchFilters(pills),
      recents: recents,
    })
  }, [columnObjects, pills, recents, searchableObjects, tablePill])

  const visibleResults = debouncedQuery.trim().length > 0 ? results : recentResults
  const searchState = getSearchState({
    connectionId: activeConnectionId,
    query: debouncedQuery,
    results: results,
    recentResults: recentResults,
    objects: searchableObjects,
    isLoading: isLoading,
  })
  return {
    visibleResults: visibleResults,
    searchState: searchState,
    isColumnScope: tablePill != null,
    ...resolveActiveResultSelection(visibleResults, activeIndex),
  }
}
