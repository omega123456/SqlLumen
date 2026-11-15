import { X } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import type { FilterCondition, FilterOperator } from '../../../types/schema'
import { isNullaryOperator } from '../filter-conditions'
import { joinClassNames } from '../../../lib/class-names'
import { FIELD_CHROME } from '../../../lib/class-names-field'
import { FOCUS_RING } from '../../../lib/focus-ring'

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
    <div className="flex items-center gap-2" data-testid="filter-row">
      <Dropdown
        id={`filter-column-${index}`}
        ariaLabel={`Column for condition ${position}`}
        options={context.columnDropdownOptions}
        value={condition.column}
        onChange={(value) => context.onChange(index, 'column', value)}
        data-testid={`filter-column-select-${index}`}
        className="flex min-w-0 grow shrink basis-0"
        triggerSize="filter"
        triggerClassName="min-w-0 flex-1"
      />
      <Dropdown
        id={`filter-operator-${index}`}
        ariaLabel={`Operator for condition ${position}`}
        options={OPERATOR_DROPDOWN_OPTIONS}
        value={condition.operator}
        onChange={(value) => context.onChange(index, 'operator', value)}
        data-testid={`filter-operator-select-${index}`}
        className="flex min-w-0 grow shrink basis-0"
        triggerSize="filter"
        triggerClassName="min-w-0 flex-1"
      />
      <TextInput
        ref={(element) => context.registerValueInput(index, element)}
        variant="bare"
        type="text"
        className={joinClassNames([
          FIELD_CHROME,
          'h-8.5 min-w-0 grow shrink basis-0 px-2.5 font-body text-size-caption leading-5 disabled:opacity-50 disabled:placeholder:italic',
        ])}
        value={condition.value}
        onChange={(event) => context.onChange(index, 'value', event.target.value)}
        disabled={isNullary}
        placeholder={isNullary ? 'n/a' : ''}
        aria-label={`Value for condition ${position}`}
        data-testid="filter-value-input"
      />
      <Button
        variant="bare"
        className={joinClassNames([
          'flex size-6.5 min-w-6.5 cursor-pointer items-center justify-center rounded-control bg-transparent text-light-on-surface-variant transition-color-and-background hover:bg-light-fill-subtle-hover hover:text-light-error dark:text-dark-on-surface-variant dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-error',
          FOCUS_RING,
        ])}
        onClick={() => context.onRemove(index)}
        aria-label={`Remove condition ${position}`}
        data-testid="filter-remove-button"
      >
        <X size={REMOVE_ICON_SIZE} weight="bold" />
      </Button>
    </div>
  )
}
