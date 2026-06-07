import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryScopePicker } from '../../../components/ai-panel/MemoryScopePicker'

describe('MemoryScopePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Connection, Group, and Global options', () => {
    render(<MemoryScopePicker hasGroup onSelect={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByTestId('memory-scope-option-connection')).toBeInTheDocument()
    expect(screen.getByTestId('memory-scope-option-group')).toBeInTheDocument()
    expect(screen.getByTestId('memory-scope-option-global')).toBeInTheDocument()
  })

  it('disables and greys the Group option with a "no group" caption when no group', () => {
    render(<MemoryScopePicker hasGroup={false} onSelect={vi.fn()} onCancel={vi.fn()} />)
    const group = screen.getByTestId('memory-scope-option-group')
    expect(group).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('memory-scope-no-group-caption')).toHaveTextContent('no group')
  })

  it('does not show the "no group" caption when a group is present', () => {
    render(<MemoryScopePicker hasGroup onSelect={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByTestId('memory-scope-no-group-caption')).not.toBeInTheDocument()
    expect(screen.getByTestId('memory-scope-option-group')).not.toHaveAttribute('aria-disabled')
  })

  it('emits the chosen scope on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MemoryScopePicker hasGroup onSelect={onSelect} onCancel={vi.fn()} />)

    await user.click(screen.getByTestId('memory-scope-option-global'))
    expect(onSelect).toHaveBeenCalledWith('global')
  })

  it('does not emit when clicking the disabled Group option', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MemoryScopePicker hasGroup={false} onSelect={onSelect} onCancel={vi.fn()} />)

    await user.click(screen.getByTestId('memory-scope-option-group'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('default-highlights the saved default scope when concrete', () => {
    render(
      <MemoryScopePicker hasGroup defaultScope="global" onSelect={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByTestId('memory-scope-option-global')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByTestId('memory-scope-option-connection')).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })

  it('falls back to highlighting Connection when no default scope is given', () => {
    render(<MemoryScopePicker hasGroup onSelect={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByTestId('memory-scope-option-connection')).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('selects the highlighted option on Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MemoryScopePicker hasGroup onSelect={onSelect} onCancel={vi.fn()} />)

    // Default highlight is Connection; ArrowDown -> Group, ArrowDown -> Global
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('connection')
  })

  it('skips the disabled Group option during keyboard navigation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MemoryScopePicker hasGroup={false} onSelect={onSelect} onCancel={vi.fn()} />)

    // Default highlight Connection -> ArrowDown should skip Group and land on Global
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('global')
  })

  it('cancels on Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<MemoryScopePicker hasGroup onSelect={vi.fn()} onCancel={onCancel} />)

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})
