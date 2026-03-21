import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RenameDialog } from '../../../components/dialogs/RenameDialog'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RenameDialog', () => {
  const defaultProps = {
    isOpen: true,
    title: 'Rename Table',
    currentName: 'users',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders current name', () => {
    render(<RenameDialog {...defaultProps} />)
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('Current name:')).toBeInTheDocument()
  })

  it('renders warning message if warning prop provided', () => {
    render(<RenameDialog {...defaultProps} warning="This is dangerous" />)
    expect(screen.getByTestId('rename-dialog-warning')).toHaveTextContent('This is dangerous')
  })

  it('does not render warning when no warning prop', () => {
    render(<RenameDialog {...defaultProps} />)
    expect(screen.queryByTestId('rename-dialog-warning')).not.toBeInTheDocument()
  })

  it('input pre-filled with current name', () => {
    render(<RenameDialog {...defaultProps} />)
    const input = screen.getByTestId('rename-name-input') as HTMLInputElement
    expect(input.value).toBe('users')
  })

  it('confirm button disabled if name is same as current', () => {
    render(<RenameDialog {...defaultProps} />)
    expect(screen.getByTestId('rename-confirm-button')).toBeDisabled()
  })

  it('confirm button disabled if name is empty', async () => {
    const user = userEvent.setup()
    render(<RenameDialog {...defaultProps} />)

    const input = screen.getByTestId('rename-name-input')
    await user.clear(input)
    expect(screen.getByTestId('rename-confirm-button')).toBeDisabled()
  })

  it('confirm button enabled when name changes', async () => {
    const user = userEvent.setup()
    render(<RenameDialog {...defaultProps} />)

    const input = screen.getByTestId('rename-name-input')
    await user.clear(input)
    await user.type(input, 'users_v2')
    expect(screen.getByTestId('rename-confirm-button')).not.toBeDisabled()
  })

  it('calls onConfirm with new name on submit', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />)

    const input = screen.getByTestId('rename-name-input')
    await user.clear(input)
    await user.type(input, 'new_users')
    await user.click(screen.getByTestId('rename-confirm-button'))

    expect(onConfirm).toHaveBeenCalledWith('new_users')
  })

  it('calls onCancel on cancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<RenameDialog {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByTestId('rename-cancel-button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape key calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<RenameDialog {...defaultProps} onCancel={onCancel} />)

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('has data-testid="rename-dialog"', () => {
    render(<RenameDialog {...defaultProps} />)
    expect(screen.getByTestId('rename-dialog')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    render(<RenameDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByTestId('rename-dialog')).not.toBeInTheDocument()
  })

  it('shows loading state when isLoading', () => {
    render(<RenameDialog {...defaultProps} isLoading />)
    expect(screen.getByTestId('rename-confirm-button')).toHaveTextContent('Renaming...')
  })

  it('shows error message when error prop is provided', () => {
    render(<RenameDialog {...defaultProps} error="Name already taken" />)
    expect(screen.getByTestId('rename-dialog-error')).toHaveTextContent('Name already taken')
  })

  it('does not show error when error is null', () => {
    render(<RenameDialog {...defaultProps} error={null} />)
    expect(screen.queryByTestId('rename-dialog-error')).not.toBeInTheDocument()
  })

  it('renders the title', () => {
    render(<RenameDialog {...defaultProps} title="Rename Database" />)
    expect(screen.getByText('Rename Database')).toBeInTheDocument()
  })

  it('Enter key submits when name is different', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />)

    const input = screen.getByTestId('rename-name-input')
    await user.clear(input)
    await user.type(input, 'renamed_table{Enter}')

    expect(onConfirm).toHaveBeenCalledWith('renamed_table')
  })

  it('Enter key does not submit when name is same as current', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<RenameDialog {...defaultProps} onConfirm={onConfirm} />)

    const input = screen.getByTestId('rename-name-input')
    await user.type(input, '{Enter}')

    expect(onConfirm).not.toHaveBeenCalled()
  })
})
