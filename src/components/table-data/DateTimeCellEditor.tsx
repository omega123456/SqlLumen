/**
 * DateTimeCellEditor — react-data-grid cell editor for MySQL temporal columns.
 *
 * Uses the shared useCellEditor hook for value state, NULL toggle, and
 * store syncing. Adds a calendar/clock icon button that opens the
 * DateTimePicker popup via portal rendering.
 *
 * Focus management:
 *
 * 1. The column definition includes `editorOptions: { commitOnOutsideClick: false }`
 *    which prevents react-data-grid from prematurely committing the editor
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarBlank, Clock } from '@phosphor-icons/react'
import { getTemporalColumnType } from '../../lib/date-utils'
import type { TemporalColumnType } from '../../lib/date-utils'
import { useCellEditor } from './useCellEditor'
import type { CellEditorParams, CellEditorCallbacks } from './useCellEditor'
import sharedStyles from '../shared/grid-cell-editors.module.css'
import { DateTimePicker } from './DateTimePicker'
import styles from '../shared/BaseGridView.module.css'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DateTimeCellEditor(props: CellEditorParams & CellEditorCallbacks) {
  const col = props.columnMeta
  const temporalType: TemporalColumnType = getTemporalColumnType(col.dataType)

  // Split props into editor params and callbacks for useCellEditor
  const editorParams: CellEditorParams = {
    row: props.row,
    column: props.column,
    onRowChange: props.onRowChange,
    onClose: props.onClose,
    isNullable: props.isNullable,
    columnMeta: props.columnMeta,
  }
  const callbacks: CellEditorCallbacks = {
    tabId: props.tabId,
    updateCellValue: props.updateCellValue,
    syncCellValue: props.syncCellValue,
  }

  // Shared cell editor logic (value, null, store sync)
  const editor = useCellEditor(editorParams, callbacks)

  const [pickerOpen, setPickerOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const pickerPopupRef = useRef<HTMLDivElement>(null)

  // -----------------------------------------------------------------------
  // Focus management: attach a mousedown handler to the portal that calls
  // preventDefault() for clicks on non-focusable areas (keeps focus on cell
  // editor input when the user clicks calendar background, labels, etc.).
  // Note: commitOnOutsideClick is disabled in the column definition, so
  // we no longer need stopPropagation() to prevent RDG's outside-click
  // detection from firing.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!pickerOpen) return

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const focusableSelector = 'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
      const isFocusable = target.matches(focusableSelector) || !!target.closest(focusableSelector)
      if (!isFocusable) {
        e.preventDefault() // Keep focus on cell editor input
      }
    }

    // Use setTimeout(0) so the portal DOM has been flushed by React
    const timer = setTimeout(() => {
      const portalEl = pickerPopupRef.current
      if (portalEl) {
        portalEl.addEventListener('mousedown', handleMouseDown)
      }
    }, 0)

    return () => {
      clearTimeout(timer)
      const portalEl = pickerPopupRef.current
      if (portalEl) {
        portalEl.removeEventListener('mousedown', handleMouseDown)
      }
    }
  }, [pickerOpen])

  // -----------------------------------------------------------------------
  // Scroll-close: close the picker if the grid body scrolls, since
  // repositioning the popup on scroll would be complex and closing is the
  // convention in desktop data tools.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!pickerOpen) return

    const gridBody = containerRef.current?.closest('.rdg')
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
    if (!editor.isNull) {
      // About to activate NULL — close picker if open
      setPickerOpen(false)
    }
    editor.handleToggleNull()
  }, [editor, setPickerOpen])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickerOpen) {
          // First Escape: just close the picker, keep cell editing active.
          // stopPropagation prevents the DateTimePicker's document-level Escape
          // handler from also firing.
          e.stopPropagation()
          setPickerOpen(false)
        } else {
          // Picker already closed (or was never open): cancel the cell edit
          // and restore the original value.
          editor.restoreOriginalValue()
          // Discard edit, don't refocus grid
          props.onClose(false, false)
        }
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        // Commit and focus grid for navigation
        const fieldName = props.column.key
        const committedValue = editor.isNull ? null : editor.value
        props.onRowChange({ ...props.row, [fieldName]: committedValue }, true)
        props.onClose(true, true)
        e.preventDefault()
        return
      }
    },
    [editor, pickerOpen, props]
  )

  const handlePickerApply = useCallback(
    (val: string) => {
      editor.handleChange(val)
      setPickerOpen(false)
    },
    [editor]
  )

  const handlePickerCancel = useCallback(() => {
    setPickerOpen(false)
  }, [])

  const handleCalendarClick = useCallback(() => {
    // Don't open picker when the field is in NULL state
    if (editor.isNull) return
    setPickerOpen(true)
  }, [editor.isNull])

  const handleInputBlur = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (relatedTarget instanceof Node && containerRef.current?.contains(relatedTarget)) {
        return
      }

      const pickerPopup = pickerPopupRef.current
      if (relatedTarget instanceof Node && pickerPopup?.contains(relatedTarget)) {
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

  const displayValue = editor.isNull ? '' : (editor.value ?? '')
  const IconComponent = temporalType === 'TIME' ? Clock : CalendarBlank

  return (
    <div
      ref={containerRef}
      className={`${sharedStyles.cellEditorWrapper} ${styles.dateTimeEditorWrapper}`}
      data-testid="datetime-cell-editor"
    >
      <div className="td-cell-editor-shell">
        <input
          ref={editor.inputRef}
          className="td-cell-editor-input"
          value={displayValue}
          onChange={(e) => editor.handleChange(e.target.value)}
          onBlur={(e) => handleInputBlur(e.relatedTarget)}
          onKeyDown={handleKeyDown}
        />
        {props.isNullable && (
          <button
            type="button"
            className={`td-null-toggle ${editor.isNull ? 'td-null-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleToggleNull}
            tabIndex={-1}
          >
            NULL
          </button>
        )}
      </div>
      <button
        type="button"
        className={styles.calendarBtn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleCalendarClick}
        disabled={editor.isNull}
        tabIndex={-1}
        data-testid="grid-calendar-btn"
        aria-label="Open date picker"
      >
        <IconComponent size={14} />
      </button>

      {pickerOpen && (
        <DateTimePicker
          value={editor.value}
          columnType={temporalType}
          disabled={editor.isNull}
          anchorEl={containerRef.current}
          popupRef={pickerPopupRef}
          onApply={handlePickerApply}
          onCancel={handlePickerCancel}
        />
      )}
    </div>
  )
}
