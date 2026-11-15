import { useCallback, useMemo } from 'react'
import { Funnel, Plus, X } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import type { DropdownOption } from '../common/Dropdown'
import { DialogShell } from './DialogShell'
import type { FilterCondition } from '../../types/schema'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import {
  DIALOG_CLOSE_BUTTON,
  DIALOG_EDGE_TO_EDGE_ROOT,
  DIALOG_HEADER,
  DIALOG_HEADER_TITLE,
} from '../../lib/class-names-dialog'
import { useFormSubmit } from '../../hooks/useFormSubmit'
import { FilterConditionRow, type FilterRowContext } from './filter-dialog/FilterConditionRow'
import { useFilterConditions } from './filter-dialog/use-filter-conditions'

const PANEL_WIDTH = 'min(50vw, 720px)'
const PANEL_HEIGHT = 'min(50vh, 560px)'
const CLOSE_ICON_SIZE = 18
const ADD_ICON_SIZE = 14
const EMPTY_ICON_SIZE = 32

interface FilterDialogProps {
  isOpen: boolean
  onApply: (conditions: FilterCondition[]) => void
  onCancel: () => void
  initialConditions: FilterCondition[]
  columns: string[]
}

function FilterDialogHeader({ onCancel }: { onCancel: () => void }) {
  return (
    <div className={DIALOG_HEADER}>
      <h2 className={DIALOG_HEADER_TITLE}>Filter conditions</h2>
      <Button
        variant="bare"
        className={DIALOG_CLOSE_BUTTON}
        onClick={onCancel}
        aria-label="Close"
        data-testid="filter-dialog-close"
      >
        <X size={CLOSE_ICON_SIZE} weight="bold" />
      </Button>
    </div>
  )
}

function AddConditionButton({ onAdd }: { onAdd: () => void }) {
  return (
    <Button
      variant="bare"
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-control bg-transparent px-3 py-1.5 font-body text-size-caption font-semibold text-light-primary transition-color-and-background hover:bg-light-fill-subtle-hover dark:text-dark-primary dark:hover:bg-dark-fill-subtle-hover"
      onClick={onAdd}
      data-testid="filter-add-button"
    >
      <Plus size={ADD_ICON_SIZE} weight="bold" />
      <span>Add condition</span>
    </Button>
  )
}

function EmptyFilterState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8" data-testid="filter-empty-state">
      <Funnel
        size={EMPTY_ICON_SIZE}
        weight="thin"
        className="text-light-on-surface-variant opacity-40 dark:text-dark-on-surface-variant"
      />
      <span className="font-body text-size-caption text-light-on-surface-variant opacity-60 dark:text-dark-on-surface-variant">
        No filter conditions
      </span>
      <span className="max-w-85 text-center font-body text-size-caption leading-body text-light-on-surface-variant opacity-40 dark:text-dark-on-surface-variant">
        Add conditions to narrow table rows. All conditions are combined with AND.
      </span>
      <AddConditionButton onAdd={onAdd} />
    </div>
  )
}

interface FilterDialogFooterProps {
  hasConditions: boolean
  onClearAll: () => void
  onCancel: () => void
}

function FilterDialogFooter({ hasConditions, onClearAll, onCancel }: FilterDialogFooterProps) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-light-stroke-divider bg-light-surface p-6 dark:border-dark-stroke-divider dark:bg-dark-surface">
      <div className="flex items-center">
        {hasConditions && (
          <Button onClick={onClearAll} data-testid="filter-clear-all-button">
            Clear all
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="accent" type="submit" data-testid="filter-apply-button">
          Apply
        </Button>
        <Button onClick={onCancel} data-testid="filter-cancel-button">
          Cancel
        </Button>
      </div>
    </div>
  )
}

interface FilterConditionListProps {
  conditions: FilterCondition[]
  rowContext: FilterRowContext
  onAdd: () => void
}

function FilterConditionList({ conditions, rowContext, onAdd }: FilterConditionListProps) {
  if (conditions.length === 0) return <EmptyFilterState onAdd={onAdd} />
  return (
    <>
      <div className="flex flex-col gap-3" data-testid="filter-rows">
        {conditions.map((condition, index) => (
          <FilterConditionRow
            key={index}
            condition={condition}
            index={index}
            context={rowContext}
          />
        ))}
      </div>
      <AddConditionButton onAdd={onAdd} />
    </>
  )
}

export function FilterDialog({
  isOpen,
  onApply,
  onCancel,
  initialConditions,
  columns,
}: FilterDialogProps) {
  const filter = useFilterConditions({
    isOpen: isOpen,
    initialConditions: initialConditions,
    columns: columns,
  })
  const { conditions } = filter
  const handleSubmit = useFormSubmit(useCallback(() => onApply(conditions), [onApply, conditions]))
  const columnDropdownOptions: DropdownOption[] = useMemo(
    () => columns.map((column) => ({ value: column, label: column })),
    [columns]
  )

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      panelWidth={PANEL_WIDTH}
      panelHeight={PANEL_HEIGHT}
      testId="filter-dialog"
      ariaLabel="Filter conditions"
      formProps={{ onSubmit: handleSubmit }}
    >
      <div className={joinClassNames([DIALOG_EDGE_TO_EDGE_ROOT, 'min-h-0 flex-1'])}>
        <FilterDialogHeader onCancel={onCancel} />
        <div
          className={joinClassNames([
            'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-3 pb-6',
            SCROLLBAR,
          ])}
        >
          <FilterConditionList
            conditions={conditions}
            onAdd={filter.add}
            rowContext={{
              columnDropdownOptions: columnDropdownOptions,
              onChange: filter.change,
              onRemove: filter.remove,
              registerValueInput: filter.registerValueInput,
            }}
          />
        </div>
        <FilterDialogFooter
          hasConditions={conditions.length > 0}
          onClearAll={filter.clearAll}
          onCancel={onCancel}
        />
      </div>
    </DialogShell>
  )
}
