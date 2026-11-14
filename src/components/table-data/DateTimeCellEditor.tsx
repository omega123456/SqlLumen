import { TextInput } from '../common/TextInput'
import { useCallback, useRef, useState, type MouseEvent } from 'react'
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
import {
  useClosePickerOnGridScroll,
  useKeepEditorFocusInPicker,
} from './date-time-cell-editor/use-picker-popup-effects'
import { useDateTimeEditorHandlers } from './date-time-cell-editor/use-date-time-editor-handlers'

interface EditorMarkersProps {
  isNullable: boolean
  isNull: boolean
  temporalType: TemporalColumnType
  onToggleNull: () => void
  onCalendarClick: () => void
}

function preventFocusSteal(event: MouseEvent) {
  event.preventDefault()
}

function EditorMarkers({
  isNullable,
  isNull,
  temporalType,
  onToggleNull,
  onCalendarClick,
}: EditorMarkersProps) {
  const IconComponent = temporalType === 'TIME' ? Clock : CalendarBlank
  return (
    <div className={sharedStyles.editorMarkerGroup}>
      {isNullable && (
        <Button
          variant="bare"
          className={`td-null-toggle ${isNull ? 'td-null-active' : ''}`}
          onMouseDown={preventFocusSteal}
          onClick={onToggleNull}
          tabIndex={-1}
        >
          NULL
        </Button>
      )}
      <Button
        variant="bare"
        className={styles.calendarBtn}
        onMouseDown={preventFocusSteal}
        onClick={onCalendarClick}
        disabled={isNull}
        tabIndex={-1}
        data-testid="grid-calendar-btn"
        aria-label="Open date picker"
      >
        <IconComponent size={14} />
      </Button>
    </div>
  )
}

function splitEditorProps(props: CellEditorParams & EditorCallbacksContextType) {
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
  return { editorParams, callbacks }
}

function useAnchoredContainer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [anchorElement, setAnchorElement] = useState<HTMLDivElement | null>(null)
  const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    setAnchorElement((current) => (current === node ? current : node))
  }, [])
  return { containerRef, anchorElement, handleContainerRef }
}

export default function DateTimeCellEditor(props: CellEditorParams & EditorCallbacksContextType) {
  const temporalType: TemporalColumnType = getTemporalColumnType(props.columnMeta.dataType)
  const { editorParams, callbacks } = splitEditorProps(props)
  const editor = useCellEditor(editorParams, callbacks)
  const { isNull, value, inputRef, handleChange } = editor
  const [pickerOpen, setPickerOpen] = useState(false)
  const closePicker = useCallback(() => setPickerOpen(false), [])
  const pickerPopupRef = useRef<HTMLDivElement>(null)
  const { containerRef, anchorElement, handleContainerRef } = useAnchoredContainer()
  useKeepEditorFocusInPicker(pickerOpen, pickerPopupRef)
  useClosePickerOnGridScroll(pickerOpen, closePicker, containerRef)
  const handlers = useDateTimeEditorHandlers(
    { props: editorParams, editor: editor, pickerOpen: pickerOpen, setPickerOpen: setPickerOpen },
    containerRef,
    pickerPopupRef
  )

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
          value={isNull ? '' : (value ?? '')}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => handlers.handleInputBlur(event.relatedTarget)}
          onKeyDown={handlers.handleKeyDown}
        />
      </div>
      <EditorMarkers
        isNullable={props.isNullable}
        isNull={isNull}
        temporalType={temporalType}
        onToggleNull={handlers.handleToggleNull}
        onCalendarClick={handlers.handleCalendarClick}
      />
      {pickerOpen && (
        <DateTimePicker
          value={value}
          columnType={temporalType}
          disabled={isNull}
          anchorEl={anchorElement}
          popupRef={pickerPopupRef}
          onApply={handlers.handlePickerApply}
          onCancel={closePicker}
          workspaceTabId={props.tabId || undefined}
        />
      )}
    </div>
  )
}
