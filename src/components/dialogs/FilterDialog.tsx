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

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Funnel, Plus, X } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { DialogShell } from './DialogShell'
import type { FilterCondition, FilterOperator } from '../../types/schema'
import styles from './FilterDialog.module.css'
import { useFormSubmit } from '../../hooks/useFormSubmit'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const NULLARY_OPERATORS = new Set<string>(['IS NULL', 'IS NOT NULL'])

const DEFAULT_OPERATOR: FilterOperator = '=='

const OPERATOR_DROPDOWN_OPTIONS: DropdownOption[] = OPERATORS.map((op) => ({
  value: op,
  label: op,
}))

/** Viewport fraction with a hard cap so the modal stays usable on large monitors. */
const PANEL_WIDTH = 'min(50vw, 720px)'
const PANEL_HEIGHT = 'min(50vh, 560px)'

function copyConditions(conditions: FilterCondition[]): FilterCondition[] {
  return conditions.map((condition) => ({ ...condition }))
}

function copyConditionsWhenOpen(
  isOpen: boolean,
  initialConditions: FilterCondition[]
): FilterCondition[] {
  if (!isOpen) return []
  return copyConditions(initialConditions)
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FilterDialogProps {
  isOpen: boolean
  onApply: (conditions: FilterCondition[]) => void
  onCancel: () => void
  initialConditions: FilterCondition[]
  columns: string[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilterDialog({
  isOpen,
  onApply,
  onCancel,
  initialConditions,
  columns,
}: FilterDialogProps) {
  // Local editing copy — reset from props every time dialog opens.
  const [conditions, setConditions] = useState<FilterCondition[]>(() =>
    copyConditionsWhenOpen(isOpen, initialConditions)
  )
  const [syncedOpenState, setSyncedOpenState] = useState({ isOpen, initialConditions })
  const valueInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const hasAutoFocusedForOpenRef = useRef(false)

  const hasOpenStateChanged =
    syncedOpenState.isOpen !== isOpen || syncedOpenState.initialConditions !== initialConditions
  if (hasOpenStateChanged) {
    setSyncedOpenState({ isOpen, initialConditions })
  }
  const shouldResetConditions = hasOpenStateChanged && isOpen
  if (shouldResetConditions) {
    setConditions(copyConditions(initialConditions))
  }

  useEffect(() => {
    hasAutoFocusedForOpenRef.current = false
  }, [isOpen, initialConditions])

  // --- Handlers ---

  const defaultColumn = columns.length > 0 ? columns[0] : ''

  const handleAdd = useCallback(() => {
    setConditions((previous) => [
      ...previous,
      { column: defaultColumn, operator: DEFAULT_OPERATOR, value: '' },
    ])
  }, [defaultColumn])

  const handleRemove = useCallback((index: number) => {
    setConditions((previous) => previous.filter((_, conditionIndex) => conditionIndex !== index))
  }, [])

  const handleChange = useCallback((index: number, field: keyof FilterCondition, value: string) => {
    setConditions((previous) =>
      previous.map((condition, conditionIndex) => {
        if (conditionIndex !== index) return condition
        const updated = { ...condition, [field]: value }
        // Clear value when switching to a nullary operator
        if (field === 'operator' && NULLARY_OPERATORS.has(value)) {
          updated.value = ''
        }
        return updated
      })
    )
  }, [])

  const handleClearAll = useCallback(() => {
    setConditions([])
  }, [])

  const handleApply = useCallback(() => {
    onApply(conditions)
  }, [onApply, conditions])

  const handleSubmit = useFormSubmit(handleApply)

  const columnDropdownOptions: DropdownOption[] = useMemo(
    () => columns.map((column) => ({ value: column, label: column })),
    [columns]
  )

  useEffect(() => {
    if (!isOpen || conditions.length === 0 || hasAutoFocusedForOpenRef.current) return

    const firstFocusableInput = valueInputRefs.current.find((input) => input && !input.disabled)
    if (!firstFocusableInput) return

    let innerFrameId = 0
    const frameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        firstFocusableInput.focus()
        firstFocusableInput.select()
        hasAutoFocusedForOpenRef.current = true
      })
    })

    return () => {
      cancelAnimationFrame(frameId)
      cancelAnimationFrame(innerFrameId)
    }
  }, [conditions, isOpen])

  // --- Render ---

  const hasConditions = conditions.length > 0

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
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Filter conditions</h2>
          <Button
            variant="bare"
            className={styles.closeButton}
            onClick={onCancel}
            aria-label="Close"
            data-testid="filter-dialog-close"
          >
            <X size={18} weight="bold" />
          </Button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {hasConditions ? (
            <>
              {/* Condition rows */}
              <div className={styles.rows} data-testid="filter-rows">
                {conditions.map((cond, index) => {
                  const isNullary = NULLARY_OPERATORS.has(cond.operator)
                  return (
                    <div className={styles.row} key={index} data-testid="filter-row">
                      {/* Column */}
                      <Dropdown
                        id={`filter-column-${index}`}
                        ariaLabel={`Column for condition ${index + 1}`}
                        options={columnDropdownOptions}
                        value={cond.column}
                        onChange={(value) => handleChange(index, 'column', value)}
                        data-testid={`filter-column-select-${index}`}
                        className={styles.dropdownWrapper}
                        triggerClassName={styles.columnSelect}
                      />

                      {/* Operator */}
                      <Dropdown
                        id={`filter-operator-${index}`}
                        ariaLabel={`Operator for condition ${index + 1}`}
                        options={OPERATOR_DROPDOWN_OPTIONS}
                        value={cond.operator}
                        onChange={(value) => handleChange(index, 'operator', value)}
                        data-testid={`filter-operator-select-${index}`}
                        className={styles.dropdownWrapper}
                        triggerClassName={styles.operatorSelect}
                      />

                      {/* Value */}
                      <TextInput
                        ref={(element) => {
                          valueInputRefs.current[index] = element
                        }}
                        variant="bare"
                        type="text"
                        className={`ui-field-chrome ${styles.valueInput} ${isNullary ? styles.valueInputDisabled : ''}`}
                        value={cond.value}
                        onChange={(event) => handleChange(index, 'value', event.target.value)}
                        disabled={isNullary}
                        placeholder={isNullary ? 'n/a' : ''}
                        aria-label={`Value for condition ${index + 1}`}
                        data-testid="filter-value-input"
                      />

                      {/* Remove */}
                      <Button
                        variant="bare"
                        className={styles.removeButton}
                        onClick={() => handleRemove(index)}
                        aria-label={`Remove condition ${index + 1}`}
                        data-testid="filter-remove-button"
                      >
                        <X size={14} weight="bold" />
                      </Button>
                    </div>
                  )
                })}
              </div>

              {/* Add button */}
              <Button
                variant="bare"
                className={styles.addButton}
                onClick={handleAdd}
                data-testid="filter-add-button"
              >
                <Plus size={14} weight="bold" />
                <span>Add condition</span>
              </Button>
            </>
          ) : (
            /* Empty state */
            <div className={styles.emptyState} data-testid="filter-empty-state">
              <Funnel size={32} weight="thin" className={styles.emptyIcon} />
              <span className={styles.emptyTitle}>No filter conditions</span>
              <span className={styles.emptyHelp}>
                Add conditions to narrow table rows. All conditions are combined with AND.
              </span>
              <Button
                variant="bare"
                className={styles.addButton}
                onClick={handleAdd}
                data-testid="filter-add-button"
              >
                <Plus size={14} weight="bold" />
                <span>Add condition</span>
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            {hasConditions && (
              <Button onClick={handleClearAll} data-testid="filter-clear-all-button">
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
      </div>
    </DialogShell>
  )
}
