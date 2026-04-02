/**
 * Shared cell editor components for react-data-grid.
 *
 * Both editors follow the react-data-grid declarative editor protocol:
 * - Accept { row, column, onRowChange, onClose } props
 * - Plus explicit callback props for store updates
 *
 * - NullableCellEditor: text input with optional NULL toggle
 * - EnumCellEditor: select dropdown with optional NULL toggle
 *
 * Also exports getCellEditorForColumn — a factory that selects the correct
 * editor (DateTimeCellEditor / EnumCellEditor / NullableCellEditor) based on
 * column metadata, used by both TableDataGrid and ResultGridView.
 */

import { useCallback, useState, useRef, useEffect } from 'react'
import type { TableDataColumnMeta } from '../../types/schema'
import { getTemporalColumnType } from '../../lib/date-utils'
import {
  ENUM_NULL_SENTINEL,
  getEnumFallbackValue,
  isEnumColumn,
} from '../table-data/enum-field-utils'
import DateTimeCellEditor from '../table-data/DateTimeCellEditor'
import { useEditorCallbacks } from './editor-callbacks-context'
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
        <input
          ref={inputRef}
          className="td-cell-editor-input"
          value={displayValue}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={(e) => handleBlur(e.relatedTarget)}
          onKeyDown={(e) => {
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

  const rawValue = row[fieldName]
  const initialNull = isNullish(rawValue)
  const initialValue = initialNull ? null : String(rawValue ?? '')

  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState(initialValue ?? getEnumFallbackValue(props.columnMeta))
  const selectRef = useRef<HTMLSelectElement>(null)
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
    selectRef.current?.focus()
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
      setTimeout(() => selectRef.current?.focus(), 0)
    } else {
      setIsNull(true)
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
    }
  }, [props.columnMeta, initialValue, isNull, onRowChange, row, fieldName, syncToStore])

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
        <select
          ref={selectRef}
          className="td-cell-editor-select"
          value={isNull ? ENUM_NULL_SENTINEL : value}
          onBlur={(e) => handleBlur(e.relatedTarget)}
          onChange={(e) => {
            if (e.target.value === ENUM_NULL_SENTINEL) {
              setIsNull(true)
              onRowChange({ ...row, [fieldName]: null })
              syncToStore(null)
              return
            }
            handleChange(e.target.value)
          }}
          onKeyDown={(e) => {
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
              setValue(initialValue ?? getEnumFallbackValue(props.columnMeta))
              syncToStore(initialValue)
              // Discard edit, don't refocus grid
              onClose(false, false)
            }
          }}
        >
          {isNullable && <option value={ENUM_NULL_SENTINEL}>NULL</option>}
          {enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
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
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cell editor factory — selects the correct editor for a column
// ---------------------------------------------------------------------------

/**
 * Callback props that the factory passes through to each cell editor.
 * Both TableDataGrid and ResultGridView provide these with their own
 * concrete implementations (direct store callbacks vs. wrapped callbacks).
 */
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

/**
 * Return type of getCellEditorForColumn.
 * `editorOptions` may disable RDG's default close-on-external-row-change
 * behaviour, which would otherwise close the active editor whenever the
 * controlled `rows` prop changes during live typing.
 */
export interface CellEditorConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderEditCell: (props: any) => React.ReactElement
  editorOptions?: {
    commitOnOutsideClick?: boolean
    closeOnExternalRowChange?: boolean
  }
}

/**
 * Given column metadata and editor callback props, return the correct
 * `renderEditCell` function and optional `editorOptions`:
 *
 * - Temporal column → DateTimeCellEditor  (+ commitOnOutsideClick: false)
 * - Enum column     → EnumCellEditor
 * - Otherwise       → NullableCellEditor
 */
export function getCellEditorForColumn(
  col: TableDataColumnMeta | undefined,
  callbacks: CellEditorCallbackProps
): CellEditorConfig {
  const temporalType = col ? getTemporalColumnType(col.dataType) : null
  const sharedEditorOptions = { closeOnExternalRowChange: false }

  if (temporalType && col) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderEditCell: (props: any) => (
        <DateTimeCellEditor
          {...props}
          isNullable={col.isNullable}
          columnMeta={col}
          tabId={callbacks.tabId}
          updateCellValue={callbacks.updateCellValue}
          syncCellValue={callbacks.syncCellValue}
        />
      ),
      editorOptions: {
        ...sharedEditorOptions,
        commitOnOutsideClick: false,
      },
    }
  }

  if (col && isEnumColumn(col)) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderEditCell: (props: any) => (
        <EnumCellEditor
          {...props}
          isNullable={col.isNullable}
          columnMeta={col}
          tabId={callbacks.tabId}
          updateCellValue={callbacks.updateCellValue}
          syncCellValue={callbacks.syncCellValue}
        />
      ),
      editorOptions: sharedEditorOptions,
    }
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderEditCell: (props: any) => (
      <NullableCellEditor
        {...props}
        isNullable={col?.isNullable ?? false}
        columnMeta={col}
        tabId={callbacks.tabId}
        updateCellValue={callbacks.updateCellValue}
        syncCellValue={callbacks.syncCellValue}
      />
    ),
    editorOptions: sharedEditorOptions,
  }
}
