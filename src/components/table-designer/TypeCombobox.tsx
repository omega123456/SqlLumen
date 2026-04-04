import { useId, type FocusEventHandler, type KeyboardEvent, type ReactNode } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { MYSQL_TYPES } from './table-designer-type-constants'
import styles from './TypeCombobox.module.css'

interface TypeComboboxProps {
  value: string
  onChange: (type: string) => void
  disabled?: boolean
  inputProps?: {
    inputTestId?: string
    rowIndex?: number
    cellKey?: string
    onInputFocus?: FocusEventHandler<HTMLButtonElement>
    onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void
  }
}

const TYPE_OPTIONS: DropdownOption[] = MYSQL_TYPES.map((type) => ({
  value: type.name,
  label: type.name,
  description: type.group,
}))

function renderTriggerValue(selectedOptions: DropdownOption[], value: string): ReactNode {
  return selectedOptions[0]?.label ?? value
}

export function TypeCombobox({ value, onChange, disabled = false, inputProps }: TypeComboboxProps) {
  const { inputTestId, rowIndex, cellKey, onInputFocus, onKeyDown } = inputProps ?? {}
  const generatedId = useId()

  return (
    <Dropdown
      id={inputTestId ?? generatedId}
      ariaLabel="MySQL type"
      options={TYPE_OPTIONS}
      value={value}
      onChange={onChange}
      disabled={disabled}
      data-testid={inputTestId}
      triggerClassName={styles.trigger}
      renderTriggerValue={(selectedOptions) => renderTriggerValue(selectedOptions, value)}
      triggerProps={{
        'data-row-index': rowIndex,
        'data-cell-key': cellKey,
        onClick: (event) => event.stopPropagation(),
      }}
      onTriggerFocus={onInputFocus}
      onTriggerKeyDown={onKeyDown}
    />
  )
}
