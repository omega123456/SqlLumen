import { useCallback, useRef, type ChangeEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import DatePicker from 'react-datepicker'
import type { TemporalColumnType } from '../../lib/date-utils'
import { TextInput } from '../common/TextInput'
import { Button } from '../common/Button'
import { useDateTimePickerPosition } from './useDateTimePickerPosition'
import { CalendarHeader } from './date-time-picker/CalendarHeader'
import { CALENDAR_COLUMN_TYPES } from './date-time-picker/date-time-picker-model'
import { usePickerDismissal } from './date-time-picker/use-picker-dismissal'
import { usePickerValue } from './date-time-picker/use-picker-value'
import { FIELD_CHROME } from '../../lib/class-names-field'
import { FOCUS_RING } from '../../lib/focus-ring'
import { joinClassNames } from '../../lib/class-names'

import 'react-datepicker/dist/react-datepicker.css'
import '../../styles/vendor/react-datepicker.css'

export interface DateTimePickerProps {
  value: string | null
  columnType: TemporalColumnType
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
    <div className="px-3 pt-3 pb-1" data-sqllumen-datetime-calendar data-testid="calendar-section">
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
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

function TimeSection({ timeInput, onChange }: TimeSectionProps) {
  return (
    <div
      className="flex items-center gap-2 border-t border-light-stroke-divider px-3.5 py-2.5 dark:border-dark-stroke-divider"
      data-testid="time-section"
    >
      <label className="shrink-0 font-body text-size-caption font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant">
        TIME
      </label>
      <TextInput
        variant="bare"
        type="text"
        className={joinClassNames([
          FIELD_CHROME,
          'flex-1 px-2.5 py-1.5 font-mono text-size-row transition-border-color-and-shadow duration-120',
        ])}
        value={timeInput}
        onChange={onChange}
        placeholder="HH:MM:SS"
        data-testid="time-input"
      />
    </div>
  )
}

interface PickerButtonsProps {
  hasDate: boolean
  onCancel: () => void
  onApply: () => void
}

function PickerButtons({ hasDate, onCancel, onApply }: PickerButtonsProps) {
  return (
    <div className="flex justify-end gap-2 border-t border-light-stroke-divider px-3.5 pt-2.5 pb-3.5 dark:border-dark-stroke-divider">
      <Button
        variant="bare"
        className={joinClassNames([
          'cursor-pointer rounded-control bg-transparent px-4 py-1.5 font-body text-size-caption font-semibold text-light-on-surface-variant transition-background-and-color duration-120 hover:bg-light-surface-container-high hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:bg-dark-surface-container-high dark:hover:text-dark-on-surface',
          FOCUS_RING,
        ])}
        onClick={onCancel}
        data-testid="btn-picker-cancel"
      >
        Cancel
      </Button>
      <Button
        variant="bare"
        className={joinClassNames([
          'cursor-pointer rounded-control bg-light-primary px-5 py-1.5 font-body text-size-caption font-semibold text-light-on-primary transition-filter-and-shadow duration-120 not-disabled:hover:brightness-110 disabled:cursor-default disabled:opacity-50 dark:bg-dark-primary dark:text-dark-on-primary',
          FOCUS_RING,
        ])}
        onClick={onApply}
        disabled={!hasDate}
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
  anchorEl,
  popupRef,
  onApply,
  onCancel,
  workspaceTabId,
}: DateTimePickerProps) {
  const { internalPopupRef, mergedPopupRef } = useMergedPopupRef(popupRef)
  const picker = usePickerValue({ value: value, columnType: columnType, onApply: onApply })
  const position = useDateTimePickerPosition(anchorEl, onCancel)
  usePickerDismissal({ onCancel: onCancel, workspaceTabId: workspaceTabId }, internalPopupRef)

  const popup = (
    <div
      ref={mergedPopupRef}
      className="fixed z-1100 click-outside-ignore"
      style={position}
      data-testid="date-time-picker-popup"
    >
      <div className="w-75 overflow-hidden rounded-overlay border border-light-stroke-flyout bg-light-surface-container-high font-body text-light-on-surface shadow-light-flyout dark:border-dark-stroke-flyout dark:bg-dark-surface-container-high dark:text-dark-on-surface dark:shadow-dark-flyout">
        {CALENDAR_COLUMN_TYPES.has(columnType) && (
          <CalendarSection
            localDate={picker.localDate}
            onChange={picker.handleDateChange}
            onTodayClick={picker.handleTodayClick}
          />
        )}
        {picker.showTime && (
          <TimeSection timeInput={picker.timeInput} onChange={picker.handleTimeInputChange} />
        )}
        <PickerButtons
          hasDate={picker.localDate !== null}
          onCancel={onCancel}
          onApply={picker.handleApply}
        />
      </div>
    </div>
  )

  return createPortal(popup, document.body)
}
