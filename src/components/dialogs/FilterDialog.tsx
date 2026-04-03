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

import { useState, useCallback, useEffect } from 'react'
import { Funnel, Plus, X } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { DialogShell } from './DialogShell'
import type { FilterCondition, FilterOperator } from '../../types/schema'
import styles from './FilterDialog.module.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPERATORS: readonly FilterOperator[] = [
  '>',
  '>=',
  '<',
  '<=',
  '==',
  'LIKE',
  'NOT LIKE',
  'IS NULL',
  'IS NOT NULL',
]

const NULLARY_OPERATORS = new Set<string>(['IS NULL', 'IS NOT NULL'])

const DEFAULT_OPERATOR: FilterOperator = '=='

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
  const [conditions, setConditions] = useState<FilterCondition[]>([])

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConditions(initialConditions.map((c) => ({ ...c })))
    }
  }, [isOpen, initialConditions])

  // --- Handlers ---

  const defaultColumn = columns.length > 0 ? columns[0] : ''

  const handleAdd = useCallback(() => {
    setConditions((prev) => [
      ...prev,
      { column: defaultColumn, operator: DEFAULT_OPERATOR, value: '' },
    ])
  }, [defaultColumn])

  const handleRemove = useCallback((index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleChange = useCallback((index: number, field: keyof FilterCondition, value: string) => {
    setConditions((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c
        const updated = { ...c, [field]: value }
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

  // --- Render ---

  const hasConditions = conditions.length > 0

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={640}
      testId="filter-dialog"
      ariaLabel="Filter Conditions"
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Filter Conditions</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onCancel}
            aria-label="Close"
            data-testid="filter-dialog-close"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {hasConditions ? (
            <>
              {/* Condition rows */}
              <div className={styles.rows} data-testid="filter-rows">
                {conditions.map((cond, idx) => {
                  const isNullary = NULLARY_OPERATORS.has(cond.operator)
                  return (
                    <div className={styles.row} key={idx} data-testid="filter-row">
                      {/* Column */}
                      <select
                        className={styles.columnSelect}
                        value={cond.column}
                        onChange={(e) => handleChange(idx, 'column', e.target.value)}
                        aria-label={`Column for condition ${idx + 1}`}
                        data-testid="filter-column-select"
                      >
                        {columns.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>

                      {/* Operator */}
                      <select
                        className={styles.operatorSelect}
                        value={cond.operator}
                        onChange={(e) => handleChange(idx, 'operator', e.target.value)}
                        aria-label={`Operator for condition ${idx + 1}`}
                        data-testid="filter-operator-select"
                      >
                        {OPERATORS.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>

                      {/* Value */}
                      <input
                        type="text"
                        className={`${styles.valueInput} ${isNullary ? styles.valueInputDisabled : ''}`}
                        value={cond.value}
                        onChange={(e) => handleChange(idx, 'value', e.target.value)}
                        disabled={isNullary}
                        placeholder={isNullary ? 'n/a' : ''}
                        aria-label={`Value for condition ${idx + 1}`}
                        data-testid="filter-value-input"
                      />

                      {/* Remove */}
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => handleRemove(idx)}
                        aria-label={`Remove condition ${idx + 1}`}
                        data-testid="filter-remove-button"
                      >
                        <X size={14} weight="bold" />
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Add button */}
              <button
                type="button"
                className={styles.addButton}
                onClick={handleAdd}
                data-testid="filter-add-button"
              >
                <Plus size={14} weight="bold" />
                <span>Add Condition</span>
              </button>
            </>
          ) : (
            /* Empty state */
            <div className={styles.emptyState} data-testid="filter-empty-state">
              <Funnel size={32} weight="thin" className={styles.emptyIcon} />
              <span className={styles.emptyTitle}>No filter conditions</span>
              <span className={styles.emptyHelp}>
                Add conditions to narrow table rows. All conditions are combined with AND.
              </span>
              <button
                type="button"
                className={styles.addButton}
                onClick={handleAdd}
                data-testid="filter-add-button"
              >
                <Plus size={14} weight="bold" />
                <span>Add Condition</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            {hasConditions && (
              <button
                type="button"
                className={styles.clearAllButton}
                onClick={handleClearAll}
                data-testid="filter-clear-all-button"
              >
                Clear All
              </button>
            )}
          </div>
          <div className={styles.footerRight}>
            <Button variant="secondary" onClick={onCancel} data-testid="filter-cancel-button">
              Cancel
            </Button>
            <Button variant="primary" onClick={handleApply} data-testid="filter-apply-button">
              Apply
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  )
}
