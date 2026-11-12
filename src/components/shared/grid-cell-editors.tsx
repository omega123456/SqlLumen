/**
 * Shared cell editor components for grid adapters.
 *
 * Both editors follow the shared declarative editor protocol:
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
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import type { TableDataColumnMeta, ForeignKeyColumnInfo } from '../../types/schema'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { ENUM_NULL_SENTINEL, getEnumFallbackValue } from '../table-data/enum-field-utils'
import { useCellStoreSync } from './editor-callbacks-context'
import { useFkLookup } from './fk-lookup-context'
import { FkLookupTriggerButton } from './FkLookupTriggerButton'
import { TextInput } from '../common/TextInput'
import { Textarea } from '../common/Textarea'
import { Button } from '../common/Button'
import styles from './grid-cell-editors.module.css'
import { isTargetInside } from '../../lib/input-events'
import { isNullish } from '../../lib/value-checks'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared editor props (grid editor protocol + store callbacks)
// ---------------------------------------------------------------------------

export interface CellEditorBaseProps {
  // grid editor protocol
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
  initialInputValue?: string
  cancelRestoreValue?: unknown
  selectAllOnFocus?: boolean
}

interface EnumCellEditorProps extends CellEditorBaseProps {
  fullOverlay?: boolean
}

type ForeignKeyLookup = ReturnType<typeof useFkLookup>
type EditorField = HTMLInputElement | HTMLTextAreaElement

interface TextEditorInitialState {
  restoresToNull: boolean
  restoreValue: unknown
  isNull: boolean
  text: string
}

function initialEditingText(
  initialInputValue: string | undefined,
  restoresToNull: boolean,
  rawValue: unknown
): string {
  if (initialInputValue != null) return initialInputValue
  if (restoresToNull) return ''
  return String(rawValue ?? '')
}

function resolveTextEditorInitialState(props: CellEditorBaseProps): TextEditorInitialState {
  const rawValue = props.row[props.column.key]
  const hasCancelRestoreValue = Object.prototype.hasOwnProperty.call(props, 'cancelRestoreValue')
  const restoreSource = hasCancelRestoreValue ? props.cancelRestoreValue : rawValue
  const restoresToNull = isNullish(restoreSource)
  return {
    restoresToNull: restoresToNull,
    restoreValue: restoresToNull ? null : restoreSource,
    isNull: props.initialInputValue == null && restoresToNull,
    text: initialEditingText(props.initialInputValue, restoresToNull, rawValue),
  }
}

function focusEditorField(field: EditorField | null, selectAllOnFocus: boolean): void {
  field?.focus()
  if (selectAllOnFocus) {
    field?.select()
    return
  }
  const currentValue = field?.value ?? ''
  field?.setSelectionRange(currentValue.length, currentValue.length)
}

function isForeignKeyLookupKey(event: ReactKeyboardEvent): boolean {
  const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
  return event.key === 'F4' && !hasModifier
}

interface ForeignKeyLookupRequest {
  props: CellEditorBaseProps
  foreignKeyLookup: ForeignKeyLookup
  currentValue: unknown
}

function openForeignKeyLookupFromKey(
  event: ReactKeyboardEvent,
  request: ForeignKeyLookupRequest
): boolean {
  const { props, foreignKeyLookup } = request
  if (!isForeignKeyLookupKey(event)) return false
  if (!props.foreignKey) return false
  if (!foreignKeyLookup) return false
  event.preventDefault()
  event.stopPropagation()
  // The glide overlay portal outranks the dialog z-index, so close it before opening the dialog.
  props.onClose(true, false)
  foreignKeyLookup.onFkLookup({
    columnKey: props.column.key,
    currentValue: request.currentValue,
    foreignKey: props.foreignKey,
    rowData: props.row,
    source: 'keyboard',
  })
  return true
}

function nullToggleClassName(isNull: boolean): string {
  return `td-null-toggle ${isNull ? 'td-null-active' : ''}`
}

interface EditorMarkersProps {
  props: CellEditorBaseProps
  isNull: boolean
  onToggleNull: () => void
}

function EditorMarkers({ props, isNull, onToggleNull }: EditorMarkersProps) {
  const foreignKeyLookup = useFkLookup()
  const { row, foreignKey, onClose } = props
  const fieldName = props.column.key
  return (
    <div className={styles.editorMarkerGroup}>
      {props.isNullable && (
        <Button
          variant="bare"
          className={nullToggleClassName(isNull)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleNull}
          tabIndex={-1}
        >
          NULL
        </Button>
      )}
      {foreignKey && foreignKeyLookup && (
        <FkLookupTriggerButton
          foreignKey={foreignKey}
          columnKey={fieldName}
          currentValue={row[fieldName]}
          rowData={row}
          className={styles.fkTriggerButton}
          onBeforeLookup={() => onClose(true, false)}
        />
      )}
    </div>
  )
}

interface NullableTextEditorRefs {
  fieldRef: RefObject<EditorField | null>
  wrapperRef: RefObject<HTMLDivElement | null>
}

function useNullableTextEditor(props: CellEditorBaseProps, refs: NullableTextEditorRefs) {
  const { fieldRef, wrapperRef } = refs
  const { row, column, onRowChange, onClose } = props
  const fieldName = column.key
  const foreignKeyLookup = useFkLookup()
  const initialState = resolveTextEditorInitialState(props)
  const { restoresToNull, restoreValue } = initialState
  const [isNull, setIsNull] = useState(initialState.isNull)
  const [value, setValue] = useState(initialState.text)
  const isCancellingRef = useRef(false)
  const syncToStore = useCellStoreSync(props)
  const selectAllOnFocus = props.selectAllOnFocus ?? true

  useEffect(() => {
    focusEditorField(fieldRef.current, selectAllOnFocus)
  }, [fieldRef, selectAllOnFocus])

  const handleToggleNull = useCallback(() => {
    if (!isNull) {
      setIsNull(true)
      setValue('')
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
      return
    }
    setIsNull(false)
    onRowChange({ ...row, [fieldName]: '' })
    syncToStore('')
    setTimeout(() => fieldRef.current?.focus(), 0)
  }, [fieldName, fieldRef, isNull, onRowChange, row, syncToStore])

  const handleChange = useCallback(
    (nextValue: string) => {
      setIsNull(false)
      setValue(nextValue)
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [fieldName, onRowChange, row, syncToStore]
  )

  const handleBlur = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (isCancellingRef.current) return
      if (isTargetInside(wrapperRef.current, relatedTarget)) return
      onClose(true, false)
    },
    [onClose, wrapperRef]
  )

  const cancelEdit = useCallback(() => {
    isCancellingRef.current = true
    setIsNull(restoresToNull)
    setValue(restoresToNull ? '' : String(restoreValue ?? ''))
    onRowChange({ ...row, [fieldName]: restoreValue }, false)
    syncToStore(restoreValue)
    onClose(false, false)
  }, [fieldName, onClose, onRowChange, restoreValue, restoresToNull, row, syncToStore])

  const currentValue = isNull ? null : value

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent, isCommitKey: boolean) => {
      const lookupRequest = {
        props: props,
        foreignKeyLookup: foreignKeyLookup,
        currentValue: currentValue,
      }
      if (openForeignKeyLookupFromKey(event, lookupRequest)) return
      if (isCommitKey) {
        onRowChange({ ...row, [fieldName]: currentValue }, true)
        onClose(true, true)
        event.preventDefault()
        return
      }
      if (event.key === 'Escape') {
        cancelEdit()
      }
    },
    [cancelEdit, currentValue, fieldName, foreignKeyLookup, onClose, onRowChange, props, row]
  )

  return {
    isNull: isNull,
    displayValue: isNull ? '' : value,
    handleToggleNull: handleToggleNull,
    handleChange: handleChange,
    handleBlur: handleBlur,
    handleKeyDown: handleKeyDown,
  }
}

function isSingleLineCommitKey(event: ReactKeyboardEvent): boolean {
  return event.key === 'Tab' || event.key === 'Enter'
}

function isMultilineCommitKey(event: ReactKeyboardEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey
}

// ---------------------------------------------------------------------------
// NullableCellEditor — text input + NULL toggle
// ---------------------------------------------------------------------------

export function NullableCellEditor(props: CellEditorBaseProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { isNull, displayValue, handleToggleNull, handleChange, handleBlur, handleKeyDown } =
    useNullableTextEditor(props, { fieldRef: inputRef, wrapperRef: wrapperRef })

  return (
    <div ref={wrapperRef} className={styles.cellEditorWrapper}>
      <div className={styles.editorFieldPrimary}>
        <TextInput
          ref={inputRef}
          variant="gridCell"
          className={styles.editorInput}
          value={displayValue}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => handleBlur(event.relatedTarget)}
          onKeyDown={(event) => handleKeyDown(event, isSingleLineCommitKey(event))}
        />
      </div>
      <EditorMarkers props={props} isNull={isNull} onToggleNull={handleToggleNull} />
    </div>
  )
}

export function NullableMultilineCellEditor(props: CellEditorBaseProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { isNull, displayValue, handleToggleNull, handleChange, handleBlur, handleKeyDown } =
    useNullableTextEditor(props, { fieldRef: textareaRef, wrapperRef: wrapperRef })

  return (
    <div ref={wrapperRef} className={styles.multilineEditorWrapper}>
      <div className={styles.multilineEditorField}>
        <Textarea
          ref={textareaRef}
          variant="bare"
          className={styles.editorTextarea}
          rows={6}
          value={displayValue}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => handleBlur(event.relatedTarget)}
          onKeyDown={(event) => handleKeyDown(event, isMultilineCommitKey(event))}
        />
      </div>
      <EditorMarkers props={props} isNull={isNull} onToggleNull={handleToggleNull} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// EnumCellEditor — select + NULL toggle
// ---------------------------------------------------------------------------

function isDropdownPortalTarget(node: Node | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  return node.getAttribute('role') === 'listbox' || node.closest('[role="listbox"]') !== null
}

function isFocusInsideEnumEditor(wrapper: HTMLDivElement | null, target: EventTarget | null) {
  if (!(target instanceof Node)) return false
  return isTargetInside(wrapper, target) || isDropdownPortalTarget(target)
}

function buildEnumOptions(enumValues: string[], isNullable: boolean): DropdownOption[] {
  const valueOptions = enumValues.map((enumValue) => ({ value: enumValue, label: enumValue }))
  if (!isNullable) return valueOptions
  return [{ value: ENUM_NULL_SENTINEL, label: 'NULL' }, ...valueOptions]
}

interface EnumEditorLayout {
  wrapperClassName: string
  fieldWrapperClassName: string
  dropdownRootClassName: string
  dropdownTriggerClassName: string
  dropdownTriggerProps: Record<string, string> | undefined
}

const FULL_OVERLAY_ENUM_LAYOUT: EnumEditorLayout = {
  wrapperClassName: styles.dropdownOnlyWrapper,
  fieldWrapperClassName: styles.editorDropdownRoot,
  dropdownRootClassName: styles.editorDropdownRoot,
  dropdownTriggerClassName: `td-cell-editor-select ${styles.editorDropdownTrigger}`,
  dropdownTriggerProps: { 'data-sqllumen-grid-editor': 'enum-overlay' },
}

const INLINE_ENUM_LAYOUT: EnumEditorLayout = {
  wrapperClassName: styles.cellEditorWrapper,
  fieldWrapperClassName: styles.editorFieldPrimary,
  dropdownRootClassName: styles.editorField,
  dropdownTriggerClassName: `td-cell-editor-select ${styles.editorSelect}`,
  dropdownTriggerProps: undefined,
}

export function EnumCellEditor(props: EnumCellEditorProps) {
  const { row, column, onRowChange, onClose } = props
  const isNullable = props.isNullable === true
  const fieldName = column.key
  const foreignKeyLookup = useFkLookup()
  const fullOverlay = props.fullOverlay === true
  const layout = fullOverlay ? FULL_OVERLAY_ENUM_LAYOUT : INLINE_ENUM_LAYOUT

  const rawValue = row[fieldName]
  const initialNull = isNullish(rawValue)
  const initialValue = initialNull ? null : String(rawValue)
  const fallbackValue = initialValue ?? getEnumFallbackValue(props.columnMeta)

  const [isNull, setIsNull] = useState(initialNull)
  const [value, setValue] = useState(fallbackValue)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const syncToStore = useCellStoreSync(props)

  useEffect(() => {
    triggerRef.current?.focus()
  }, [])

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
    if (!isNull) {
      setIsNull(true)
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
      return
    }
    setIsNull(false)
    setValue(fallbackValue)
    onRowChange({ ...row, [fieldName]: fallbackValue })
    syncToStore(fallbackValue)
    setTimeout(() => triggerRef.current?.focus(), 0)
  }, [fallbackValue, isNull, onRowChange, row, fieldName, syncToStore])

  const enumValues = props.columnMeta?.enumValues
  const enumOptions = useMemo(
    () => buildEnumOptions(enumValues ?? [], isNullable),
    [enumValues, isNullable]
  )

  const currentValue = isNull ? null : value

  const handleCommitKeys = useCallback(
    (event: ReactKeyboardEvent) => {
      const lookupRequest = {
        props: props,
        foreignKeyLookup: foreignKeyLookup,
        currentValue: currentValue,
      }
      if (openForeignKeyLookupFromKey(event, lookupRequest)) return
      if (isSingleLineCommitKey(event)) {
        onRowChange({ ...row, [fieldName]: currentValue }, true)
        onClose(true, true)
        event.preventDefault()
        return
      }
      if (event.key === 'Escape') {
        setIsNull(initialNull)
        setValue(fallbackValue)
        syncToStore(initialValue)
        onClose(false, false)
        event.preventDefault()
      }
    },
    [
      currentValue,
      fallbackValue,
      fieldName,
      foreignKeyLookup,
      initialNull,
      initialValue,
      onClose,
      onRowChange,
      props,
      row,
      syncToStore,
    ]
  )

  const handleTriggerBlur = useCallback(
    (event: React.FocusEvent<HTMLButtonElement>) => {
      if (isFocusInsideEnumEditor(wrapperRef.current, event.relatedTarget)) return
      queueMicrotask(() => {
        if (isFocusInsideEnumEditor(wrapperRef.current, document.activeElement)) return
        onClose(true, false)
      })
    },
    [onClose]
  )

  const handleDropdownChange = (nextValue: string) => {
    if (nextValue === ENUM_NULL_SENTINEL) {
      setIsNull(true)
      onRowChange({ ...row, [fieldName]: null })
      syncToStore(null)
      onClose(true, true)
      return
    }
    handleChange(nextValue)
    onClose(true, true)
  }

  return (
    <div ref={wrapperRef} className={layout.wrapperClassName}>
      <div className={layout.fieldWrapperClassName}>
        <Dropdown
          ref={triggerRef}
          id={`enum-cell-${fieldName}`}
          ariaLabel={fieldName}
          options={enumOptions}
          value={isNull ? ENUM_NULL_SENTINEL : value}
          onChange={handleDropdownChange}
          onTriggerKeyDown={handleCommitKeys}
          onListKeyDown={handleCommitKeys}
          focusListOnOpen={fullOverlay}
          onTriggerBlur={fullOverlay ? undefined : handleTriggerBlur}
          className={layout.dropdownRootClassName}
          triggerClassName={layout.dropdownTriggerClassName}
          triggerProps={layout.dropdownTriggerProps}
        />
      </div>
      {!fullOverlay && (
        <EditorMarkers props={props} isNull={isNull} onToggleNull={handleToggleNull} />
      )}
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
