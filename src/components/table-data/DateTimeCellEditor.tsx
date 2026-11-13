/**
 * DateTimeCellEditor — shared grid cell editor for MySQL temporal columns.
 *
 * Uses the shared useCellEditor hook for value state, NULL toggle, and
 * store syncing. Adds a calendar/clock icon button that opens the
 * DateTimePicker popup via portal rendering.
 *
 * Focus management:
 *
 * 1. The column definition includes `editorOptions: { commitOnOutsideClick: false }`
 *    which prevents the grid from prematurely committing the editor
 *    when the user clicks inside the portal-rendered DateTimePicker popup.
 *    The editor manages its own commit/close lifecycle via onClose().
 *
 * 2. `mousedown` + `preventDefault()` handler on the portal container —
 *    prevents the browser from moving focus away from the cell editor's input
 *    when the user clicks non-focusable areas within the picker (calendar
 *    background, labels, etc.).
 *
 * Double-update guard: When the picker applies a value, it calls
 * editor.handleChange which updates the store immediately. When the grid's
 * onRowsChange handler fires, it compares the new value against the current
 * store value and skips redundant updateCellValue calls if they match.
 *
 * Decoupled from useTableDataStore — reads callbacks from props
 * (provided via closures in column definitions).
 */

import { TextInput } from '../common/TextInput'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarBlank, Clock } from '@phosphor-icons/react'
import { getTemporalColumnType } from '../../lib/date-utils'
import type { TemporalColumnType } from '../../lib/date-utils'
import { useCellEditor } from './useCellEditor'
import type { CellEditorParams } from './useCellEditor'
import type { EditorCallbacksContextType } from '../shared/editor-callbacks-context'
import { Button } from '../common/Button'
import sharedStyles from '../shared/grid-cell-editors.module.css'
import { DateTimePicker } from './DateTimePicker'
import styles from '../shared/BaseGridView.module.css'
import { isTargetInside, isTargetWithin } from '../../lib/input-events'

const FOCUSABLE_SELECTOR = 'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
const COMMIT_KEYS: ReadonlySet<string> = new Set(['Tab', 'Enter'])

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DateTimeCellEditor(props: CellEditorParams & EditorCallbacksContextType) {
  const { onClose } = props
  const column = props.columnMeta
  const temporalType: TemporalColumnType = getTemporalColumnType(column.dataType)

  // Split props into editor params and callbacks for useCellEditor
  const editorParams: CellEditorParams = {
    row: props.row,
    column: props.column,
    onRowChange: props.onRowChange,
    onClose: props.onClose,
    isNullable: props.isNullable,
    columnMeta: props.columnMeta,
    initialInputValue: props.initialInputValue,
    selectAllOnFocus: props.selectAllOnFocus,
  }
  const callbacks: EditorCallbacksContextType = {
    tabId: props.tabId,
    updateCellValue: props.updateCellValue,
    syncCellValue: props.syncCellValue,
  }

  // Shared cell editor logic (value, null, store sync)
  const editor = useCellEditor(editorParams, callbacks)
  const {
    isNull,
    value,
    inputRef,
    handleToggleNull: baseHandleToggleNull,
    handleChange,
    restoreOriginalValue,
  } = editor

  const [pickerOpen, setPickerOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const pickerPopupRef = useRef<HTMLDivElement>(null)
  const [anchorElement, setAnchorElement] = useState<HTMLDivElement | null>(null)

  // -----------------------------------------------------------------------
  // Focus management: attach a mousedown handler to the portal that calls
  // preventDefault() for clicks on non-focusable areas (keeps focus on cell
  // editor input when the user clicks calendar background, labels, etc.).
  // Note: commitOnOutsideClick is disabled in the column definition, so
  // we no longer need stopPropagation() to prevent grid outside-click
  // detection from firing.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!pickerOpen) return

    const handleMouseDown = (event: MouseEvent) => {
      const isFocusable = isTargetWithin(event.target, FOCUSABLE_SELECTOR)
      if (!isFocusable) {
        event.preventDefault() // Keep focus on cell editor input
      }
    }

    const portalElement = pickerPopupRef.current
    if (!portalElement) return

    portalElement.addEventListener('mousedown', handleMouseDown)

    return () => {
      portalElement.removeEventListener('mousedown', handleMouseDown)
    }
  }, [pickerOpen])

  // -----------------------------------------------------------------------
  // Scroll-close: close the picker if the grid body scrolls, since
  // repositioning the popup on scroll would be complex and closing is the
  // convention in desktop data tools.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!pickerOpen) return

    const gridBody = containerRef.current?.closest('.glide-grid-host')
    if (!gridBody) return

    const closeOnScroll = () => setPickerOpen(false)
    gridBody.addEventListener('scroll', closeOnScroll)
    return () => gridBody.removeEventListener('scroll', closeOnScroll)
  }, [pickerOpen])

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  // Wrap the hook's handleToggleNull to close the picker when activating NULL.
  // The hook doesn't own pickerOpen state, so we intercept here.
  const handleToggleNull = useCallback(() => {
    if (!isNull) {
      // About to activate NULL — close picker if open
      setPickerOpen(false)
    }
    baseHandleToggleNull()
  }, [baseHandleToggleNull, isNull])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pickerOpen) {
          // Stops the DateTimePicker's document-level Escape handler from also closing the edit.
          event.stopPropagation()
          setPickerOpen(false)
          return
        }
        restoreOriginalValue()
        props.onClose(false, false)
        return
      }
      if (COMMIT_KEYS.has(event.key)) {
        const fieldName = props.column.key
        const committedValue = isNull ? null : value
        props.onRowChange({ ...props.row, [fieldName]: committedValue }, true)
        props.onClose(true, true)
        event.preventDefault()
        return
      }
    },
    [isNull, pickerOpen, props, restoreOriginalValue, value]
  )

  const handlePickerApply = useCallback(
    (value: string) => {
      handleChange(value)
      setPickerOpen(false)
      onClose(true, false)
    },
    [handleChange, onClose]
  )

  const handlePickerCancel = useCallback(() => {
    setPickerOpen(false)
  }, [])

  const handleCalendarClick = useCallback(() => {
    // Don't open picker when the field is in NULL state
    if (isNull) return
    setPickerOpen(true)
  }, [isNull])

  const handleInputBlur = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (isTargetInside(containerRef.current, relatedTarget)) {
        return
      }

      if (isTargetInside(pickerPopupRef.current, relatedTarget)) {
        return
      }

      // Commit without refocusing the grid
      props.onClose(true, false)
    },
    [props]
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const displayValue = isNull ? '' : (value ?? '')
  const IconComponent = temporalType === 'TIME' ? Clock : CalendarBlank
  const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    setAnchorElement((current) => (current === node ? current : node))
  }, [])

  return (
    <div
      ref={handleContainerRef}
      className={`${sharedStyles.cellEditorWrapper} ${styles.dateTimeEditorWrapper}`}
      data-testid="datetime-cell-editor"
    >
      <div className={sharedStyles.editorFieldPrimary}>
        <TextInput
          ref={inputRef}
          variant="gridCell"
          className={sharedStyles.editorInput}
          value={displayValue}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => handleInputBlur(event.relatedTarget)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className={sharedStyles.editorMarkerGroup}>
        {props.isNullable && (
          <Button
            variant="bare"
            className={`td-null-toggle ${isNull ? 'td-null-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleToggleNull}
            tabIndex={-1}
          >
            NULL
          </Button>
        )}
        <Button
          variant="bare"
          className={styles.calendarBtn}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleCalendarClick}
          disabled={isNull}
          tabIndex={-1}
          data-testid="grid-calendar-btn"
          aria-label="Open date picker"
        >
          <IconComponent size={14} />
        </Button>
      </div>

      {pickerOpen && (
        <DateTimePicker
          value={value}
          columnType={temporalType}
          disabled={isNull}
          anchorEl={anchorElement}
          popupRef={pickerPopupRef}
          onApply={handlePickerApply}
          onCancel={handlePickerCancel}
          workspaceTabId={props.tabId || undefined}
        />
      )}
    </div>
  )
}
