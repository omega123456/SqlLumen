import { X } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import type { FilterCondition, FilterOperator } from '../../../types/schema'
import { isNullaryOperator } from '../filter-conditions'
import styles from '../FilterDialog.module.css'

const REMOVE_ICON_SIZE = 14

const OPERATORS: readonly FilterOperator[] = [
  '>',
  '>=',
  '<',
  '<=',
  '==',
  '!=',
  'LIKE',
  'NOT LIKE',
  'IS NULL',
  'IS NOT NULL',
]

const OPERATOR_DROPDOWN_OPTIONS: DropdownOption[] = OPERATORS.map((operator) => ({
  value: operator,
  label: operator,
}))

export type ConditionChangeHandler = (
  index: number,
  field: keyof FilterCondition,
  value: string
) => void

export interface FilterRowContext {
  columnDropdownOptions: DropdownOption[]
  onChange: ConditionChangeHandler
  onRemove: (index: number) => void
  registerValueInput: (index: number, element: HTMLInputElement | null) => void
}

interface FilterConditionRowProps {
  condition: FilterCondition
  index: number
  context: FilterRowContext
}

export function FilterConditionRow({ condition, index, context }: FilterConditionRowProps) {
  const isNullary = isNullaryOperator(condition.operator)
  const position = index + 1
  return (
    <div className={styles.row} data-testid="filter-row">
      <Dropdown
        id={`filter-column-${index}`}
        ariaLabel={`Column for condition ${position}`}
        options={context.columnDropdownOptions}
        value={condition.column}
        onChange={(value) => context.onChange(index, 'column', value)}
        data-testid={`filter-column-select-${index}`}
        className={styles.dropdownWrapper}
        triggerClassName={styles.columnSelect}
      />
      <Dropdown
        id={`filter-operator-${index}`}
        ariaLabel={`Operator for condition ${position}`}
        options={OPERATOR_DROPDOWN_OPTIONS}
        value={condition.operator}
        onChange={(value) => context.onChange(index, 'operator', value)}
        data-testid={`filter-operator-select-${index}`}
        className={styles.dropdownWrapper}
        triggerClassName={styles.operatorSelect}
      />
      <TextInput
        ref={(element) => context.registerValueInput(index, element)}
        variant="bare"
        type="text"
        className={`ui-field-chrome ${styles.valueInput} ${isNullary ? styles.valueInputDisabled : ''}`}
        value={condition.value}
        onChange={(event) => context.onChange(index, 'value', event.target.value)}
        disabled={isNullary}
        placeholder={isNullary ? 'n/a' : ''}
        aria-label={`Value for condition ${position}`}
        data-testid="filter-value-input"
      />
      <Button
        variant="bare"
        className={styles.removeButton}
        onClick={() => context.onRemove(index)}
        aria-label={`Remove condition ${position}`}
        data-testid="filter-remove-button"
      >
        <X size={REMOVE_ICON_SIZE} weight="bold" />
      </Button>
    </div>
  )
}
