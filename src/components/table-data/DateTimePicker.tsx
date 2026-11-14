import { useCallback, useRef, type ChangeEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import DatePicker from 'react-datepicker'
import type { TemporalColumnType } from '../../lib/date-utils'
import { TextInput } from '../common/TextInput'
import { Button } from '../common/Button'
import styles from './DateTimePicker.module.css'
import { useDateTimePickerPosition } from './useDateTimePickerPosition'
import { CalendarHeader } from './date-time-picker/CalendarHeader'
import { CALENDAR_COLUMN_TYPES } from './date-time-picker/date-time-picker-model'
import { usePickerDismissal } from './date-time-picker/use-picker-dismissal'
import { usePickerValue } from './date-time-picker/use-picker-value'

import 'react-datepicker/dist/react-datepicker.css'

export interface DateTimePickerProps {
  value: string | null
  columnType: TemporalColumnType
  disabled?: boolean
  anchorEl: HTMLElement | null
  popupRef?: RefObject<HTMLDivElement | null>
  onApply: (value: string) => void
  onCancel: () => void
  workspaceTabId?: string
}

interface CalendarSectionProps {
  localDate: Date | null
  onChange: (date: Date | null) => void
  onTodayClick: () => void
}

function CalendarSection({ localDate, onChange, onTodayClick }: CalendarSectionProps) {
  return (
    <div className={styles.calendarSection} data-testid="calendar-section">
      <DatePicker
        selected={localDate}
        onChange={onChange}
        inline
        shouldCloseOnSelect={false}
        renderCustomHeader={({ date, decreaseMonth, increaseMonth }) => (
          <CalendarHeader
            date={date}
            decreaseMonth={decreaseMonth}
            increaseMonth={increaseMonth}
            onTodayClick={onTodayClick}
          />
        )}
      />
    </div>
  )
}

interface TimeSectionProps {
  timeInput: string
  disabled: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

function TimeSection({ timeInput, disabled, onChange }: TimeSectionProps) {
  return (
    <div className={styles.timeSection} data-testid="time-section">
      <label className={styles.timeLabel}>TIME</label>
      <TextInput
        variant="bare"
        type="text"
        className={`ui-field-chrome ${styles.timeInput}`}
        value={timeInput}
        onChange={onChange}
        placeholder="HH:MM:SS"
        disabled={disabled}
        data-testid="time-input"
      />
    </div>
  )
}

interface PickerButtonsProps {
  disabled: boolean
  hasDate: boolean
  onCancel: () => void
  onApply: () => void
}

function PickerButtons({ disabled, hasDate, onCancel, onApply }: PickerButtonsProps) {
  return (
    <div className={styles.buttonRow}>
      <Button
        variant="bare"
        className={styles.cancelButton}
        onClick={onCancel}
        disabled={disabled}
        data-testid="btn-picker-cancel"
      >
        Cancel
      </Button>
      <Button
        variant="bare"
        className={`${styles.applyButton} ${hasDate ? '' : styles.applyButtonDisabled}`}
        onClick={onApply}
        disabled={disabled || !hasDate}
        data-testid="btn-picker-apply"
      >
        Apply
      </Button>
    </div>
  )
}

function useMergedPopupRef(externalPopupRef: RefObject<HTMLDivElement | null> | undefined) {
  const internalPopupRef = useRef<HTMLDivElement>(null)
  const mergedPopupRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalPopupRef.current = node
      if (externalPopupRef) externalPopupRef.current = node
    },
    [externalPopupRef]
  )
  return { internalPopupRef, mergedPopupRef }
}

export function DateTimePicker({
  value,
  columnType,
  disabled = false,
  anchorEl,
  popupRef,
  onApply,
  onCancel,
  workspaceTabId,
}: DateTimePickerProps) {
  const { internalPopupRef, mergedPopupRef } = useMergedPopupRef(popupRef)
  const picker = usePickerValue({ value: value, columnType: columnType, onApply: onApply })
  const position = useDateTimePickerPosition(anchorEl, onCancel)
  usePickerDismissal(
    { disabled: disabled, onCancel: onCancel, workspaceTabId: workspaceTabId },
    internalPopupRef
  )

  const popup = (
    <div
      ref={mergedPopupRef}
      className={`${styles.pickerPortal} click-outside-ignore ${disabled ? styles.disabled : ''}`}
      style={{ top: position.top, left: position.left }}
      data-testid="date-time-picker-popup"
    >
      <div className={styles.pickerWrapper}>
        {CALENDAR_COLUMN_TYPES.has(columnType) && (
          <CalendarSection
            localDate={picker.localDate}
            onChange={picker.handleDateChange}
            onTodayClick={picker.handleTodayClick}
          />
        )}
        {picker.showTime && (
          <TimeSection
            timeInput={picker.timeInput}
            disabled={disabled}
            onChange={picker.handleTimeInputChange}
          />
        )}
        <PickerButtons
          disabled={disabled}
          hasDate={picker.localDate !== null}
          onCancel={onCancel}
          onApply={picker.handleApply}
        />
      </div>
    </div>
  )

  return createPortal(popup, document.body)
}
