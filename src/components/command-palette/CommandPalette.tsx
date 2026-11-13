import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { DialogShell } from '../dialogs/DialogShell'
import {
  filterColumns,
  getCache,
  getPendingLoad,
  getSearchableObjects,
  loadCache,
} from '../query-editor/schema-metadata-cache'
import { getPendingBootstrap } from '../../lib/schema-cache-bootstrap'
import { activateColumnFromPalette, activateObjectFromPalette } from '../../lib/object-activation'
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
import { useCommandPaletteStore } from '../../stores/command-palette-store'
import { useQueryStore } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type {
  PaletteTypeFilter,
  SearchableObject,
  TableDataTab,
  WorkspaceTab,
} from '../../types/schema'
import { CommandPaletteFooter } from './CommandPaletteKeyHints'
import { CommandPaletteInput } from './CommandPaletteInput'
import { CommandPaletteResults } from './CommandPaletteResults'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import { PALETTE_KEYS } from './palette-keys'
import { buildSlashOptions, TYPE_ALIASES } from './slash-options'
import styles from './CommandPalette.module.css'
import { isScopedTableDataTabOf } from '../../lib/workspace-tab-stacks'
import { isSameTextIgnoringCase } from '../../lib/value-checks'

const MAX_FILTER_PILLS = 2
const QUERY_DEBOUNCE_MS = 80

export interface CommandPaletteFilterPillValue {
  kind: 'database' | 'object-type' | 'table'
  value: string
  label: string
}

export interface CommandPaletteInputProps {
  query: string
  pills: ReadonlyArray<CommandPaletteFilterPillValue>
  isSlashDropdownOpen: boolean
  onQueryChange: (value: string) => void
  onQueryKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onPillRemove: (pill: CommandPaletteFilterPillValue) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  activeDescendantId?: string
}

export interface CommandPaletteResultsProps {
  results: ReadonlyArray<PaletteSearchResult>
  activeIndex: number
  state: 'no-connection' | 'loading' | 'empty' | 'recents' | 'results' | 'no-results'
  isColumnScope?: boolean
  onSelect: (result: PaletteSearchResult) => void
}

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

function addOrReplacePill(
  pills: ReadonlyArray<CommandPaletteFilterPillValue>,
  nextPill: CommandPaletteFilterPillValue
): CommandPaletteFilterPillValue[] {
  const withoutSameKind = pills.filter((pill) => pill.kind !== nextPill.kind)
  const withNewPill = [...withoutSameKind, nextPill]
  return withNewPill.slice(-MAX_FILTER_PILLS)
}

function getSearchFilters(pills: ReadonlyArray<CommandPaletteFilterPillValue>) {
  return {
    database: pills.find((pill) => pill.kind === 'database')?.value ?? null,
    objectType:
      (pills.find((pill) => pill.kind === 'object-type')?.value as PaletteTypeFilter | undefined) ??
      null,
    table: pills.find((pill) => pill.kind === 'table')?.label ?? null,
  }
}

function scopedBottomPanelTableTab(
  tabs: WorkspaceTab[],
  activeTab: WorkspaceTab | undefined
): TableDataTab | undefined {
  if (activeTab?.type !== 'query-editor') return undefined
  const bottomPanelItem = useQueryStore.getState().tabs[activeTab.id]?.activeBottomPanelItem
  if (bottomPanelItem?.type !== 'table-data') return undefined
  const bottomPanelTab = tabs.find((tab) => tab.id === bottomPanelItem.tabId)
  return isScopedTableDataTabOf(bottomPanelTab, activeTab.id) ? bottomPanelTab : undefined
}

function resolveActiveTableTab(
  tabs: WorkspaceTab[],
  activeTab: WorkspaceTab | undefined
): TableDataTab | undefined {
  if (activeTab?.type === 'table-data') return activeTab
  return scopedBottomPanelTableTab(tabs, activeTab)
}

function getInitialPills(connectionId: string | null): CommandPaletteFilterPillValue[] {
  if (!connectionId) return []

  const workspace = useWorkspaceStore.getState()
  const tabs = workspace.tabsByConnection[connectionId] ?? []
  const activeTabId = workspace.activeTabByConnection[connectionId]
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const tableTab = resolveActiveTableTab(tabs, activeTab)

  if (!tableTab) return []

  return [
    {
      kind: 'database',
      value: tableTab.databaseName,
      label: tableTab.databaseName,
    },
    {
      kind: 'table',
      value: `${tableTab.databaseName}.${tableTab.objectName}`,
      label: tableTab.objectName,
    },
  ]
}

interface ParsedSlashState {
  query: string
  pills: CommandPaletteFilterPillValue[]
  isSlashDropdownOpen: boolean
  slashQuery: string
}

function slashTokenPill(
  token: string,
  databases: ReadonlyArray<string>
): CommandPaletteFilterPillValue | null {
  const typeMatch = TYPE_ALIASES.get(token)
  if (typeMatch) return typeMatch
  const databaseMatch = databases.find((database) => isSameTextIgnoringCase(database, token))
  if (!databaseMatch) return null
  return { kind: 'database', value: databaseMatch, label: databaseMatch }
}

function isSchemaCachePending(connectionId: string | null): boolean {
  if (connectionId === null) return false
  return getCache(connectionId).status !== 'ready'
}

function isObjectOfTable(object: SearchableObject, database: string, table: string): boolean {
  return object.database === database && object.name === table
}

function isSamePill(
  pill: CommandPaletteFilterPillValue,
  candidate: CommandPaletteFilterPillValue
): boolean {
  return pill.kind === candidate.kind && pill.value === candidate.value
}

function hasPill(
  pills: ReadonlyArray<CommandPaletteFilterPillValue>,
  candidate: CommandPaletteFilterPillValue
): boolean {
  return pills.some((pill) => isSamePill(pill, candidate))
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

function clampedSlashIndex(activeIndex: number, optionCount: number): number {
  return optionCount === 0 ? 0 : Math.min(activeIndex, optionCount - 1)
}

function isCaretAtInputStart(input: HTMLInputElement | null): boolean {
  return input?.selectionStart === 0 && input.selectionEnd === 0
}

function tableScopePills(result: PaletteSearchResult): CommandPaletteFilterPillValue[] {
  return [
    {
      kind: 'database',
      value: result.database,
      label: result.database,
    },
    {
      kind: 'table',
      value: `${result.database}.${result.name}`,
      label: result.name,
    },
  ]
}

function parseCommandPaletteValue(
  value: string,
  pills: ReadonlyArray<CommandPaletteFilterPillValue>,
  databases: ReadonlyArray<string>
): ParsedSlashState {
  const nextPills = [...pills]
  let remainder = value.trimStart()

  while (remainder.startsWith('/')) {
    const tokenMatch = /^\/([^\s]+)(?:\s+|$)/.exec(remainder)
    if (!tokenMatch) {
      break
    }

    const token = tokenMatch[1].toLowerCase()
    const nextPill = slashTokenPill(token, databases)
    if (!nextPill) {
      return {
        query: value,
        pills: nextPills,
        isSlashDropdownOpen: true,
        slashQuery: token,
      }
    }

    if (!hasPill(nextPills, nextPill)) {
      nextPills.splice(0, nextPills.length, ...addOrReplacePill(nextPills, nextPill))
    }

    remainder = remainder.slice(tokenMatch[0].length).trimStart()
  }

  const slashMatch = /(?:^|\s)\/([^\s]*)$/.exec(value)

  const hasNoPillTokens = remainder === value.trimStart()
  return {
    query: hasNoPillTokens ? value : remainder,
    pills: nextPills,
    isSlashDropdownOpen: slashMatch != null,
    slashQuery: slashMatch?.[1] ?? '',
  }
}

export function CommandPalette() {
  const isOpen = useCommandPaletteStore((state) => state.isOpen)
  const openInstance = useCommandPaletteStore((state) => state.openInstance)
  const scopeToTable = useCommandPaletteStore((state) => state.scopeToTable)
  const closePalette = useCommandPaletteStore((state) => state.close)
  const activeConnectionId = useConnectionStore((state) => state.activeTabId)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null
  }, [isOpen])

  const restoreFocus = useCallback(() => {
    previouslyFocusedElementRef.current?.focus()
    previouslyFocusedElementRef.current = null
  }, [])

  const handleClose = useCallback(() => {
    closePalette()
    restoreFocus()
  }, [closePalette, restoreFocus])

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={handleClose}
      panelPadding={false}
      panelWidth="min(800px, 80vw)"
      panelClassName={styles.panel}
      backdropClassName={styles.backdrop}
      testId="command-palette"
      ariaLabel="Command palette"
      disableFocusManagement
    >
      <CommandPaletteSession
        key={`${activeConnectionId ?? 'no-connection'}-${openInstance}`}
        activeConnectionId={activeConnectionId}
        scopeToTable={scopeToTable}
        onClose={handleClose}
      />
    </DialogShell>
  )
}

interface CommandPaletteSessionProps {
  activeConnectionId: string | null
  scopeToTable: boolean
  onClose: () => void
}

function CommandPaletteSession({
  activeConnectionId,
  scopeToTable,
  onClose,
}: CommandPaletteSessionProps) {
  const recordSelection = useCommandPaletteRecentsStore((state) => state.recordSelection)
  const getRecents = useCommandPaletteRecentsStore((state) => state.getRecents)
  const activeConnection = useConnectionStore((state) =>
    activeConnectionId ? (state.activeConnections[activeConnectionId] ?? null) : null
  )
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [pills, setPills] = useState<CommandPaletteFilterPillValue[]>(() =>
    scopeToTable ? getInitialPills(activeConnectionId) : []
  )
  const [isSlashDropdownOpen, setIsSlashDropdownOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const readSearchableObjects = () =>
    activeConnectionId ? getSearchableObjects(activeConnectionId) : []
  const readDatabases = () =>
    activeConnectionId
      ? [...getCache(activeConnectionId).databases].sort((left, right) => left.localeCompare(right))
      : []

  // The session is remounted per connection, so the initial read covers the common
  // case. If the schema cache is not ready, await the in-flight load — or start one,
  // since a cache that was wiped or failed (e.g. while offline) is not reloaded by
  // anything else — and refresh once it resolves so we leave the loading state.
  const [searchableObjects, setSearchableObjects] =
    useState<SearchableObject[]>(readSearchableObjects)
  const [databases, setDatabases] = useState<string[]>(readDatabases)
  const [isLoading, setIsLoading] = useState(() => isSchemaCachePending(activeConnectionId))

  useEffect(() => {
    if (!activeConnectionId) {
      return
    }
    const pendingLoad =
      getPendingLoad(activeConnectionId) ??
      getPendingBootstrap(activeConnectionId) ??
      (getCache(activeConnectionId).status === 'ready' ? null : loadCache(activeConnectionId))
    if (!pendingLoad) {
      return
    }
    let cancelled = false
    const refresh = () => {
      if (cancelled) {
        return
      }
      setSearchableObjects(getSearchableObjects(activeConnectionId))
      setDatabases(
        [...getCache(activeConnectionId).databases].sort((left, right) => left.localeCompare(right))
      )
      setIsLoading(false)
    }
    pendingLoad.then(refresh, refresh)
    return () => {
      cancelled = true
    }
  }, [activeConnectionId])
  const searchIndex = useMemo(
    () => buildCommandPaletteSearchIndex(searchableObjects),
    [searchableObjects]
  )
  const databasePill = pills.find((pill) => pill.kind === 'database') ?? null
  const tablePill = pills.find((pill) => pill.kind === 'table') ?? null
  const columnObjects = useMemo<SearchableObject[]>(() => {
    if (!activeConnectionId) return []
    if (!databasePill) return []
    if (!tablePill) return []
    const hasSelectedTable = searchableObjects.some((object) =>
      isObjectOfTable(object, databasePill.value, tablePill.label)
    )
    if (!hasSelectedTable) {
      return []
    }

    return filterColumns(activeConnectionId, databasePill.value, tablePill.label, '').map(
      (column) => ({
        database: databasePill.value,
        table: tablePill.label,
        objectType: 'column',
        name: column.name,
        metaLabel: column.dataType,
      })
    )
  }, [activeConnectionId, databasePill, searchableObjects, tablePill])
  const columnIndex = useMemo(() => buildCommandPaletteSearchIndex(columnObjects), [columnObjects])
  const profileId = activeConnection?.profile.id ?? null
  const recents = useMemo<CommandPaletteRecentEntry[]>(
    () => (profileId ? getRecents(profileId) : []),
    [getRecents, profileId]
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query)
    }, QUERY_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [query])

  useEffect(() => {
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [])

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
      return columnObjects.map((column) => ({
        ...column,
        score: 0,
        matchIndices: [],
        recentRank: null,
      }))
    }

    return getRecentPaletteResults(searchableObjects, {
      filters: getSearchFilters(pills),
      recents: recents,
    })
  }, [columnObjects, pills, recents, searchableObjects, tablePill])

  const slashOptions = useMemo(
    () => buildSlashOptions(slashQuery, databases),
    [databases, slashQuery]
  )
  const visibleResults = debouncedQuery.trim().length > 0 ? results : recentResults
  const searchState = getSearchState({
    connectionId: activeConnectionId,
    query: debouncedQuery,
    results: results,
    recentResults: recentResults,
    objects: searchableObjects,
    isLoading: isLoading,
  })
  const { clampedActiveIndex, activeResult, activeDescendantId } = resolveActiveResultSelection(
    visibleResults,
    activeIndex
  )

  const handleSelect = useCallback(
    async (result: PaletteSearchResult) => {
      const isConnectionMissing = !activeConnectionId || !profileId
      if (isConnectionMissing) {
        onClose()
        return
      }

      if (result.objectType === 'column') {
        if (result.table) {
          activateColumnFromPalette(activeConnectionId, result.database, result.table, result.name)
        }
        onClose()
        return
      }

      recordSelection(profileId, {
        database: result.database,
        objectType: result.objectType,
        name: result.name,
      })
      await activateObjectFromPalette(
        activeConnectionId,
        result.database,
        result.objectType,
        result.name
      )
      onClose()
    },
    [activeConnectionId, onClose, profileId, recordSelection]
  )

  const handleQueryChange = useCallback(
    (value: string) => {
      const parsed = parseCommandPaletteValue(value, pills, databases)
      setQuery(parsed.query)
      setPills(parsed.pills)
      setSlashQuery(parsed.slashQuery)
      setIsSlashDropdownOpen(parsed.isSlashDropdownOpen)
      setActiveIndex(0)
    },
    [databases, pills]
  )

  const handlePillRemove = useCallback((pillToRemove: CommandPaletteFilterPillValue) => {
    setPills((current) =>
      current.filter(
        (pill) => !(pill.kind === pillToRemove.kind && pill.value === pillToRemove.value)
      )
    )
    setActiveIndex(0)
  }, [])

  const handleSlashSelect = useCallback((pill: CommandPaletteFilterPillValue) => {
    setPills((current) => addOrReplacePill(current, pill))
    setQuery('')
    setDebouncedQuery('')
    setSlashQuery('')
    setIsSlashDropdownOpen(false)
    setActiveIndex(0)
    inputRef.current?.focus()
  }, [])

  const closeFromKeyboard = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.preventDefault()
      // DialogShell closes on Escape from a document listener, so stop the event before it.
      event.stopPropagation()
      if (isSlashDropdownOpen) {
        setIsSlashDropdownOpen(false)
        return
      }
      if (pills.length > 0) {
        handlePillRemove(pills[pills.length - 1])
        return
      }
      onClose()
    },
    [handlePillRemove, isSlashDropdownOpen, onClose, pills]
  )

  const moveActiveIndexDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.preventDefault()
      const optionCount = isSlashDropdownOpen ? slashOptions.length : visibleResults.length
      if (optionCount === 0) return
      setActiveIndex((current) => Math.min(current + 1, optionCount - 1))
    },
    [isSlashDropdownOpen, slashOptions.length, visibleResults.length]
  )

  const moveActiveIndexUp = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.preventDefault()
      const canMove = isSlashDropdownOpen || visibleResults.length > 0
      if (!canMove) return
      setActiveIndex((current) => Math.max(current - 1, 0))
    },
    [isSlashDropdownOpen, visibleResults.length]
  )

  const openFromKeyboard = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (isSlashDropdownOpen) {
        event.preventDefault()
        const selectedOption = slashOptions[clampedSlashIndex(activeIndex, slashOptions.length)]
        if (selectedOption) {
          handleSlashSelect(selectedOption.pill)
        }
        return
      }
      if (!activeResult) return
      event.preventDefault()
      void handleSelect(activeResult)
    },
    [activeIndex, activeResult, handleSelect, handleSlashSelect, isSlashDropdownOpen, slashOptions]
  )

  const showColumnsFromKeyboard = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (isSlashDropdownOpen) return
      if (activeResult?.objectType !== 'table') return
      event.preventDefault()
      setPills(tableScopePills(activeResult))
      setQuery('')
      setDebouncedQuery('')
      setActiveIndex(0)
      inputRef.current?.focus()
    },
    [activeResult, isSlashDropdownOpen]
  )

  const removeLastPillFromKeyboard = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const canRemovePill =
        query.length === 0 && isCaretAtInputStart(inputRef.current) && pills.length > 0
      if (!canRemovePill) return
      event.preventDefault()
      handlePillRemove(pills[pills.length - 1])
    },
    [handlePillRemove, pills, query.length]
  )

  const handleQueryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const keyHandlers: Record<string, (keyEvent: KeyboardEvent<HTMLInputElement>) => void> = {
        [PALETTE_KEYS.close.key]: closeFromKeyboard,
        [PALETTE_KEYS.down.key]: moveActiveIndexDown,
        [PALETTE_KEYS.up.key]: moveActiveIndexUp,
        [PALETTE_KEYS.open.key]: openFromKeyboard,
        [PALETTE_KEYS.columns.key]: showColumnsFromKeyboard,
        Backspace: removeLastPillFromKeyboard,
      }
      keyHandlers[event.key]?.(event)
    },
    [
      closeFromKeyboard,
      moveActiveIndexDown,
      moveActiveIndexUp,
      openFromKeyboard,
      removeLastPillFromKeyboard,
      showColumnsFromKeyboard,
    ]
  )

  return (
    <div className={styles.surface}>
      <div className={styles.inputSection}>
        <CommandPaletteInput
          query={query}
          pills={pills}
          isSlashDropdownOpen={isSlashDropdownOpen}
          onQueryChange={handleQueryChange}
          onQueryKeyDown={handleQueryKeyDown}
          onPillRemove={handlePillRemove}
          inputRef={inputRef}
          activeDescendantId={activeDescendantId}
        />
      </div>
      <div className={styles.resultsSection}>
        {isSlashDropdownOpen ? (
          <SlashCommandDropdown
            slashQuery={slashQuery}
            databases={databases}
            activeIndex={clampedSlashIndex(activeIndex, slashOptions.length)}
            onSelect={handleSlashSelect}
          />
        ) : (
          <CommandPaletteResults
            results={visibleResults}
            activeIndex={clampedActiveIndex}
            state={searchState}
            isColumnScope={tablePill != null}
            onSelect={(result) => {
              void handleSelect(result)
            }}
          />
        )}
      </div>
      <CommandPaletteFooter showColumnsHint={tablePill == null} />
    </div>
  )
}
