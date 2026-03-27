import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// Mock react-datepicker before importing the component
vi.mock('react-datepicker', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({
      selected,
      onChange,
      inline,
      shouldCloseOnSelect,
      renderCustomHeader,
    }: {
      selected: Date | null
      onChange: (date: Date | null) => void
      inline: boolean
      shouldCloseOnSelect: boolean
      renderCustomHeader?: (params: {
        date: Date
        decreaseMonth: () => void
        increaseMonth: () => void
      }) => React.ReactNode
    }) => {
      return React.createElement(
        'div',
        {
          'data-testid': 'mock-datepicker',
          'data-inline': String(inline),
          'data-close-on-select': String(shouldCloseOnSelect),
        },
        renderCustomHeader
          ? renderCustomHeader({
              date: selected || new Date(2023, 10, 24),
              decreaseMonth: () => {},
              increaseMonth: () => {},
            })
          : null,
        React.createElement(
          'button',
          {
            'data-testid': 'mock-datepicker-select-day',
            onClick: () => onChange(new Date(2023, 10, 15)),
          },
          'Select Nov 15'
        )
      )
    },
  }
})

// Mock the react-datepicker CSS import
vi.mock('react-datepicker/dist/react-datepicker.css', () => ({}))

import { DateTimePicker } from '../../../components/table-data/DateTimePicker'
import type { TemporalColumnType } from '../../../lib/date-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAnchorEl() {
  const div = document.createElement('div')
  div.getBoundingClientRect = () => ({
    top: 100,
    left: 100,
    bottom: 150,
    right: 300,
    width: 200,
    height: 50,
    x: 100,
    y: 100,
    toJSON: () => {},
  })
  document.body.appendChild(div)
  return div
}

let anchorEl: HTMLElement

function renderPicker(
  overrides: Partial<{
    value: string | null
    columnType: TemporalColumnType
    disabled: boolean
    onApply: (v: string) => void
    onCancel: () => void
  }> = {}
) {
  const props = {
    value: '2023-11-24 14:30:00',
    columnType: 'DATETIME' as TemporalColumnType,
    disabled: false,
    anchorEl,
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  return { ...render(<DateTimePicker {...props} />), props }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  anchorEl = createAnchorEl()
  vi.clearAllMocks()
})

describe('DateTimePicker', () => {
  // ---- Mode rendering ----

  it('renders popup portal with data-testid', () => {
    renderPicker()
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
  })

  it('renders calendar section in DATE mode', () => {
    renderPicker({ value: '2023-11-24', columnType: 'DATE' })
    expect(screen.getByTestId('calendar-section')).toBeInTheDocument()
    expect(screen.queryByTestId('time-section')).not.toBeInTheDocument()
  })

  it('renders calendar + time in DATETIME mode', () => {
    renderPicker({ value: '2023-11-24 14:30:00', columnType: 'DATETIME' })
    expect(screen.getByTestId('calendar-section')).toBeInTheDocument()
    expect(screen.getByTestId('time-section')).toBeInTheDocument()
  })

  it('renders calendar + time in TIMESTAMP mode', () => {
    renderPicker({ value: '2023-11-24 14:30:00', columnType: 'TIMESTAMP' })
    expect(screen.getByTestId('calendar-section')).toBeInTheDocument()
    expect(screen.getByTestId('time-section')).toBeInTheDocument()
  })

  it('renders time input only in TIME mode', () => {
    renderPicker({ value: '09:30:00', columnType: 'TIME' })
    expect(screen.queryByTestId('calendar-section')).not.toBeInTheDocument()
    expect(screen.getByTestId('time-section')).toBeInTheDocument()
  })

  // ---- Apply button ----

  it('Apply button calls onApply with formatted MySQL string', () => {
    const onApply = vi.fn()
    renderPicker({ onApply, columnType: 'DATETIME', value: '2023-11-24 14:30:00' })

    const applyBtn = screen.getByTestId('btn-picker-apply')
    fireEvent.click(applyBtn)

    expect(onApply).toHaveBeenCalledTimes(1)
    // The value should be a formatted MySQL datetime string
    const calledWith = onApply.mock.calls[0][0]
    expect(calledWith).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('Apply button for DATE mode returns date-only format', () => {
    const onApply = vi.fn()
    renderPicker({ onApply, columnType: 'DATE', value: '2023-11-24' })

    fireEvent.click(screen.getByTestId('btn-picker-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0]).toBe('2023-11-24')
  })

  it('Apply button for TIME mode returns time-only format', () => {
    const onApply = vi.fn()
    renderPicker({ onApply, columnType: 'TIME', value: '09:30:00' })

    fireEvent.click(screen.getByTestId('btn-picker-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0]).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  // ---- Cancel button ----

  it('Cancel button calls onCancel', () => {
    const onCancel = vi.fn()
    renderPicker({ onCancel })

    fireEvent.click(screen.getByTestId('btn-picker-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Cancel does not call onApply', () => {
    const onApply = vi.fn()
    const onCancel = vi.fn()
    renderPicker({ onApply, onCancel })

    fireEvent.click(screen.getByTestId('btn-picker-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  // ---- Escape key ----

  it('Escape key calls onCancel', () => {
    const onCancel = vi.fn()
    renderPicker({ onCancel })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // ---- Enter key ----

  it('Enter key does NOT call onApply directly (day selection is handled by react-datepicker)', () => {
    const onApply = vi.fn()
    renderPicker({ onApply })

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onApply).not.toHaveBeenCalled()
  })

  // ---- Disabled state ----

  it('disabled state renders with reduced opacity class', () => {
    renderPicker({ disabled: true })

    const popup = screen.getByTestId('date-time-picker-popup')
    expect(popup.className).toContain('disabled')
  })

  it('disabled state does not call onCancel on click outside', () => {
    const onCancel = vi.fn()
    renderPicker({ disabled: true, onCancel })

    fireEvent.mouseDown(document.body)
    expect(onCancel).not.toHaveBeenCalled()
  })

  // ---- Today button ----

  it('Today button is rendered in calendar modes', () => {
    renderPicker({ columnType: 'DATE', value: '2023-11-24' })
    expect(screen.getByTestId('btn-today')).toBeInTheDocument()
  })

  it('Today button pre-selects today without calling onApply', () => {
    const onApply = vi.fn()
    renderPicker({ onApply, columnType: 'DATE', value: '2023-11-24' })

    fireEvent.click(screen.getByTestId('btn-today'))
    expect(onApply).not.toHaveBeenCalled()
  })

  // ---- Click outside ----

  it('click outside calls onCancel', () => {
    const onCancel = vi.fn()
    renderPicker({ onCancel })

    // Click outside the popup
    fireEvent.mouseDown(document.body)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  // ---- Time input ----

  it('time input shows initial time value', () => {
    renderPicker({ columnType: 'DATETIME', value: '2023-11-24 14:30:00' })

    const timeInput = screen.getByTestId('time-input') as HTMLInputElement
    expect(timeInput.value).toBe('14:30:00')
  })

  it('time input allows editing', () => {
    renderPicker({ columnType: 'DATETIME', value: '2023-11-24 14:30:00' })

    const timeInput = screen.getByTestId('time-input') as HTMLInputElement
    fireEvent.change(timeInput, { target: { value: '16:45:30' } })
    expect(timeInput.value).toBe('16:45:30')
  })

  // ---- Null value handling ----

  it('renders with null value without crashing', () => {
    renderPicker({ value: null, columnType: 'DATETIME' })
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
  })

  // ---- Calendar header ----

  it('calendar header shows month navigation arrows', () => {
    renderPicker({ columnType: 'DATE', value: '2023-11-24' })
    expect(screen.getByTestId('btn-prev-month')).toBeInTheDocument()
    expect(screen.getByTestId('btn-next-month')).toBeInTheDocument()
  })

  // ---- Value prop sync (controlled behavior) ----

  it('syncs localDate and timeInput when value prop changes externally', () => {
    const onApply = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <DateTimePicker
        value="2023-11-24 14:30:00"
        columnType="DATETIME"
        anchorEl={anchorEl}
        onApply={onApply}
        onCancel={onCancel}
      />
    )

    // Time input should show initial time
    const timeInput = screen.getByTestId('time-input') as HTMLInputElement
    expect(timeInput.value).toBe('14:30:00')

    // Re-render with a different value (simulating parent change)
    rerender(
      <DateTimePicker
        value="2024-06-15 09:00:00"
        columnType="DATETIME"
        anchorEl={anchorEl}
        onApply={onApply}
        onCancel={onCancel}
      />
    )

    // Time input should reflect the new value
    expect(timeInput.value).toBe('09:00:00')

    // Apply should emit the new value, not the stale initial value
    fireEvent.click(screen.getByTestId('btn-picker-apply'))
    expect(onApply).toHaveBeenCalledWith('2024-06-15 09:00:00')
  })

  it('syncs localDate for DATE mode when value prop changes', () => {
    const onApply = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <DateTimePicker
        value="2023-11-24"
        columnType="DATE"
        anchorEl={anchorEl}
        onApply={onApply}
        onCancel={onCancel}
      />
    )

    // Re-render with a different date
    rerender(
      <DateTimePicker
        value="2024-01-15"
        columnType="DATE"
        anchorEl={anchorEl}
        onApply={onApply}
        onCancel={onCancel}
      />
    )

    // Apply should emit the new date
    fireEvent.click(screen.getByTestId('btn-picker-apply'))
    expect(onApply).toHaveBeenCalledWith('2024-01-15')
  })

  it('does not reset user selection when value prop stays the same', () => {
    const onApply = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <DateTimePicker
        value="2023-11-24 14:30:00"
        columnType="DATETIME"
        anchorEl={anchorEl}
        onApply={onApply}
        onCancel={onCancel}
      />
    )

    // Change the time input manually
    const timeInput = screen.getByTestId('time-input') as HTMLInputElement
    fireEvent.change(timeInput, { target: { value: '16:45:30' } })
    expect(timeInput.value).toBe('16:45:30')

    // Re-render with the SAME value (parent re-rendered but didn't change value)
    rerender(
      <DateTimePicker
        value="2023-11-24 14:30:00"
        columnType="DATETIME"
        anchorEl={anchorEl}
        onApply={onApply}
        onCancel={onCancel}
      />
    )

    // User's in-progress edit should NOT be wiped
    expect(timeInput.value).toBe('16:45:30')
  })

  it('Apply then calls onApply only once for TIME mode', () => {
    const onApply = vi.fn()
    renderPicker({ onApply, columnType: 'TIME', value: '12:00:00' })

    fireEvent.click(screen.getByTestId('btn-picker-apply'))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  // ---- Focus management ----

  it('auto-focuses a focusable element inside the picker on mount', async () => {
    vi.useFakeTimers()
    renderPicker({ columnType: 'DATE', value: '2023-11-24' })

    // The auto-focus fires after a 50ms setTimeout
    await act(async () => {
      vi.advanceTimersByTime(60)
    })

    const popup = screen.getByTestId('date-time-picker-popup')
    // Focus should be inside the picker popup
    expect(popup.contains(document.activeElement)).toBe(true)

    vi.useRealTimers()
  })

  it('does not auto-focus when disabled', async () => {
    vi.useFakeTimers()
    const onCancel = vi.fn()
    renderPicker({ disabled: true, columnType: 'DATE', value: '2023-11-24', onCancel })

    await act(async () => {
      vi.advanceTimersByTime(60)
    })

    const popup = screen.getByTestId('date-time-picker-popup')
    // Focus should NOT have moved into the disabled picker
    expect(popup.contains(document.activeElement)).toBe(false)

    vi.useRealTimers()
  })

  it('tab order cycles through interactive picker elements', () => {
    renderPicker({ columnType: 'DATETIME', value: '2023-11-24 14:30:00' })

    const popup = screen.getByTestId('date-time-picker-popup')
    // Collect all focusable elements in natural DOM order within the popup
    const focusableElements = popup.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )

    // Should have multiple focusable elements (header buttons, time input, cancel, apply)
    expect(focusableElements.length).toBeGreaterThanOrEqual(4)

    // Verify the order: header buttons come before time input, which comes before action buttons
    const labels = Array.from(focusableElements).map(
      (el) => el.getAttribute('data-testid') || el.textContent?.trim() || el.tagName
    )
    const cancelIdx = labels.indexOf('btn-picker-cancel')
    const applyIdx = labels.indexOf('btn-picker-apply')
    const timeIdx = labels.indexOf('time-input')

    // Cancel and Apply should be the last two focusable elements
    expect(cancelIdx).toBeLessThan(applyIdx)
    // Time input should come before cancel/apply
    expect(timeIdx).toBeLessThan(cancelIdx)
  })
})
