import { render, screen, waitFor } from '@testing-library/react'
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

  it('pressing Enter in a value input applies the filters', async () => {
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

    const input = screen.getByTestId('filter-value-input')
    await waitFor(() => {
      expect(input).toHaveFocus()
    })

    await user.keyboard('{Enter}')

    expect(onApply).toHaveBeenCalledWith([{ column: 'name', operator: 'LIKE', value: 'Ada' }])
  })

  it('focuses the first value input when opened with conditions', async () => {
    render(
      <FilterDialog
        isOpen={true}
        columns={['id', 'name']}
        initialConditions={[{ column: 'name', operator: 'LIKE', value: 'Ada' }]}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('filter-value-input')).toHaveFocus()
    })
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

  it('focuses the new value input after adding a condition', async () => {
    const user = userEvent.setup()

    render(
      <FilterDialog
        isOpen={true}
        columns={['id']}
        initialConditions={[]}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('filter-add-button'))

    await waitFor(() => {
      expect(screen.getByTestId('filter-value-input')).toHaveFocus()
    })
  })

  it('does not reselect the value input while typing after the initial open focus', async () => {
    const user = userEvent.setup()

    render(
      <FilterDialog
        isOpen={true}
        columns={['id', 'name']}
        initialConditions={[{ column: 'name', operator: '==', value: 'Ada' }]}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const input = screen.getByTestId('filter-value-input')
    await waitFor(() => {
      expect(input).toHaveFocus()
    })

    await user.type(input, 'Grace')

    expect(input).toHaveValue('AdaGrace')
  })

  it('renders not-equals as a supported filter operator', () => {
    render(
      <FilterDialog
        isOpen={true}
        columns={['id']}
        initialConditions={[{ column: 'id', operator: '!=', value: '1' }]}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByTestId('filter-operator-select-0')).toHaveTextContent('!=')
  })
})
