import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaletteSearchResult } from '../../lib/command-palette-search'
import {
  addOrReplacePill,
  getInitialPills,
  isSamePill,
  parseCommandPaletteValue,
  tableScopePills,
} from './palette-pills'
import type { CommandPaletteFilterPillValue } from './palette-types'

const QUERY_DEBOUNCE_MS = 80

function useDebouncedQuery(query: string) {
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query)
    }, QUERY_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [query])

  return { debouncedQuery, setDebouncedQuery }
}

function useInitiallyFocusedInput() {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [])

  return inputRef
}

export interface PaletteInputOptions {
  activeConnectionId: string | null
  scopeToTable: boolean
  databases: ReadonlyArray<string>
}

function usePaletteInputState({ activeConnectionId, scopeToTable }: PaletteInputOptions) {
  const [query, setQuery] = useState('')
  const { debouncedQuery, setDebouncedQuery } = useDebouncedQuery(query)
  const [pills, setPills] = useState<CommandPaletteFilterPillValue[]>(() =>
    scopeToTable ? getInitialPills(activeConnectionId) : []
  )
  const [isSlashDropdownOpen, setIsSlashDropdownOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useInitiallyFocusedInput()
  return {
    values: {
      query,
      debouncedQuery,
      pills,
      isSlashDropdownOpen,
      slashQuery,
      activeIndex,
      inputRef,
    },
    setters: {
      setQuery,
      setDebouncedQuery,
      setPills,
      setIsSlashDropdownOpen,
      setSlashQuery,
      setActiveIndex,
    },
  }
}

export function usePaletteInput(options: PaletteInputOptions) {
  const { databases } = options
  const { values, setters } = usePaletteInputState(options)
  const { pills, inputRef } = values
  const { setQuery, setDebouncedQuery, setPills } = setters
  const { setIsSlashDropdownOpen, setSlashQuery, setActiveIndex } = setters

  const handleQueryChange = useCallback(
    (value: string) => {
      const parsed = parseCommandPaletteValue(value, pills, databases)
      setQuery(parsed.query)
      setPills(parsed.pills)
      setSlashQuery(parsed.slashQuery)
      setIsSlashDropdownOpen(parsed.isSlashDropdownOpen)
      setActiveIndex(0)
    },
    [databases, pills, setQuery, setPills, setSlashQuery, setIsSlashDropdownOpen, setActiveIndex]
  )

  const handlePillRemove = useCallback(
    (pillToRemove: CommandPaletteFilterPillValue) => {
      setPills((current) => current.filter((pill) => !isSamePill(pill, pillToRemove)))
      setActiveIndex(0)
    },
    [setPills, setActiveIndex]
  )

  const startFreshSearch = useCallback(
    (nextPills: (current: CommandPaletteFilterPillValue[]) => CommandPaletteFilterPillValue[]) => {
      setPills(nextPills)
      setQuery('')
      setDebouncedQuery('')
      setActiveIndex(0)
      inputRef.current?.focus()
    },
    [inputRef, setDebouncedQuery, setPills, setQuery, setActiveIndex]
  )

  const handleSlashSelect = useCallback(
    (pill: CommandPaletteFilterPillValue) => {
      setSlashQuery('')
      setIsSlashDropdownOpen(false)
      startFreshSearch((current) => addOrReplacePill(current, pill))
    },
    [startFreshSearch, setSlashQuery, setIsSlashDropdownOpen]
  )

  const scopeToTableColumns = useCallback(
    (tableResult: PaletteSearchResult) => startFreshSearch(() => tableScopePills(tableResult)),
    [startFreshSearch]
  )

  return {
    ...values,
    setActiveIndex,
    setIsSlashDropdownOpen,
    handleQueryChange,
    handlePillRemove,
    handleSlashSelect,
    scopeToTableColumns,
  }
}

export type PaletteInput = ReturnType<typeof usePaletteInput>
