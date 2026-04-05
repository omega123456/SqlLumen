import { useState, useEffect, useCallback, useRef } from 'react'
import { listCharsets, listCollations } from '../lib/schema-commands'
import type { CharsetInfo, CollationInfo } from '../types/schema'

export interface UseDatabaseEncodingReturn {
  charsets: CharsetInfo[]
  collations: CollationInfo[]
  filteredCollations: CollationInfo[]
  charset: string
  collation: string
  setCharset: (charset: string) => void
  setCollation: (collation: string) => void
  isLoading: boolean
  error: string | null
}

/**
 * Shared hook for charset/collation selection used by CreateDatabaseDialog and AlterDatabaseDialog.
 *
 * Fetches charsets and collations when `isOpen` becomes true.
 * When charset changes: resets collation to the new charset's default.
 * Exports filtered collations (only those matching selected charset).
 */
export function useDatabaseEncoding(
  connectionId: string,
  isOpen: boolean,
  initialCharset?: string,
  initialCollation?: string
): UseDatabaseEncodingReturn {
  const [charsets, setCharsets] = useState<CharsetInfo[]>([])
  const [collations, setCollations] = useState<CollationInfo[]>([])
  const [charset, setCharsetState] = useState(initialCharset ?? '')
  const [collation, setCollation] = useState(initialCollation ?? '')
  const [isLoading, setIsLoading] = useState(() => isOpen)
  const [error, setError] = useState<string | null>(null)
  const wasOpenRef = useRef(isOpen)
  // Track the last initialCharset/initialCollation values that were applied so
  // we can synchronously apply updates within the same render cycle.
  const prevInitialCharsetRef = useRef(initialCharset)
  const prevInitialCollationRef = useRef(initialCollation)

  // Synchronously apply initialCharset/initialCollation changes during render.
  // Using refs + mid-render state updates (React-recommended getDerivedStateFromProps
  // equivalent) ensures the new value is visible in the same render that delivers
  // the updated prop, avoiding the one-render lag that useEffect-based syncing
  // causes (which made `waitForAlterDatabaseDialogIdle` resolve before the charset
  // state was updated on reopen).
  if (isOpen && initialCharset !== undefined && initialCharset !== prevInitialCharsetRef.current) {
    prevInitialCharsetRef.current = initialCharset
    // Calling setState during render is the React-approved pattern for
    // getDerivedStateFromProps; React will immediately re-render with the new value.
    setCharsetState(initialCharset)
  }

  if (
    isOpen &&
    initialCollation !== undefined &&
    initialCollation !== prevInitialCollationRef.current
  ) {
    prevInitialCollationRef.current = initialCollation
    setCollation(initialCollation)
  }

  // Fetch charsets and collations when dialog opens
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const [cs, cols] = await Promise.all([
          listCharsets(connectionId),
          listCollations(connectionId),
        ])
        if (!cancelled) {
          setCharsets(cs)
          setCollations(cols)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isOpen, connectionId])

  // For create flows (no initial values), reopen should reset to empty defaults.
  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = isOpen

    if (!isOpen || wasOpen || initialCharset !== undefined || initialCollation !== undefined) {
      return
    }

    prevInitialCharsetRef.current = undefined
    prevInitialCollationRef.current = undefined
    setCharsetState('')
    setCollation('')
  }, [initialCharset, initialCollation, isOpen])

  // Keep prev refs in sync when dialog closes so the next open cycle correctly
  // detects a change if initialCharset/initialCollation are set again.
  useEffect(() => {
    if (!isOpen) {
      prevInitialCharsetRef.current = initialCharset
      prevInitialCollationRef.current = initialCollation
    }
  }, [isOpen, initialCharset, initialCollation])

  // Filter collations by selected charset
  const filteredCollations = charset ? collations.filter((c) => c.charset === charset) : collations

  // When charset changes (user action), reset collation to the charset's default.
  // Uses CharsetInfo.defaultCollation directly (already provided by the backend)
  // rather than scanning the full collations list for the isDefault entry.
  const setCharset = useCallback(
    (newCharset: string) => {
      setCharsetState(newCharset)
      if (!newCharset) {
        setCollation('')
        return
      }
      const charsetInfo = charsets.find((cs) => cs.charset === newCharset)
      setCollation(charsetInfo?.defaultCollation ?? '')
    },
    [charsets]
  )

  return {
    charsets,
    collations,
    filteredCollations,
    charset,
    collation,
    setCharset,
    setCollation,
    isLoading,
    error,
  }
}
