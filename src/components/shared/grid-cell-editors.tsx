/**
 * Shared AG Grid cell editor components and cell renderer.
 *
 * These are decoupled from any specific store — they receive their
 * update callbacks via the AG Grid `context` object (GridEditContext).
 *
 * - TableDataCellRenderer: displays NULL/BLOB indicators
 * - NullableCellEditor: text input with optional NULL toggle
 * - EnumCellEditor: select dropdown with optional NULL toggle
 */

import { useCallback, useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react'
import type { ICellEditorParams, ICellRendererParams } from 'ag-grid-community'
import type { TableDataColumnMeta } from '../../types/schema'
import { ENUM_NULL_SENTINEL, getEnumFallbackValue } from '../table-data/enum-field-utils'
import styles from './grid-cell-editors.module.css'

// ---------------------------------------------------------------------------
// Grid edit context — provided via AG Grid's `context` prop
// ---------------------------------------------------------------------------

export interface GridEditContext {
  tabId: string
  updateCellValue: (tabId: string, columnName: string, value: unknown) => void
  syncCellValue: (
    tabId: string,
    rowData: Record<string, unknown> | undefined,
    columnName: string,
    value: unknown
  ) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

// ---------------------------------------------------------------------------
// Custom cell renderer — NULL/BLOB display
// ---------------------------------------------------------------------------

export function TableDataCellRenderer(props: ICellRendererParams) {
  if (isNullish(props.value)) {
    return <span className="td-null-value">NULL</span>
  }
  if (typeof props.value === 'string' && props.value.startsWith('[BLOB')) {
    return <span className="td-blob-value">{props.value}</span>
  }
  return <span>{String(props.value)}</span>
}

// ---------------------------------------------------------------------------
// Custom cell editor — input + NULL toggle
// ---------------------------------------------------------------------------

interface NullableCellEditorProps extends ICellEditorParams {
  isNullable?: boolean
  columnMeta?: TableDataColumnMeta
}

export const NullableCellEditor = forwardRef(function NullableCellEditor(
  props: NullableCellEditorProps,
  ref: React.Ref<{ getValue: () => unknown }>
) {
  const isNullable = props.isNullable ?? false
  const initialNull = isNullish(props.value)
  const initialValue = initialNull ? null : props.value
  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState(initialNull ? '' : String(props.value ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Read updateCellValue, syncCellValue, and tabId from AG Grid context
  const context = props.context as GridEditContext | undefined
  const updateCellValue = context?.updateCellValue
  const syncCellValue = context?.syncCellValue
  const fieldName = props.colDef?.field
  const tabId = context?.tabId
  const rowData = props.data as Record<string, unknown> | undefined

  useImperativeHandle(ref, () => ({
    getValue: () => (isNull ? null : value),
    isCancelBeforeStart: () => false,
    isCancelAfterEnd: () => false,
  }))

  useEffect(() => {
    // Auto-focus the input after the editor mounts
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  /** Push a value to both editState and the backing row data via context. */
  const syncToStore = useCallback(
    (nextValue: unknown) => {
      if (tabId && fieldName && updateCellValue) {
        updateCellValue(tabId, fieldName, nextValue)
        syncCellValue?.(tabId, rowData, fieldName, nextValue)
      }
    },
    [fieldName, tabId, updateCellValue, syncCellValue, rowData]
  )

  const handleToggleNull = useCallback(() => {
    if (isNull) {
      setIsNull(false)
      syncToStore('')
      // Restore with empty string
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setIsNull(true)
      setValue('')
      syncToStore(null)
    }
  }, [isNull, syncToStore])

  const handleChange = useCallback(
    (nextValue: string) => {
      if (isNull) {
        setIsNull(false)
      }
      setValue(nextValue)
      syncToStore(nextValue)
    },
    [isNull, syncToStore]
  )

  const displayValue = isNull ? '' : value

  const handleBlur = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (relatedTarget instanceof Node && wrapperRef.current?.contains(relatedTarget)) {
        return
      }

      props.api.stopEditing()
    },
    [props.api]
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
            // Let AG Grid handle Tab/Enter/Escape
            if (e.key === 'Tab' || e.key === 'Enter' || e.key === 'Escape') {
              if (e.key === 'Escape') {
                setIsNull(initialNull)
                setValue(initialNull ? '' : String(initialValue ?? ''))
                syncToStore(initialValue)
              }
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
})

// ---------------------------------------------------------------------------
// Enum cell editor — select + NULL toggle
// ---------------------------------------------------------------------------

export const EnumCellEditor = forwardRef(function EnumCellEditor(
  props: NullableCellEditorProps,
  ref: React.Ref<{ getValue: () => unknown }>
) {
  const enumValues = props.columnMeta?.enumValues ?? []
  const isNullable = props.isNullable ?? false
  const initialNull = isNullish(props.value)
  const initialValue = initialNull ? null : String(props.value ?? '')
  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState(initialValue ?? getEnumFallbackValue(props.columnMeta))
  const selectRef = useRef<HTMLSelectElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Read updateCellValue, syncCellValue, and tabId from AG Grid context
  const context = props.context as GridEditContext | undefined
  const updateCellValue = context?.updateCellValue
  const syncCellValue = context?.syncCellValue
  const fieldName = props.colDef?.field
  const tabId = context?.tabId
  const rowData = props.data as Record<string, unknown> | undefined

  useImperativeHandle(ref, () => ({
    getValue: () => (isNull ? null : value),
    isCancelBeforeStart: () => false,
    isCancelAfterEnd: () => false,
  }))

  useEffect(() => {
    selectRef.current?.focus()
  }, [])

  const syncToStore = useCallback(
    (nextValue: string | null) => {
      if (tabId && fieldName && updateCellValue) {
        updateCellValue(tabId, fieldName, nextValue)
        syncCellValue?.(tabId, rowData, fieldName, nextValue)
      }
    },
    [fieldName, tabId, updateCellValue, syncCellValue, rowData]
  )

  const handleChange = useCallback(
    (nextValue: string) => {
      setIsNull(false)
      setValue(nextValue)
      syncToStore(nextValue)
    },
    [syncToStore]
  )

  const handleToggleNull = useCallback(() => {
    if (isNull) {
      const fallbackValue = initialValue ?? getEnumFallbackValue(props.columnMeta)
      setIsNull(false)
      setValue(fallbackValue)
      syncToStore(fallbackValue)
      setTimeout(() => selectRef.current?.focus(), 0)
    } else {
      setIsNull(true)
      syncToStore(null)
    }
  }, [props.columnMeta, initialValue, isNull, syncToStore])

  const handleBlur = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (relatedTarget instanceof Node && wrapperRef.current?.contains(relatedTarget)) {
        return
      }

      props.api.stopEditing()
    },
    [props.api]
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
              syncToStore(null)
              return
            }
            handleChange(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsNull(initialNull)
              setValue(initialValue ?? getEnumFallbackValue(props.columnMeta))
              syncToStore(initialValue)
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
})
