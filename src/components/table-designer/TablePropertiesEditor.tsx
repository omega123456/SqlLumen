import { SpinnerGap } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { listCharsets, listCollations } from '../../lib/schema-commands'
import { TextInput } from '../common/TextInput'
import { Textarea } from '../common/Textarea'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import type { CharsetInfo, CollationInfo, TableDesignerProperties } from '../../types/schema'
import styles from './TablePropertiesEditor.module.css'

import { logFrontendError } from '../../lib/app-log-commands'
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

const DEFAULT_AUTO_INCREMENT = 1

function collationOf(properties: TableDesignerProperties | undefined): string {
  return properties?.collation ?? ''
}

function resolveSelectedCharset(properties: TableDesignerProperties | undefined): string {
  if (!properties) return ''
  return properties.charset || deriveCharsetFromCollation(properties.collation)
}

function autoIncrementInputValue(properties: TableDesignerProperties): string {
  return String(properties.autoIncrement ?? DEFAULT_AUTO_INCREMENT)
}

function LabelSpinner({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) return null
  return <SpinnerGap size={12} className={styles.spinner} aria-hidden />
}

export function TablePropertiesEditor({ tabId, connectionId }: TablePropertiesEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const updateProperties = useTableDesignerStore((state) => state.updateProperties)

  const [charsets, setCharsets] = useState<CharsetInfo[]>([])
  const [collations, setCollations] = useState<CollationInfo[]>([])
  const [isCharsetsLoading, setIsCharsetsLoading] = useState(false)
  const [isCollationsLoading, setIsCollationsLoading] = useState(false)

  const properties = tabState?.currentSchema.properties
  const currentCollation = collationOf(properties)
  const selectedCharset = resolveSelectedCharset(properties)

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
        logFrontendError('[table-properties-editor] Failed to load charsets', error)
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
        logFrontendError('[table-properties-editor] Failed to load collations', error)
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

  const engineDropdownOptions: DropdownOption[] = useMemo(
    () => ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine })),
    []
  )

  const rowFormatDropdownOptions: DropdownOption[] = useMemo(
    () => ROW_FORMAT_OPTIONS.map((rowFormat) => ({ value: rowFormat, label: rowFormat })),
    []
  )

  const charsetDropdownOptions: DropdownOption[] = useMemo(() => {
    if (isCharsetsLoading && charsets.length === 0) {
      return [
        {
          value: selectedCharset || '',
          label: 'Loading charsets...',
          disabled: true,
        },
      ]
    }
    if (!isCharsetsLoading && charsetOptions.length === 0) {
      return [{ value: '', label: 'No charsets available', disabled: true }]
    }
    return charsetOptions
  }, [charsetOptions, charsets.length, isCharsetsLoading, selectedCharset])

  const collationDropdownOptions: DropdownOption[] = useMemo(() => {
    if (isCollationsLoading) {
      return [
        {
          value: currentCollation,
          label: 'Loading collations...',
          disabled: true,
        },
      ]
    }
    if (collationOptions.length === 0) {
      return [{ value: '', label: 'No collations available', disabled: true }]
    }
    return collationOptions
  }, [collationOptions, isCollationsLoading, currentCollation])

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
            <label className={styles.label} id={`table-properties-engine-label-${tabId}`}>
              Engine
            </label>
            <Dropdown
              id={`table-properties-engine-${tabId}`}
              labelledBy={`table-properties-engine-label-${tabId}`}
              options={engineDropdownOptions}
              value={properties.engine}
              data-testid="table-properties-engine"
              onChange={(value) => handlePropertyChange('engine', value)}
              workspaceTabId={tabId}
              triggerClassName={styles.control}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} id={`table-properties-charset-label-${tabId}`}>
              <span>Character set</span>
              <LabelSpinner isLoading={isCharsetsLoading} />
            </label>
            <Dropdown
              id={`table-properties-charset-${tabId}`}
              labelledBy={`table-properties-charset-label-${tabId}`}
              options={charsetDropdownOptions}
              value={selectedCharset}
              disabled={isCharsetsLoading}
              data-testid="table-properties-charset"
              onChange={(value) => handlePropertyChange('charset', value)}
              workspaceTabId={tabId}
              triggerClassName={styles.control}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} id={`table-properties-collation-label-${tabId}`}>
              <span>Collation</span>
              <LabelSpinner isLoading={isCollationsLoading} />
            </label>
            <Dropdown
              id={`table-properties-collation-${tabId}`}
              labelledBy={`table-properties-collation-label-${tabId}`}
              options={collationDropdownOptions}
              value={properties.collation}
              disabled={isCollationsLoading || !selectedCharset}
              data-testid="table-properties-collation"
              onChange={(value) => handlePropertyChange('collation', value)}
              workspaceTabId={tabId}
              triggerClassName={styles.control}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`table-properties-auto-increment-${tabId}`}>
              Auto increment
            </label>
            <TextInput
              id={`table-properties-auto-increment-${tabId}`}
              variant="bare"
              type="number"
              min="1"
              className={`ui-field-chrome ${styles.control}`}
              value={autoIncrementInputValue(properties)}
              data-testid="table-properties-auto-increment"
              onChange={(event) =>
                handlePropertyChange('autoIncrement', parseAutoIncrement(event.target.value))
              }
            />
          </div>
        </div>

        <div className={styles.column}>
          <div className={styles.fieldGroup}>
            <label className={styles.label} id={`table-properties-row-format-label-${tabId}`}>
              Row format
            </label>
            <Dropdown
              id={`table-properties-row-format-${tabId}`}
              labelledBy={`table-properties-row-format-label-${tabId}`}
              options={rowFormatDropdownOptions}
              value={properties.rowFormat}
              data-testid="table-properties-row-format"
              onChange={(value) => handlePropertyChange('rowFormat', value)}
              workspaceTabId={tabId}
              triggerClassName={styles.control}
            />
          </div>
        </div>

        <div className={`${styles.fieldGroup} ${styles.fullWidth}`}>
          <label className={styles.label} htmlFor={`table-properties-comment-${tabId}`}>
            Comment
          </label>
          <Textarea
            id={`table-properties-comment-${tabId}`}
            variant="bare"
            className={`ui-field-chrome ${styles.control} ${styles.textarea}`}
            value={properties.comment}
            data-testid="table-properties-comment"
            onChange={(event) => handlePropertyChange('comment', event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
