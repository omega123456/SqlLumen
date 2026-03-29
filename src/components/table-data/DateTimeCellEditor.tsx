/**
 * DateTimeCellEditor — AG Grid cell editor for MySQL temporal columns.
 *
 * Uses the shared useCellEditor hook for value state, NULL toggle, and
 * store syncing. Adds a calendar/clock icon button that opens the
 * DateTimePicker popup via portal rendering.
 *
 * Focus management (belt-and-suspenders):
 *
 * 1. `ag-custom-component-popup` class on the portal root — AG Grid's
 *    native mechanism. AG Grid treats any popup with this class as an
 *    extension of the cell editor, so `stopEditingWhenCellsLoseFocus`
 *    won't terminate the edit when focus moves to picker controls.
 *
 * 2. `mousedown` + `preventDefault()` handler on the portal container —
 *    a well-established pattern that prevents the browser from moving
 *    focus away from the cell editor's input when the user clicks
 *    non-focusable areas within the picker (calendar background, labels,
 *    etc.). We only call `preventDefault()` for non-focusable targets so
 *    that interactive elements like the time input and buttons still
 *    receive focus normally.
 *
 * Double-update guard: When the picker applies a value, it calls
 * editor.handleChange which updates the store immediately. When AG Grid
 * subsequently calls onCellEditingStopped, the grid's handler compares
 * the new value against the current store value and skips the redundant
 * updateCellValue call if they match.
 *
 * Decoupled from useTableDataStore — reads callbacks from AG Grid
 * context (GridEditContext) and passes them to useCellEditor.
 */

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { CalendarBlank, Clock } from '@phosphor-icons/react'
import { getTemporalColumnType } from '../../lib/date-utils'
import type { TemporalColumnType } from '../../lib/date-utils'
import { useCellEditor } from './useCellEditor'
import type { CellEditorParams } from './useCellEditor'
import type { GridEditContext } from '../shared/grid-cell-editors'
import sharedStyles from '../shared/grid-cell-editors.module.css'
import { DateTimePicker } from './DateTimePicker'
import styles from './TableDataGrid.module.css'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DateTimeCellEditor = forwardRef(function DateTimeCellEditor(
  params: CellEditorParams,
  ref: React.ForwardedRef<unknown>
) {
  const col = params.columnMeta
  const temporalType: TemporalColumnType = getTemporalColumnType(col.dataType)

  // Read callbacks from AG Grid context
  const context = params.context as GridEditContext | undefined
  const callbacks = {
    tabId: context?.tabId ?? '',
    updateCellValue: context?.updateCellValue ?? (() => {}),
    syncCellValue: context?.syncCellValue ?? (() => {}),
  }

  // Shared cell editor logic (value, null, store sync, imperative handle)
  const editor = useCellEditor(params, ref, callbacks)

  const [pickerOpen, setPickerOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // -----------------------------------------------------------------------
  // Focus management (belt-and-suspenders): In addition to the
  // ag-custom-component-popup class on the portal root, we attach a
  // mousedown handler that calls preventDefault() for clicks on
  // non-focusable areas. This prevents the browser from pulling focus
  // away from the cell editor's input when the user clicks calendar
  // backgrounds, labels, or other passive elements.  For focusable
  // elements (inputs, buttons, etc.) we let the event through so they
  // can receive focus normally — the ag-custom-component-popup class
  // keeps AG Grid from stopping the edit.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!pickerOpen) return

    let portalEl: HTMLElement | null = null

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
      portalEl = document.querySelector('[data-testid="date-time-picker-popup"]')
      if (portalEl) {
        portalEl.addEventListener('mousedown', handleMouseDown)
      }
    }, 0)

    return () => {
      clearTimeout(timer)
      if (portalEl) {
        portalEl.removeEventListener('mousedown', handleMouseDown)
      }
    }
  }, [pickerOpen])

  // -----------------------------------------------------------------------
  // Scroll-close: close the picker if the AG Grid body scrolls, since
  // repositioning the popup on scroll would be complex and closing is the
  // convention in desktop data tools.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!pickerOpen) return

    const gridBody = document.querySelector('.ag-body-viewport')
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
          params.api.stopEditing(true)
        }
        return
      }
      // Let AG Grid handle Tab/Enter
    },
    [editor, params.api, pickerOpen]
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

      const pickerPopup = document.querySelector('[data-testid="date-time-picker-popup"]')
      if (relatedTarget instanceof Node && pickerPopup?.contains(relatedTarget)) {
        return
      }

      params.api.stopEditing()
    },
    [params.api]
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const displayValue = editor.isNull ? '' : (editor.value ?? '')
  const IconComponent = temporalType === 'TIME' ? Clock : CalendarBlank

  return (
    <div
      ref={containerRef}
      className={sharedStyles.cellEditorWrapper}
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
        {params.isNullable && (
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
          onApply={handlePickerApply}
          onCancel={handlePickerCancel}
        />
      )}
    </div>
  )
})

export default DateTimeCellEditor
