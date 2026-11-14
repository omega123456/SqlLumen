/**
 * FilterDialog — modal for managing table data filter conditions.
 *
 * Users add/remove filter rows; each row has a column dropdown,
 * operator dropdown, and a value input.  All conditions are AND-joined.
 *
 * The dialog manages local editing state.  Changes are committed
 * to the parent via the `onApply` callback, which wires through
 * the store's `applyFilters` action.
 */

import { useCallback, useMemo } from 'react'
import { Funnel, Plus, X } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import type { DropdownOption } from '../common/Dropdown'
import { DialogShell } from './DialogShell'
import type { FilterCondition } from '../../types/schema'
import styles from './FilterDialog.module.css'
import { useFormSubmit } from '../../hooks/useFormSubmit'
import { FilterConditionRow, type FilterRowContext } from './filter-dialog/FilterConditionRow'
import { useFilterConditions } from './filter-dialog/use-filter-conditions'

/** Viewport fraction with a hard cap so the modal stays usable on large monitors. */
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
    <div className={styles.header}>
      <h2 className={styles.title}>Filter conditions</h2>
      <Button
        variant="bare"
        className={styles.closeButton}
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
      className={styles.addButton}
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
    <div className={styles.emptyState} data-testid="filter-empty-state">
      <Funnel size={EMPTY_ICON_SIZE} weight="thin" className={styles.emptyIcon} />
      <span className={styles.emptyTitle}>No filter conditions</span>
      <span className={styles.emptyHelp}>
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
    <div className={styles.footer}>
      <div className={styles.footerLeft}>
        {hasConditions && (
          <Button onClick={onClearAll} data-testid="filter-clear-all-button">
            Clear all
          </Button>
        )}
      </div>
      <div className={styles.footerRight}>
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
      <div className={styles.rows} data-testid="filter-rows">
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
      <div className={styles.root}>
        <FilterDialogHeader onCancel={onCancel} />
        <div className={styles.body}>
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
