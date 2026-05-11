import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterDialog } from '../../../components/dialogs/FilterDialog'

describe('FilterDialog', () => {
  it('renders initial filter conditions and applies changes', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(
      <FilterDialog
        isOpen={true}
        columns={['id', 'name']}
        initialConditions={[{ column: 'name', operator: 'LIKE', value: 'Ada' }]}
        onApply={onApply}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
    const input = screen.getByTestId('filter-value-input')
    await user.clear(input)
    await user.type(input, 'Grace')
    await user.click(screen.getByTestId('filter-apply-button'))
    expect(onApply).toHaveBeenCalledWith([expect.objectContaining({ value: 'Grace' })])
  })

  it('adds, removes, clears, and cancels conditions', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <FilterDialog
        isOpen={true}
        columns={['id']}
        initialConditions={[]}
        onApply={vi.fn()}
        onCancel={onCancel}
      />
    )
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
    await user.click(screen.getByTestId('filter-add-button'))
    expect(screen.getByTestId('filter-row')).toBeInTheDocument()
    await user.click(screen.getByTestId('filter-remove-button'))
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
    await user.click(screen.getByTestId('filter-add-button'))
    await user.click(screen.getByTestId('filter-clear-all-button'))
    expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
    await user.click(screen.getByTestId('filter-cancel-button'))
    expect(onCancel).toHaveBeenCalled()
  })
})
