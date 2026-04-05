/**
 * Shared cell editor components for react-data-grid.
 *
 * Both editors follow the react-data-grid declarative editor protocol:
 * - Accept { row, column, onRowChange, onClose } props
 * - Plus explicit callback props for store updates
 *
 * - NullableCellEditor: text input with optional NULL toggle
 * - EnumCellEditor: Dropdown with optional NULL toggle
 *
 * Also exports getCellEditorForColumn — a factory that selects the correct
 * editor (DateTimeCellEditor / EnumCellEditor / NullableCellEditor) based on
 * column metadata, used by both TableDataGrid and ResultGridView.
 */

import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TableDataColumnMeta, ForeignKeyColumnInfo } from '../../types/schema'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { ENUM_NULL_SENTINEL, getEnumFallbackValue } from '../table-data/enum-field-utils'
import { useEditorCallbacks } from './editor-callbacks-context'
import { useFkLookup } from './fk-lookup-context'
import { FkLookupTriggerButton } from './FkLookupTriggerButton'
import { TextInput } from '../common/TextInput'
import styles from './grid-cell-editors.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

// ---------------------------------------------------------------------------
// Shared editor props (react-data-grid protocol + store callbacks)
// ---------------------------------------------------------------------------

export interface CellEditorBaseProps {
  // react-data-grid editor protocol
  row: Record<string, unknown>
  column: { key: string }
  onRowChange: (row: Record<string, unknown>, commitChanges?: boolean) => void
  onClose: (commitChanges?: boolean, shouldFocusCell?: boolean) => void
  // Editor-specific
  isNullable?: boolean
  columnMeta?: TableDataColumnMeta
  /** FK metadata — when set, a FK trigger button is rendered in the editor. */
  foreignKey?: ForeignKeyColumnInfo
  // Store callbacks (provided via closures in column defs)
  tabId?: string
  updateCellValue?: (tabId: string, columnName: string, value: unknown) => void
  syncCellValue?: (
    tabId: string,
    rowData: Record<string, unknown> | undefined,
    columnName: string,
    value: unknown
  ) => void
}

// ---------------------------------------------------------------------------
// NullableCellEditor — text input + NULL toggle
// ---------------------------------------------------------------------------

export function NullableCellEditor(props: CellEditorBaseProps) {
  const { row, column, onRowChange, onClose } = props
  const isNullable = props.isNullable ?? false
  const fieldName = column.key
  const foreignKey = props.foreignKey
  const fkLookup = useFkLookup()

  const rawValue = row[fieldName]
  const initialNull = isNullish(rawValue)
  const initialValue = initialNull ? null : rawValue

  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState(initialNull ? '' : String(rawValue ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Resolve callbacks: prefer props when tabId is set, fallback to context
  const contextCallbacks = useEditorCallbacks()
  const tabId = props.tabId || contextCallbacks?.tabId || ''
  const updateCellValue = props.tabId
    ? props.updateCellValue
    : (contextCallbacks?.updateCellValue ?? props.updateCellValue)
  const syncCellValue = props.tabId
    ? props.syncCellValue
    : (contextCallbacks?.syncCellValue ?? props.syncCellValue)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  /** Push a value to both editState and the backing row data via callbacks. */
  const syncToStore = useCallback(
    (nextValue: unknown) => {
      if (tabId && fieldName && updateCellValue) {
        updateCellValue(tabId, fieldName, nextValue)
        syncCellValue?.(tabId, row, fieldName, nextValue)
      }
    },
    [fieldName, tabId, updateCellValue, syncCellValue, row]
  )

  const handleToggleNull = useCallback(() => {
    if (isNull) {
      setIsNull(false)
      onRowChange({ ...row, [fieldName]: '' })
      syncToStore('')
      // Restore with empty string
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setIsNull(true)
      setValue('')
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
    }
  }, [isNull, onRowChange, row, fieldName, syncToStore])

  const handleChange = useCallback(
    (nextValue: string) => {
      if (isNull) {
        setIsNull(false)
      }
      setValue(nextValue)
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [isNull, onRowChange, row, fieldName, syncToStore]
  )

  const displayValue = isNull ? '' : value

  const handleBlur = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (relatedTarget instanceof Node && wrapperRef.current?.contains(relatedTarget)) {
        return
      }
      // Commit without refocusing the grid
      onClose(true, false)
    },
    [onClose]
  )

  return (
    <div ref={wrapperRef} className={styles.cellEditorWrapper}>
      <div className="td-cell-editor-shell">
        <TextInput
          ref={inputRef}
          variant="gridCell"
          value={displayValue}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={(e) => handleBlur(e.relatedTarget)}
          onKeyDown={(e) => {
            if (
              e.key === 'F4' &&
              !e.altKey &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.shiftKey &&
              foreignKey &&
              fkLookup
            ) {
              e.preventDefault()
              e.stopPropagation()
              fkLookup.onFkLookup({
                columnKey: fieldName,
                currentValue: isNull ? null : value,
                foreignKey: foreignKey,
                rowData: row,
              })
              return
            }
            if (e.key === 'Tab' || e.key === 'Enter') {
              // Commit and focus grid for navigation
              onRowChange({ ...row, [fieldName]: isNull ? null : value }, true)
              onClose(true, true)
              e.preventDefault()
              return
            }
            if (e.key === 'Escape') {
              // Restore original value and sync to store
              setIsNull(initialNull)
              setValue(initialNull ? '' : String(initialValue ?? ''))
              syncToStore(initialValue)
              // Discard edit, don't refocus grid
              onClose(false, false)
              return
            }
          }}
        />
        {isNullable && (
          <button
            type="button"
            className={`td-null-toggle ${isNull ? 'td-null-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleToggleNull}
            tabIndex={-1}
          >
            NULL
          </button>
        )}
        {foreignKey && fkLookup && (
          <FkLookupTriggerButton
            foreignKey={foreignKey}
            columnKey={fieldName}
            currentValue={row[fieldName]}
            rowData={row}
            className={styles.fkTriggerButton}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EnumCellEditor — select + NULL toggle
// ---------------------------------------------------------------------------

export function EnumCellEditor(props: CellEditorBaseProps) {
  const { row, column, onRowChange, onClose } = props
  const enumValues = props.columnMeta?.enumValues ?? []
  const isNullable = props.isNullable ?? false
  const fieldName = column.key
  const foreignKey = props.foreignKey
  const fkLookup = useFkLookup()

  const rawValue = row[fieldName]
  const initialNull = isNullish(rawValue)
  const initialValue = initialNull ? null : String(rawValue ?? '')

  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState(initialValue ?? getEnumFallbackValue(props.columnMeta))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const isDropdownPortalTarget = useCallback((node: Node | null) => {
    if (!(node instanceof HTMLElement)) {
      return false
    }

    return node.getAttribute('role') === 'listbox' || node.closest('[role="listbox"]') !== null
  }, [])

  // Resolve callbacks: prefer props when tabId is set, fallback to context
  const contextCallbacks = useEditorCallbacks()
  const tabId = props.tabId || contextCallbacks?.tabId || ''
  const updateCellValue = props.tabId
    ? props.updateCellValue
    : (contextCallbacks?.updateCellValue ?? props.updateCellValue)
  const syncCellValue = props.tabId
    ? props.syncCellValue
    : (contextCallbacks?.syncCellValue ?? props.syncCellValue)

  useEffect(() => {
    triggerRef.current?.focus()
  }, [])

  const syncToStore = useCallback(
    (nextValue: string | null) => {
      if (tabId && fieldName && updateCellValue) {
        updateCellValue(tabId, fieldName, nextValue)
        syncCellValue?.(tabId, row, fieldName, nextValue)
      }
    },
    [fieldName, tabId, updateCellValue, syncCellValue, row]
  )

  const handleChange = useCallback(
    (nextValue: string) => {
      setIsNull(false)
      setValue(nextValue)
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [onRowChange, row, fieldName, syncToStore]
  )

  const handleToggleNull = useCallback(() => {
    if (isNull) {
      const fallbackValue = initialValue ?? getEnumFallbackValue(props.columnMeta)
      setIsNull(false)
      setValue(fallbackValue)
      onRowChange({ ...row, [fieldName]: fallbackValue })
      syncToStore(fallbackValue)
      setTimeout(() => triggerRef.current?.focus(), 0)
    } else {
      setIsNull(true)
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
    }
  }, [props.columnMeta, initialValue, isNull, onRowChange, row, fieldName, syncToStore])

  const enumOptions: DropdownOption[] = useMemo(() => {
    const out: DropdownOption[] = []
    if (isNullable) {
      out.push({ value: ENUM_NULL_SENTINEL, label: 'NULL' })
    }
    for (const ev of enumValues) {
      out.push({ value: ev, label: ev })
    }
    return out
  }, [enumValues, isNullable])

  const handleCommitKeys = useCallback(
    (e: ReactKeyboardEvent) => {
      if (
        e.key === 'F4' &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        foreignKey &&
        fkLookup
      ) {
        e.preventDefault()
        e.stopPropagation()
        fkLookup.onFkLookup({
          columnKey: fieldName,
          currentValue: isNull ? null : value,
          foreignKey: foreignKey,
          rowData: row,
        })
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        onRowChange({ ...row, [fieldName]: isNull ? null : value }, true)
        onClose(true, true)
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        setIsNull(initialNull)
        setValue(initialValue ?? getEnumFallbackValue(props.columnMeta))
        syncToStore(initialValue)
        onClose(false, false)
        e.preventDefault()
      }
    },
    [
      fieldName,
      fkLookup,
      foreignKey,
      initialNull,
      initialValue,
      isNull,
      onClose,
      onRowChange,
      props.columnMeta,
      row,
      syncToStore,
      value,
    ]
  )

  return (
    <div ref={wrapperRef} className={styles.cellEditorWrapper}>
      <div className="td-cell-editor-shell">
        <Dropdown
          ref={triggerRef}
          id={`enum-cell-${fieldName}`}
          ariaLabel={fieldName}
          options={enumOptions}
          value={isNull ? ENUM_NULL_SENTINEL : value}
          onChange={(nextValue) => {
            if (nextValue === ENUM_NULL_SENTINEL) {
              setIsNull(true)
              onRowChange({ ...row, [fieldName]: null })
              syncToStore(null)
              onClose(true, true)
              return
            }
            handleChange(nextValue)
            onClose(true, true)
          }}
          onTriggerKeyDown={handleCommitKeys}
          onListKeyDown={handleCommitKeys}
          focusListOnOpen={false}
          onTriggerBlur={(event) => {
            const nextFocused = event.relatedTarget
            if (
              nextFocused instanceof Node &&
              (wrapperRef.current?.contains(nextFocused) || isDropdownPortalTarget(nextFocused))
            ) {
              return
            }

            queueMicrotask(() => {
              const activeElement = document.activeElement
              if (
                activeElement instanceof Node &&
                (wrapperRef.current?.contains(activeElement) ||
                  isDropdownPortalTarget(activeElement))
              ) {
                return
              }
              onClose(true, false)
            })
          }}
          triggerClassName="td-cell-editor-select"
        />
        {isNullable && (
          <button
            type="button"
            className={`td-null-toggle ${isNull ? 'td-null-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleToggleNull}
            tabIndex={-1}
          >
            NULL
          </button>
        )}
        {foreignKey && fkLookup && (
          <FkLookupTriggerButton
            foreignKey={foreignKey}
            columnKey={fieldName}
            currentValue={row[fieldName]}
            rowData={row}
            className={styles.fkTriggerButton}
          />
        )}
      </div>
    </div>
  )
}

export interface CellEditorCallbackProps {
  tabId: string
  updateCellValue: (tabId: string, columnName: string, value: unknown) => void
  syncCellValue: (
    tabId: string,
    rowData: Record<string, unknown> | undefined,
    columnName: string,
    value: unknown
  ) => void
}
