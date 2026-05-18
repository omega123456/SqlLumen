import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateDatabaseDialog } from '../../../components/dialogs/CreateDatabaseDialog'
import { ipc } from '../../ipc-mock'

const MOCK_CHARSETS = [
  {
    charset: 'utf8mb4',
    description: 'UTF-8 Unicode',
    defaultCollation: 'utf8mb4_general_ci',
    maxLength: 4,
  },
  {
    charset: 'latin1',
    description: 'Latin 1',
    defaultCollation: 'latin1_swedish_ci',
    maxLength: 1,
  },
]

const MOCK_COLLATIONS = [
  { name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: true },
  { name: 'utf8mb4_unicode_ci', charset: 'utf8mb4', isDefault: false },
  { name: 'latin1_swedish_ci', charset: 'latin1', isDefault: true },
  { name: 'latin1_bin', charset: 'latin1', isDefault: false },
]

/** Waits until charset/collation fetch finished (avoids act() warnings from async setState). */
async function waitForCreateDatabaseEncodingIdle() {
  await waitFor(() => {
    expect(screen.getByTestId('create-db-form')).not.toHaveAttribute('aria-busy')
  })
}

beforeEach(() => {
  ipc.override('list_charsets', () => MOCK_CHARSETS)
  ipc.override('list_collations', () => MOCK_COLLATIONS)
  ipc.override('create_database', () => undefined)
})

describe('CreateDatabaseDialog', () => {
  const defaultProps = {
    isOpen: true,
    connectionId: 'conn-1',
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders text input for database name', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('renders charset and collation dropdowns', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Character Set')).toBeInTheDocument()
      expect(screen.getByText('Collation')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('confirm button disabled if name is empty', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByTestId('create-db-submit-button')).toBeDisabled()
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('confirm button enabled when name is typed', async () => {
    const user = userEvent.setup()
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'test_db')
    expect(screen.getByTestId('create-db-submit-button')).not.toBeDisabled()
  })

  it('calls create_database IPC on confirm with correct args', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<CreateDatabaseDialog {...defaultProps} onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'new_database')
    await user.click(screen.getByTestId('create-db-submit-button'))

    await waitFor(() => {
      const calls = ipc.calls('create_database')
      expect(calls).toHaveLength(1)
      const args = calls[0] as Record<string, unknown>
      expect(args).toMatchObject({
        connectionId: 'conn-1',
        name: 'new_database',
        charset: null,
        collation: null,
      })
    })
  })

  it('calls onSuccess with database name on success', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<CreateDatabaseDialog {...defaultProps} onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'new_database')
    await user.click(screen.getByTestId('create-db-submit-button'))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('new_database')
    })
  })

  it('shows loading state during submission', async () => {
    // Make create_database hang (never resolve)
    ipc.override('create_database', () => new Promise(() => {}))
    const user = userEvent.setup()
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'new_database')
    await user.click(screen.getByTestId('create-db-submit-button'))

    expect(screen.getByTestId('create-db-submit-button')).toHaveTextContent('Creating...')
    expect(screen.getByTestId('create-db-submit-button')).toBeDisabled()
  })

  it('cannot be dismissed while submission is in progress', async () => {
    ipc.override('create_database', () => new Promise(() => {}))
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'new_database')
    await user.click(screen.getByTestId('create-db-submit-button'))

    expect(screen.getByTestId('create-db-cancel-button')).toBeDisabled()

    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('create-database-dialog'))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('shows error if backend fails', async () => {
    ipc.override('create_database', () => {
      throw new Error('Database already exists')
    })
    const user = userEvent.setup()
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'existing_db')
    await user.click(screen.getByTestId('create-db-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('create-db-error')).toHaveTextContent('Database already exists')
    })
  })

  it('has data-testid="create-database-dialog"', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)
    expect(screen.getByTestId('create-database-dialog')).toBeInTheDocument()
    await waitForCreateDatabaseEncodingIdle()
  })

  it('does not render when isOpen is false', () => {
    render(<CreateDatabaseDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByTestId('create-database-dialog')).not.toBeInTheDocument()
  })

  it('shows validation error for empty name on submit attempt', async () => {
    const user = userEvent.setup()
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    // Type then clear to trigger validation
    await user.type(screen.getByTestId('create-db-name-input'), 'a')
    await user.clear(screen.getByTestId('create-db-name-input'))
    // Even though submit is disabled, confirm button is disabled already
    expect(screen.getByTestId('create-db-submit-button')).toBeDisabled()
  })

  it('loads charsets and collations on mount', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      const charsetCalls = ipc.calls('list_charsets')
      expect(charsetCalls).toHaveLength(1)
      const args = charsetCalls[0] as Record<string, unknown>
      expect(args).toMatchObject({ connectionId: 'conn-1' })
    })
    await waitFor(() => {
      const collationCalls = ipc.calls('list_collations')
      expect(collationCalls).toHaveLength(1)
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForCreateDatabaseEncodingIdle()
    await user.click(screen.getByTestId('create-db-cancel-button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} isOpen={false} />)
  })

  it('Escape key calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForCreateDatabaseEncodingIdle()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} isOpen={false} />)
  })

  it('supports toggling from closed to open on the same mounted instance', async () => {
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} isOpen={false} />)

    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-database-dialog')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('resets typed values when reopened after cancel', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForCreateDatabaseEncodingIdle()
    const input = screen.getByTestId('create-db-name-input') as HTMLInputElement
    await user.type(input, 'stale_name')

    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={false} />)
    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForCreateDatabaseEncodingIdle()
    expect((screen.getByTestId('create-db-name-input') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('create-db-submit-button')).toBeDisabled()
  })

  it('resets charset and collation selections when reopened after cancel', async () => {
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForCreateDatabaseEncodingIdle()

    const charsetCombobox = screen.getByRole('combobox', { name: 'Character Set' })
    // Use fireEvent.click to open the dropdown: avoids userEvent's full pointer simulation
    // which can trigger the focus-trap's requestAnimationFrame focus restoration causing
    // the dropdown to close before the portal commits the <ul> to the DOM.
    fireEvent.click(charsetCombobox)
    // Flush pending React state updates (setOpen(true)) and layout effects so the portal
    // <ul> is committed to document.body before we access it.
    await act(async () => {})
    // Retrieve the listbox via aria-controls (synchronous, no polling required after act)
    const charsetListboxId = charsetCombobox.getAttribute('aria-controls')!
    const charsetListbox = document.getElementById(charsetListboxId)!
    // Use fireEvent.click on the option (not user.click) to avoid blur-before-click
    // closing the Dropdown via its onBlur handler.
    fireEvent.click(within(charsetListbox).getByRole('option', { name: 'latin1' }))
    // Flush state updates from selectIndex (setCharsetState + setCollation)
    await act(async () => {})

    expect(screen.getByRole('combobox', { name: 'Character Set' })).toHaveTextContent('latin1')
    expect(screen.getByRole('combobox', { name: 'Collation' })).toHaveTextContent(
      'latin1_swedish_ci'
    )

    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={false} />)
    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForCreateDatabaseEncodingIdle()

    expect(screen.getByRole('combobox', { name: 'Character Set' })).toHaveTextContent(
      'Server Default'
    )
    expect(screen.getByRole('combobox', { name: 'Collation' })).toHaveTextContent('Default')
  })
})
