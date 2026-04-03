import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Drop Table',
    message: (
      <>
        Are you sure you want to drop table <strong>users</strong>?
      </>
    ),
    confirmLabel: 'Drop Table',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders title and message', () => {
    render(<ConfirmDialog {...defaultProps} />)
    // Title appears in the h2 heading
    expect(screen.getByRole('heading', { name: /Drop Table/ })).toBeInTheDocument()
    expect(screen.getByText(/Are you sure you want to drop table/)).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
  })

  it('renders confirm button with custom label', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Delete Everything" />)
    expect(screen.getByTestId('confirm-confirm-button')).toHaveTextContent('Delete Everything')
  })

  it('cancel button calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByTestId('confirm-cancel-button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('confirm button calls onConfirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />)

    await user.click(screen.getByTestId('confirm-confirm-button'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Escape key calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />)

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('isDestructive confirm button has danger variant styling', () => {
    render(<ConfirmDialog {...defaultProps} isDestructive />)
    const btn = screen.getByTestId('confirm-confirm-button')
    expect(btn.className).toContain('ui-button-danger')
    expect(btn.className).not.toContain('ui-button-primary')
  })

  it('non-destructive confirm button has primary styling', () => {
    render(<ConfirmDialog {...defaultProps} isDestructive={false} />)
    const btn = screen.getByTestId('confirm-confirm-button')
    expect(btn.className).toContain('ui-button-primary')
  })

  it('isLoading disables confirm button and shows loading state', () => {
    render(<ConfirmDialog {...defaultProps} isLoading />)
    const btn = screen.getByTestId('confirm-confirm-button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Processing...')
  })

  it('renders "This action cannot be undone." warning', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    render(<ConfirmDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  it('has data-testid="confirm-dialog"', () => {
    render(<ConfirmDialog {...defaultProps} />)
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
  })

  it('backdrop click calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />)

    // Click the backdrop (the outer div with data-testid)
    const backdrop = screen.getByTestId('confirm-dialog')
    await user.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows error message when error prop is provided', () => {
    render(<ConfirmDialog {...defaultProps} error="Something went wrong" />)
    expect(screen.getByTestId('confirm-dialog-error')).toHaveTextContent('Something went wrong')
  })

  it('does not show error when error is null', () => {
    render(<ConfirmDialog {...defaultProps} error={null} />)
    expect(screen.queryByTestId('confirm-dialog-error')).not.toBeInTheDocument()
  })
})
