import { useEffect, useMemo, useState } from 'react'
import { logFrontendError } from '../../../lib/app-log-commands'
import { listCharsets, listCollations } from '../../../lib/schema-commands'
import type { CharsetInfo, CollationInfo } from '../../../types/schema'
import type { TableDesignerStore } from '../../../stores/table-designer-store'
import {
  charsetDropdownOptions,
  collationDropdownOptions,
  collationToSelect,
} from './table-properties-model'

interface CollationOptionsInput {
  tabId: string
  connectionId: string
  selectedCharset: string
  currentCollation: string
  updateProperties: TableDesignerStore['updateProperties']
}

export function useCharsetOptions(connectionId: string, selectedCharset: string) {
  const [charsets, setCharsets] = useState<CharsetInfo[]>([])
  const [isCharsetsLoading, setIsCharsetsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setIsCharsetsLoading(true)
    })
    void listCharsets(connectionId)
      .then((loadedCharsets) => {
        if (!cancelled) setCharsets(loadedCharsets)
      })
      .catch((error) => {
        logFrontendError('[table-properties-editor] Failed to load charsets', error)
        if (!cancelled) setCharsets([])
      })
      .finally(() => {
        if (!cancelled) setIsCharsetsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connectionId])

  const options = useMemo(() => {
    const charsetOptions = charsets.map((charset) => ({
      value: charset.charset,
      label: charset.charset,
    }))
    return charsetDropdownOptions({
      options: charsetOptions,
      loadedCount: charsets.length,
      isLoading: isCharsetsLoading,
      selectedCharset: selectedCharset,
    })
  }, [charsets, isCharsetsLoading, selectedCharset])

  return { options: options, isLoading: isCharsetsLoading }
}

function charsetCollations(collations: CollationInfo[], charset: string): CollationInfo[] {
  return collations.filter((collation) => collation.charset === charset)
}

function runUnlessCancelledLater(isCancelled: () => boolean, clear: () => void): void {
  queueMicrotask(() => {
    if (!isCancelled()) clear()
  })
}

export function useCollationOptions(input: CollationOptionsInput) {
  const { tabId, connectionId, selectedCharset, currentCollation, updateProperties } = input
  const [collations, setCollations] = useState<CollationInfo[]>([])
  const [isCollationsLoading, setIsCollationsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    if (!selectedCharset) {
      runUnlessCancelledLater(isCancelled, () => {
        setCollations([])
        setIsCollationsLoading(false)
      })
      return () => {
        cancelled = true
      }
    }
    runUnlessCancelledLater(isCancelled, () => setIsCollationsLoading(true))
    void listCollations(connectionId)
      .then((loadedCollations) => {
        if (cancelled) return
        const filteredCollations = charsetCollations(loadedCollations, selectedCharset)
        setCollations(filteredCollations)
        const nextCollation = collationToSelect(
          filteredCollations,
          selectedCharset,
          currentCollation
        )
        if (nextCollation) updateProperties(tabId, 'collation', nextCollation)
      })
      .catch((error) => {
        logFrontendError('[table-properties-editor] Failed to load collations', error)
        if (!cancelled) setCollations([])
      })
      .finally(() => {
        if (!cancelled) setIsCollationsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connectionId, currentCollation, selectedCharset, tabId, updateProperties])

  const options = useMemo(
    () =>
      collationDropdownOptions({
        options: collations.map((collation) => ({ value: collation.name, label: collation.name })),
        isLoading: isCollationsLoading,
        currentCollation: currentCollation,
      }),
    [collations, isCollationsLoading, currentCollation]
  )

  return { options: options, isLoading: isCollationsLoading }
}
