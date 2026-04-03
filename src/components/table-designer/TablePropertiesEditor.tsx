import { SpinnerGap } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { listCharsets, listCollations } from '../../lib/schema-commands'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import type { CharsetInfo, CollationInfo, TableDesignerProperties } from '../../types/schema'
import styles from './TablePropertiesEditor.module.css'

interface TablePropertiesEditorProps {
  tabId: string
  connectionId: string
  databaseName: string
}

const ENGINE_OPTIONS = ['InnoDB', 'MyISAM', 'MEMORY', 'ARCHIVE', 'CSV', 'BLACKHOLE'] as const
const ROW_FORMAT_OPTIONS = ['DEFAULT', 'DYNAMIC', 'COMPACT', 'REDUNDANT', 'COMPRESSED'] as const

function deriveCharsetFromCollation(collation: string | null | undefined): string {
  if (!collation) {
    return ''
  }

  const separatorIndex = collation.indexOf('_')
  if (separatorIndex <= 0) {
    return collation
  }

  return collation.slice(0, separatorIndex)
}

function getDefaultCollationForCharset(charset: string, collations: CollationInfo[]): string {
  const defaultCollation = collations.find((collation) => collation.isDefault)?.name
  if (defaultCollation) {
    return defaultCollation
  }

  return collations.find((collation) => collation.charset === charset)?.name ?? ''
}

function parseAutoIncrement(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return null
  }

  return parsed
}

export function TablePropertiesEditor({ tabId, connectionId }: TablePropertiesEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const updateProperties = useTableDesignerStore((state) => state.updateProperties)

  const [charsets, setCharsets] = useState<CharsetInfo[]>([])
  const [collations, setCollations] = useState<CollationInfo[]>([])
  const [isCharsetsLoading, setIsCharsetsLoading] = useState(false)
  const [isCollationsLoading, setIsCollationsLoading] = useState(false)

  const properties = tabState?.currentSchema.properties
  const currentCollation = properties?.collation ?? ''

  const selectedCharset =
    properties?.charset || deriveCharsetFromCollation(properties?.collation ?? undefined)

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        setIsCharsetsLoading(true)
      }
    })

    void listCharsets(connectionId)
      .then((loadedCharsets) => {
        if (!cancelled) {
          setCharsets(loadedCharsets)
        }
      })
      .catch((error) => {
        console.error('[table-properties-editor] Failed to load charsets', error)
        if (!cancelled) {
          setCharsets([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCharsetsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionId])

  useEffect(() => {
    let cancelled = false

    if (!selectedCharset) {
      queueMicrotask(() => {
        if (!cancelled) {
          setCollations([])
          setIsCollationsLoading(false)
        }
      })
      return () => {
        cancelled = true
      }
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setIsCollationsLoading(true)
      }
    })

    void listCollations(connectionId)
      .then((loadedCollations) => {
        if (cancelled) {
          return
        }

        const filteredCollations = loadedCollations.filter(
          (collation) => collation.charset === selectedCharset
        )
        setCollations(filteredCollations)

        const hasSelectedCollation = filteredCollations.some(
          (collation) => collation.name === currentCollation
        )

        if (!hasSelectedCollation) {
          const defaultCollation = getDefaultCollationForCharset(
            selectedCharset,
            filteredCollations
          )

          if (defaultCollation && defaultCollation !== currentCollation) {
            updateProperties(tabId, 'collation', defaultCollation)
          }
        }
      })
      .catch((error) => {
        console.error('[table-properties-editor] Failed to load collations', error)
        if (!cancelled) {
          setCollations([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCollationsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, currentCollation, selectedCharset, tabId, updateProperties])

  const charsetOptions = useMemo(
    () => charsets.map((charset) => ({ value: charset.charset, label: charset.charset })),
    [charsets]
  )

  const collationOptions = useMemo(
    () => collations.map((collation) => ({ value: collation.name, label: collation.name })),
    [collations]
  )

  if (!properties) {
    return null
  }

  const handlePropertyChange = <TField extends keyof TableDesignerProperties>(
    field: TField,
    value: TableDesignerProperties[TField]
  ) => {
    updateProperties(tabId, field, value)
  }

  return (
    <div className={styles.container} data-testid="table-properties-editor">
      <div className={styles.grid}>
        <div className={styles.column}>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`table-properties-engine-${tabId}`}>
              Engine
            </label>
            <select
              id={`table-properties-engine-${tabId}`}
              className={styles.control}
              value={properties.engine}
              data-testid="table-properties-engine"
              onChange={(event) => handlePropertyChange('engine', event.target.value)}
            >
              {ENGINE_OPTIONS.map((engine) => (
                <option key={engine} value={engine}>
                  {engine}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`table-properties-charset-${tabId}`}>
              <span>Character Set</span>
              {isCharsetsLoading && <SpinnerGap size={12} className={styles.spinner} aria-hidden />}
            </label>
            <select
              id={`table-properties-charset-${tabId}`}
              className={styles.control}
              value={selectedCharset}
              disabled={isCharsetsLoading}
              aria-busy={isCharsetsLoading}
              data-testid="table-properties-charset"
              onChange={(event) => handlePropertyChange('charset', event.target.value)}
            >
              {isCharsetsLoading ? (
                <option value="">Loading charsets...</option>
              ) : charsetOptions.length > 0 ? (
                charsetOptions.map((charset) => (
                  <option key={charset.value} value={charset.value}>
                    {charset.label}
                  </option>
                ))
              ) : (
                <option value="">No charsets available</option>
              )}
            </select>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`table-properties-collation-${tabId}`}>
              <span>Collation</span>
              {isCollationsLoading && (
                <SpinnerGap size={12} className={styles.spinner} aria-hidden />
              )}
            </label>
            <select
              id={`table-properties-collation-${tabId}`}
              className={styles.control}
              value={properties.collation}
              disabled={isCollationsLoading || !selectedCharset}
              aria-busy={isCollationsLoading}
              data-testid="table-properties-collation"
              onChange={(event) => handlePropertyChange('collation', event.target.value)}
            >
              {isCollationsLoading ? (
                <option value="">Loading collations...</option>
              ) : collationOptions.length > 0 ? (
                collationOptions.map((collation) => (
                  <option key={collation.value} value={collation.value}>
                    {collation.label}
                  </option>
                ))
              ) : (
                <option value="">No collations available</option>
              )}
            </select>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`table-properties-auto-increment-${tabId}`}>
              Auto Increment
            </label>
            <input
              id={`table-properties-auto-increment-${tabId}`}
              type="number"
              min="1"
              className={styles.control}
              value={String(properties.autoIncrement ?? 1)}
              data-testid="table-properties-auto-increment"
              onChange={(event) =>
                handlePropertyChange('autoIncrement', parseAutoIncrement(event.target.value))
              }
            />
          </div>
        </div>

        <div className={styles.column}>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`table-properties-row-format-${tabId}`}>
              Row Format
            </label>
            <select
              id={`table-properties-row-format-${tabId}`}
              className={styles.control}
              value={properties.rowFormat}
              data-testid="table-properties-row-format"
              onChange={(event) => handlePropertyChange('rowFormat', event.target.value)}
            >
              {ROW_FORMAT_OPTIONS.map((rowFormat) => (
                <option key={rowFormat} value={rowFormat}>
                  {rowFormat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={`${styles.fieldGroup} ${styles.fullWidth}`}>
          <label className={styles.label} htmlFor={`table-properties-comment-${tabId}`}>
            Comment
          </label>
          <textarea
            id={`table-properties-comment-${tabId}`}
            className={`${styles.control} ${styles.textarea}`}
            value={properties.comment}
            data-testid="table-properties-comment"
            onChange={(event) => handlePropertyChange('comment', event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
