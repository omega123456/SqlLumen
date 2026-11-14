import { useState, useEffect, useCallback } from 'react'
import { listCharsets, listCollations } from '../lib/schema-commands'
import type { CharsetInfo, CollationInfo } from '../types/schema'
import { toErrorMessage } from '../lib/error-message'

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

export interface DatabaseEncodingOptions {
  connectionId: string
  isOpen: boolean
  initialCharset?: string
  initialCollation?: string
}

interface EncodingCatalog {
  charsets: CharsetInfo[]
  collations: CollationInfo[]
  isLoading: boolean
  error: string | null
}

function useEncodingCatalog(connectionId: string, isOpen: boolean): EncodingCatalog {
  const [charsets, setCharsets] = useState<CharsetInfo[]>([])
  const [collations, setCollations] = useState<CollationInfo[]>([])
  const [isLoading, setIsLoading] = useState(() => isOpen)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const [loadedCharsets, loadedCollations] = await Promise.all([
          listCharsets(connectionId),
          listCollations(connectionId),
        ])
        if (cancelled) return
        setCharsets(loadedCharsets)
        setCollations(loadedCollations)
      } catch (error) {
        if (!cancelled) setError(toErrorMessage(error))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isOpen, connectionId])

  return { charsets, collations, isLoading, error }
}

interface EncodingSelection {
  charset: string
  collation: string
  setCharsetState: (charset: string) => void
  setCollation: (collation: string) => void
}

interface AppliedInitialEncoding {
  charset: string | undefined
  collation: string | undefined
}

type EncodingSelectionOptions = Omit<DatabaseEncodingOptions, 'connectionId'>

function isSameAppliedEncoding(
  applied: AppliedInitialEncoding,
  { initialCharset, initialCollation }: EncodingSelectionOptions
): boolean {
  return applied.charset === initialCharset && applied.collation === initialCollation
}

function isOpeningWithoutInitials(options: EncodingSelectionOptions, wasOpen: boolean): boolean {
  const hasNoInitials =
    options.initialCharset === undefined && options.initialCollation === undefined
  return options.isOpen && !wasOpen && hasNoInitials
}

function newInitialValue(
  isOpen: boolean,
  initialValue: string | undefined,
  appliedValue: string | undefined
): string | null {
  const isNewValue = isOpen && initialValue !== undefined && initialValue !== appliedValue
  return isNewValue ? initialValue : null
}

function useEncodingSelection(options: EncodingSelectionOptions): EncodingSelection {
  const { isOpen, initialCharset, initialCollation } = options
  const [charset, setCharsetState] = useState(initialCharset ?? '')
  const [collation, setCollation] = useState(initialCollation ?? '')
  const [wasOpen, setWasOpen] = useState(isOpen)
  const [applied, setApplied] = useState<AppliedInitialEncoding>({
    charset: initialCharset,
    collation: initialCollation,
  })

  const isClosedWithStaleInitials = !isOpen && !isSameAppliedEncoding(applied, options)
  if (isClosedWithStaleInitials) {
    setApplied({ charset: initialCharset, collation: initialCollation })
  }

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
  }

  if (isOpeningWithoutInitials(options, wasOpen)) {
    setApplied({ charset: undefined, collation: undefined })
    setCharsetState('')
    setCollation('')
  }

  const newCharset = newInitialValue(isOpen, initialCharset, applied.charset)
  if (newCharset !== null) {
    setApplied((current) => ({ ...current, charset: newCharset }))
    setCharsetState(newCharset)
  }

  const newCollation = newInitialValue(isOpen, initialCollation, applied.collation)
  if (newCollation !== null) {
    setApplied((current) => ({ ...current, collation: newCollation }))
    setCollation(newCollation)
  }

  return { charset, collation, setCharsetState, setCollation }
}

export function useDatabaseEncoding({
  connectionId,
  isOpen,
  initialCharset,
  initialCollation,
}: DatabaseEncodingOptions): UseDatabaseEncodingReturn {
  const { charsets, collations, isLoading, error } = useEncodingCatalog(connectionId, isOpen)
  const { charset, collation, setCharsetState, setCollation } = useEncodingSelection({
    isOpen,
    initialCharset,
    initialCollation,
  })

  const filteredCollations = charset
    ? collations.filter((candidate) => candidate.charset === charset)
    : collations

  const setCharset = useCallback(
    (newCharset: string) => {
      setCharsetState(newCharset)
      if (!newCharset) {
        setCollation('')
        return
      }
      const charsetInfo = charsets.find((candidate) => candidate.charset === newCharset)
      setCollation(charsetInfo?.defaultCollation ?? '')
    },
    [charsets, setCharsetState, setCollation]
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
