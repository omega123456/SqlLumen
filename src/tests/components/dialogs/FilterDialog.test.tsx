import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterDialog } from '../../../components/dialogs/FilterDialog'
import type { FilterCondition } from '../../../types/schema'

beforeEach(() => {
  vi.clearAllMocks()
})

const defaultColumns = ['id', 'name', 'email']

const defaultProps = {
  isOpen: true,
  onApply: vi.fn(),
  onCancel: vi.fn(),
  initialConditions: [] as FilterCondition[],
  columns: defaultColumns,
}

describe('FilterDialog', () => {
  it('renders empty state with muted Funnel icon and help text', () => {
    render(<FilterDialog {...defaultProps} />)
    const emptyState = screen.getByTestId('filter-empty-state')
    expect(emptyState).toBeInTheDocument()
    expect(screen.getByText('No filter conditions')).toBeInTheDocument()
    expect(
      screen.getByText('Add conditions to narrow table rows. All conditions are combined with AND.')
    ).toBeInTheDocument()
  })

  it('Add Condition button adds a row with defaults (first column, ==, empty value)', async () => {
    const user = userEvent.setup()
    render(<FilterDialog {...defaultProps} />)

    await user.click(screen.getByTestId('filter-add-button'))

    const rows = screen.getAllByTestId('filter-row')
    expect(rows).toHaveLength(1)

    const row = rows[0]
    const colSelect = within(row).getByTestId('filter-column-select') as HTMLSelectElement
    const opSelect = within(row).getByTestId('filter-operator-select') as HTMLSelectElement
    const valueInput = within(row).getByTestId('filter-value-input') as HTMLInputElement

    expect(colSelect.value).toBe('id')
    expect(opSelect.value).toBe('==')
    expect(valueInput.value).toBe('')
  })

  it('Remove button removes the row', async () => {
    const user = userEvent.setup()
    render(
      <FilterDialog
        {...defaultProps}
        initialConditions={[
          { column: 'id', operator: '==', value: '1' },
          { column: 'name', operator: 'LIKE', value: 'test' },
        ]}
      />
    )

    expect(screen.getAllByTestId('filter-row')).toHaveLength(2)

    const removeButtons = screen.getAllByTestId('filter-remove-button')
    await user.click(removeButtons[0])

    const rows = screen.getAllByTestId('filter-row')
    expect(rows).toHaveLength(1)
    // The remaining row should be the second one
    const colSelect = within(rows[0]).getByTestId('filter-column-select') as HTMLSelectElement
    expect(colSelect.value).toBe('name')
  })

  it('Clear All button clears all rows', async () => {
    const user = userEvent.setup()
    render(
      <FilterDialog
        {...defaultProps}
        initialConditions={[
          { column: 'id', operator: '==', value: '1' },
          { column: 'name', operator: 'LIKE', value: 'test' },
        ]}
      />
    )

    expect(screen.getAllByTestId('filter-row')).toHaveLength(2)

    await user.click(screen.getByTestId('filter-clear-all-button'))

    expect(screen.queryAllByTestId('filter-row')).toHaveLength(0)
    // Should now show empty state
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
  })

  it('IS NULL operator disables the value input', async () => {
    const user = userEvent.setup()
    render(
      <FilterDialog
        {...defaultProps}
        initialConditions={[{ column: 'id', operator: '==', value: 'test' }]}
      />
    )

    const opSelect = screen.getByTestId('filter-operator-select') as HTMLSelectElement
    await user.selectOptions(opSelect, 'IS NULL')

    const valueInput = screen.getByTestId('filter-value-input') as HTMLInputElement
    expect(valueInput).toBeDisabled()
    expect(valueInput.value).toBe('')
    expect(valueInput.placeholder).toBe('n/a')
  })

  it('IS NOT NULL operator disables the value input', async () => {
    const user = userEvent.setup()
    render(
      <FilterDialog
        {...defaultProps}
        initialConditions={[{ column: 'id', operator: '==', value: 'test' }]}
      />
    )

    const opSelect = screen.getByTestId('filter-operator-select') as HTMLSelectElement
    await user.selectOptions(opSelect, 'IS NOT NULL')

    const valueInput = screen.getByTestId('filter-value-input') as HTMLInputElement
    expect(valueInput).toBeDisabled()
    expect(valueInput.placeholder).toBe('n/a')
  })

  it('Cancel calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<FilterDialog {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByTestId('filter-cancel-button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Apply calls onApply with the current conditions', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <FilterDialog
        {...defaultProps}
        onApply={onApply}
        initialConditions={[{ column: 'id', operator: '==', value: '42' }]}
      />
    )

    await user.click(screen.getByTestId('filter-apply-button'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith([{ column: 'id', operator: '==', value: '42' }])
  })

  it('reopening shows previously passed initialConditions', () => {
    const conditions: FilterCondition[] = [{ column: 'name', operator: 'LIKE', value: '%test%' }]

    const { rerender } = render(
      <FilterDialog {...defaultProps} isOpen={false} initialConditions={conditions} />
    )

    // Dialog is closed — nothing rendered
    expect(screen.queryByTestId('filter-dialog')).not.toBeInTheDocument()

    // Reopen with the same conditions
    rerender(<FilterDialog {...defaultProps} isOpen={true} initialConditions={conditions} />)

    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    const rows = screen.getAllByTestId('filter-row')
    expect(rows).toHaveLength(1)
    const colSelect = within(rows[0]).getByTestId('filter-column-select') as HTMLSelectElement
    const opSelect = within(rows[0]).getByTestId('filter-operator-select') as HTMLSelectElement
    const valueInput = within(rows[0]).getByTestId('filter-value-input') as HTMLInputElement
    expect(colSelect.value).toBe('name')
    expect(opSelect.value).toBe('LIKE')
    expect(valueInput.value).toBe('%test%')
  })

  it('column dropdown is populated from columns prop', async () => {
    const user = userEvent.setup()
    render(<FilterDialog {...defaultProps} />)

    // Add a condition to get a row
    await user.click(screen.getByTestId('filter-add-button'))

    const colSelect = screen.getByTestId('filter-column-select') as HTMLSelectElement
    const options = Array.from(colSelect.options).map((o) => o.value)
    expect(options).toEqual(['id', 'name', 'email'])
  })

  it('renders empty state when columns is empty', () => {
    render(<FilterDialog {...defaultProps} columns={[]} />)
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    render(<FilterDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByTestId('filter-dialog')).not.toBeInTheDocument()
  })

  it('editing conditions does not affect parent until Apply', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const initialConditions: FilterCondition[] = [{ column: 'id', operator: '==', value: '1' }]
    render(
      <FilterDialog {...defaultProps} onApply={onApply} initialConditions={initialConditions} />
    )

    // Modify the value
    const valueInput = screen.getByTestId('filter-value-input') as HTMLInputElement
    await user.clear(valueInput)
    await user.type(valueInput, '999')

    // Original conditions should be unmodified
    expect(initialConditions[0].value).toBe('1')

    // Now apply
    await user.click(screen.getByTestId('filter-apply-button'))
    expect(onApply).toHaveBeenCalledWith([{ column: 'id', operator: '==', value: '999' }])
  })

  it('Clear All is not shown when there are no conditions', () => {
    render(<FilterDialog {...defaultProps} />)
    expect(screen.queryByTestId('filter-clear-all-button')).not.toBeInTheDocument()
  })

  it('backdrop click calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<FilterDialog {...defaultProps} onCancel={onCancel} />)

    const backdrop = screen.getByTestId('filter-dialog')
    await user.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape key calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<FilterDialog {...defaultProps} onCancel={onCancel} />)

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
