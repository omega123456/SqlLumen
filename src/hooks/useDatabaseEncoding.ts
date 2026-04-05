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

    setCharsetState('')
    setCollation('')
  }, [initialCharset, initialCollation, isOpen])

  useEffect(() => {
    if (isOpen && initialCharset !== undefined) {
      setCharsetState(initialCharset)
    }
  }, [initialCharset, isOpen])

  useEffect(() => {
    if (isOpen && initialCollation !== undefined) {
      setCollation(initialCollation)
    }
  }, [initialCollation, isOpen])

  // Filter collations by selected charset
  const filteredCollations = charset ? collations.filter((c) => c.charset === charset) : collations

  // When charset changes (user action), reset collation to charset's default
  const setCharset = useCallback(
    (newCharset: string) => {
      setCharsetState(newCharset)
      if (!newCharset) {
        setCollation('')
        return
      }
      const defaultCollation = collations.find((c) => c.charset === newCharset && c.isDefault)
      setCollation(defaultCollation?.name ?? '')
    },
    [collations]
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
