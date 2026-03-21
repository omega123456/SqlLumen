import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DialogShell } from '../../../components/dialogs/DialogShell'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DialogShell', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    testId: 'test-dialog',
    ariaLabel: 'Test dialog',
    children: <p>Dialog content</p>,
  }

  it('renders children when isOpen is true', () => {
    render(<DialogShell {...defaultProps} />)
    expect(screen.getByText('Dialog content')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    render(<DialogShell {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Dialog content')).not.toBeInTheDocument()
  })

  it('applies data-testid to backdrop', () => {
    render(<DialogShell {...defaultProps} />)
    expect(screen.getByTestId('test-dialog')).toBeInTheDocument()
  })

  it('applies data-testid to inner panel when testId is set', () => {
    render(<DialogShell {...defaultProps} />)
    expect(screen.getByTestId('test-dialog-panel')).toBeInTheDocument()
  })

  it('applies aria-label to the dialog', () => {
    render(<DialogShell {...defaultProps} />)
    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toBeInTheDocument()
  })

  it('has aria-modal="true"', () => {
    render(<DialogShell {...defaultProps} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('calls onClose when Escape key is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<DialogShell {...defaultProps} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<DialogShell {...defaultProps} onClose={onClose} />)

    const backdrop = screen.getByTestId('test-dialog')
    await user.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when dialog content is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<DialogShell {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByText('Dialog content'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('applies maxWidth style to dialog container', () => {
    render(<DialogShell {...defaultProps} maxWidth={600} />)
    // The dialog content wrapper should have maxWidth style
    const dialogContent = screen.getByText('Dialog content').parentElement
    expect(dialogContent).toHaveStyle({ maxWidth: '600px' })
  })

  it('uses default maxWidth of 420 when not specified', () => {
    render(<DialogShell {...defaultProps} />)
    const dialogContent = screen.getByText('Dialog content').parentElement
    expect(dialogContent).toHaveStyle({ maxWidth: '420px' })
  })

  it('renders as a portal (content is in document.body)', () => {
    render(<DialogShell {...defaultProps} />)
    const backdrop = screen.getByTestId('test-dialog')
    expect(backdrop.parentElement).toBe(document.body)
  })

  it('focuses first focusable element on open', async () => {
    render(
      <DialogShell {...defaultProps}>
        <input data-testid="first-input" type="text" />
        <button>OK</button>
      </DialogShell>
    )

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    expect(document.activeElement).toBe(screen.getByTestId('first-input'))
  })

  it('does not auto-focus when disableFocusManagement is true', async () => {
    render(
      <DialogShell {...defaultProps} disableFocusManagement>
        <input data-testid="first-input" type="text" />
        <button>OK</button>
      </DialogShell>
    )

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    expect(screen.getByTestId('first-input')).not.toHaveFocus()
  })

  it('removes escape listener when closed', () => {
    const onClose = vi.fn()
    const { rerender } = render(<DialogShell {...defaultProps} onClose={onClose} />)

    // Close the dialog
    rerender(<DialogShell {...defaultProps} isOpen={false} onClose={onClose} />)

    // Escape should not call onClose after dialog is closed
    const event = new KeyboardEvent('keydown', { key: 'Escape' })
    document.dispatchEvent(event)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders without testId when not provided', () => {
    render(
      <DialogShell isOpen={true} onClose={vi.fn()}>
        <p>No testId content</p>
      </DialogShell>
    )
    expect(screen.getByText('No testId content')).toBeInTheDocument()
  })
})
