import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { DialogShell } from '../dialogs/DialogShell'
import {
  getCache,
  getPendingLoad,
  getSearchableObjects,
} from '../query-editor/schema-metadata-cache'
import { activateObjectFromPalette } from '../../lib/object-activation'
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
import type { PaletteTypeFilter, SearchableObject } from '../../types/schema'
import { CommandPaletteInput } from './CommandPaletteInput'
import { CommandPaletteResults } from './CommandPaletteResults'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import { buildSlashOptions, TYPE_ALIASES } from './slash-options'
import styles from './CommandPalette.module.css'

export interface CommandPaletteFilterPillValue {
  kind: 'database' | 'object-type'
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
  onSelect: (result: PaletteSearchResult) => void
}

function getSearchState(args: {
  connectionId: string | null
  query: string
  results: ReadonlyArray<PaletteSearchResult>
  recentResults: ReadonlyArray<PaletteSearchResult>
  objects: ReadonlyArray<SearchableObject>
}): CommandPaletteResultsProps['state'] {
  if (!args.connectionId) {
    return 'no-connection'
  }

  if (args.objects.length === 0 && getPendingLoad(args.connectionId)) {
    return 'loading'
  }

  if (args.query.trim().length === 0) {
    return args.recentResults.length > 0 ? 'recents' : 'empty'
  }

  return args.results.length > 0 ? 'results' : 'no-results'
}

const MAX_VISIBLE_RESULTS = 50

function addOrReplacePill(
  pills: ReadonlyArray<CommandPaletteFilterPillValue>,
  nextPill: CommandPaletteFilterPillValue
): CommandPaletteFilterPillValue[] {
  const withoutSameKind = pills.filter((pill) => pill.kind !== nextPill.kind)
  const withNewPill = [...withoutSameKind, nextPill]
  return withNewPill.slice(-2)
}

function getSearchFilters(pills: ReadonlyArray<CommandPaletteFilterPillValue>) {
  return {
    database: pills.find((pill) => pill.kind === 'database')?.value ?? null,
    objectType:
      (pills.find((pill) => pill.kind === 'object-type')?.value as PaletteTypeFilter | undefined) ??
      null,
  }
}

interface ParsedSlashState {
  query: string
  pills: CommandPaletteFilterPillValue[]
  isSlashDropdownOpen: boolean
  slashQuery: string
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
    const databaseMatch = databases.find((database) => database.toLowerCase() === token) ?? null
    const typeMatch = TYPE_ALIASES.get(token) ?? null

    if (!databaseMatch && !typeMatch) {
      return {
        query: value,
        pills: nextPills,
        isSlashDropdownOpen: true,
        slashQuery: token,
      }
    }

    const nextPill =
      typeMatch ??
      ({
        kind: 'database',
        value: databaseMatch ?? '',
        label: databaseMatch ?? '',
      } satisfies CommandPaletteFilterPillValue)

    if (!nextPills.some((pill) => pill.kind === nextPill.kind && pill.value === nextPill.value)) {
      nextPills.splice(0, nextPills.length, ...addOrReplacePill(nextPills, nextPill))
    }

    remainder = remainder.slice(tokenMatch[0].length).trimStart()
  }

  const slashMatch = /(?:^|\s)\/([^\s]*)$/.exec(value)

  return {
    query: remainder === value.trimStart() ? value : remainder,
    pills: nextPills,
    isSlashDropdownOpen: slashMatch != null,
    slashQuery: slashMatch?.[1] ?? '',
  }
}

export function CommandPalette() {
  const isOpen = useCommandPaletteStore((state) => state.isOpen)
  const openInstance = useCommandPaletteStore((state) => state.openInstance)
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
      testId="command-palette"
      ariaLabel="Command palette"
      disableFocusManagement
    >
      <CommandPaletteSession
        key={`${activeConnectionId ?? 'no-connection'}-${openInstance}`}
        activeConnectionId={activeConnectionId}
        onClose={handleClose}
      />
    </DialogShell>
  )
}

interface CommandPaletteSessionProps {
  activeConnectionId: string | null
  onClose: () => void
}

function CommandPaletteSession({ activeConnectionId, onClose }: CommandPaletteSessionProps) {
  const recordSelection = useCommandPaletteRecentsStore((state) => state.recordSelection)
  const getRecents = useCommandPaletteRecentsStore((state) => state.getRecents)
  const activeConnection = useConnectionStore((state) =>
    activeConnectionId ? (state.activeConnections[activeConnectionId] ?? null) : null
  )
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [pills, setPills] = useState<CommandPaletteFilterPillValue[]>([])
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
  // case. If the palette opens while the schema cache is still loading, refresh once
  // the in-flight load resolves so we leave the loading state.
  const [searchableObjects, setSearchableObjects] =
    useState<SearchableObject[]>(readSearchableObjects)
  const [databases, setDatabases] = useState<string[]>(readDatabases)

  useEffect(() => {
    if (!activeConnectionId) {
      return
    }
    const pendingLoad = getPendingLoad(activeConnectionId)
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
  const profileId = activeConnection?.profile.id ?? null
  const recents = useMemo<CommandPaletteRecentEntry[]>(
    () => (profileId ? getRecents(profileId) : []),
    [getRecents, profileId]
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query)
    }, 80)

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
      searchPaletteObjects(searchIndex, {
        query: debouncedQuery,
        filters: getSearchFilters(pills),
        recents,
        limit: MAX_VISIBLE_RESULTS,
      }),
    [debouncedQuery, pills, recents, searchIndex]
  )

  const recentResults = useMemo(
    () =>
      getRecentPaletteResults(searchableObjects, {
        filters: getSearchFilters(pills),
        recents,
      }),
    [pills, recents, searchableObjects]
  )

  const slashOptions = useMemo(
    () => buildSlashOptions(slashQuery, databases),
    [databases, slashQuery]
  )
  const visibleResults = debouncedQuery.trim().length > 0 ? results : recentResults
  const clampedActiveIndex =
    visibleResults.length === 0 ? 0 : Math.min(activeIndex, visibleResults.length - 1)
  const searchState = getSearchState({
    connectionId: activeConnectionId,
    query: debouncedQuery,
    results,
    recentResults,
    objects: searchableObjects,
  })
  const activeResult = visibleResults.length === 0 ? null : visibleResults[clampedActiveIndex]
  const activeDescendantId =
    activeResult == null ? undefined : `command-palette-result-${clampedActiveIndex}`

  const handleSelect = useCallback(
    async (result: PaletteSearchResult) => {
      if (!activeConnectionId || !profileId) {
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

  const handleQueryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        if (isSlashDropdownOpen) {
          setIsSlashDropdownOpen(false)
          return
        }

        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (isSlashDropdownOpen) {
          if (slashOptions.length > 0) {
            setActiveIndex((current) => Math.min(current + 1, slashOptions.length - 1))
          }
          return
        }

        if (visibleResults.length > 0) {
          setActiveIndex((current) => Math.min(current + 1, visibleResults.length - 1))
        }
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (isSlashDropdownOpen) {
          setActiveIndex((current) => Math.max(current - 1, 0))
          return
        }

        if (visibleResults.length > 0) {
          setActiveIndex((current) => Math.max(current - 1, 0))
        }
        return
      }

      if (event.key === 'Enter' && isSlashDropdownOpen) {
        event.preventDefault()
        if (slashOptions.length === 0) {
          return
        }
        const slashIndex = Math.min(activeIndex, slashOptions.length - 1)
        const selectedOption = slashOptions[slashIndex]
        if (selectedOption) {
          handleSlashSelect(selectedOption.pill)
        }
        return
      }

      if (event.key === 'Enter' && activeResult) {
        event.preventDefault()
        void handleSelect(activeResult)
        return
      }

      if (
        event.key === 'Backspace' &&
        query.length === 0 &&
        inputRef.current?.selectionStart === 0 &&
        inputRef.current?.selectionEnd === 0 &&
        pills.length > 0
      ) {
        event.preventDefault()
        handlePillRemove(pills[pills.length - 1])
      }
    },
    [
      activeIndex,
      activeResult,
      handlePillRemove,
      handleSelect,
      handleSlashSelect,
      isSlashDropdownOpen,
      onClose,
      pills,
      query.length,
      slashOptions,
      visibleResults.length,
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
            activeIndex={
              slashOptions.length === 0 ? 0 : Math.min(activeIndex, slashOptions.length - 1)
            }
            onSelect={handleSlashSelect}
          />
        ) : (
          <CommandPaletteResults
            results={visibleResults}
            activeIndex={clampedActiveIndex}
            state={searchState}
            onSelect={(result) => {
              void handleSelect(result)
            }}
          />
        )}
      </div>
    </div>
  )
}
