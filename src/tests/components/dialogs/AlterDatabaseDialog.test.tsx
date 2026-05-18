import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlterDatabaseDialog } from '../../../components/dialogs/AlterDatabaseDialog'
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
]

/** Waits until details + encoding fetches finish (avoids act() warnings from async setState). */
async function waitForAlterDatabaseDialogIdle() {
  await waitFor(() => {
    expect(screen.queryByText('Loading database details...')).not.toBeInTheDocument()
  })
}

beforeEach(() => {
  ipc.override('get_database_details', () => ({
    name: 'test_db',
    defaultCharacterSet: 'utf8mb4',
    defaultCollation: 'utf8mb4_general_ci',
  }))
  ipc.override('list_charsets', () => MOCK_CHARSETS)
  ipc.override('list_collations', () => MOCK_COLLATIONS)
  ipc.override('alter_database', () => undefined)
})

describe('AlterDatabaseDialog', () => {
  const defaultProps = {
    isOpen: true,
    connectionId: 'conn-1',
    databaseName: 'test_db',
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  }

  it('fetches current database details on open', async () => {
    render(<AlterDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      const calls = ipc.calls('get_database_details')
      expect(calls).toHaveLength(1)
      const args = calls[0] as Record<string, unknown>
      expect(args).toMatchObject({ connectionId: 'conn-1', database: 'test_db' })
    })
    await waitForAlterDatabaseDialogIdle()
  })

  it('pre-fills charset and collation from current values', async () => {
    render(<AlterDatabaseDialog {...defaultProps} />)

    // After loading, the charset dropdown should show utf8mb4
    await waitFor(() => {
      expect(screen.getByText('utf8mb4')).toBeInTheDocument()
    })

    // Collation dropdown should show utf8mb4_general_ci
    expect(screen.getByText('utf8mb4_general_ci')).toBeInTheDocument()
    await waitForAlterDatabaseDialogIdle()
  })

  it('shows loading state while fetching details', () => {
    // Hang all async sources so loading stays true and no late setState after the test ends
    const pending = new Promise<never>(() => {})
    ipc.override('get_database_details', () => pending)
    ipc.override('list_charsets', () => pending)
    ipc.override('list_collations', () => pending)
    render(<AlterDatabaseDialog {...defaultProps} />)

    expect(screen.getByText('Loading database details...')).toBeInTheDocument()
  })

  it('calls alter_database IPC on confirm', async () => {
    const user = userEvent.setup()
    render(<AlterDatabaseDialog {...defaultProps} />)

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading database details...')).not.toBeInTheDocument()
    })

    await user.click(screen.getByTestId('alter-db-submit-button'))

    await waitFor(() => {
      const calls = ipc.calls('alter_database')
      expect(calls).toHaveLength(1)
      const args = calls[0] as Record<string, unknown>
      expect(args).toMatchObject({
        connectionId: 'conn-1',
        name: 'test_db',
        charset: 'utf8mb4',
        collation: 'utf8mb4_general_ci',
      })
    })
  })

  it('calls onSuccess after successful alter', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<AlterDatabaseDialog {...defaultProps} onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(screen.queryByText('Loading database details...')).not.toBeInTheDocument()
    })

    await user.click(screen.getByTestId('alter-db-submit-button'))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('shows error if backend fails', async () => {
    ipc.override('alter_database', () => {
      throw new Error('Permission denied')
    })
    const user = userEvent.setup()
    render(<AlterDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.queryByText('Loading database details...')).not.toBeInTheDocument()
    })

    await user.click(screen.getByTestId('alter-db-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('alter-db-error')).toHaveTextContent('Permission denied')
    })

    expect(screen.getByTestId('alter-db-submit-button')).toBeEnabled()
  })

  it('cannot be dismissed while submission is in progress', async () => {
    ipc.override('alter_database', () => new Promise(() => {}))
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForAlterDatabaseDialogIdle()
    await user.click(screen.getByTestId('alter-db-submit-button'))

    expect(screen.getByTestId('alter-db-cancel-button')).toBeDisabled()

    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('alter-database-dialog'))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('has data-testid="alter-database-dialog"', async () => {
    render(<AlterDatabaseDialog {...defaultProps} />)
    expect(screen.getByTestId('alter-database-dialog')).toBeInTheDocument()
    await waitForAlterDatabaseDialogIdle()
  })

  it('does not render when isOpen is false', () => {
    render(<AlterDatabaseDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByTestId('alter-database-dialog')).not.toBeInTheDocument()
  })

  it('displays the database name as subtitle', async () => {
    render(<AlterDatabaseDialog {...defaultProps} />)
    expect(screen.getByText('test_db')).toBeInTheDocument()
    await waitForAlterDatabaseDialogIdle()
  })

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForAlterDatabaseDialogIdle()
    await user.click(screen.getByTestId('alter-db-cancel-button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} isOpen={false} />)
  })

  it('Escape key calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForAlterDatabaseDialogIdle()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} isOpen={false} />)
  })

  it('shows error when fetching database details fails', async () => {
    ipc.override('get_database_details', () => {
      throw new Error('Connection lost')
    })
    render(<AlterDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('alter-db-error')).toHaveTextContent('Connection lost')
    })
    await waitForAlterDatabaseDialogIdle()
  })

  it('supports toggling from closed to open on the same mounted instance', async () => {
    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} isOpen={false} />)

    rerender(<AlterDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('alter-database-dialog')).toBeInTheDocument()
    })
    await waitForAlterDatabaseDialogIdle()
  })

  it('restores fetched database values when reopened after closing with unsaved changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForAlterDatabaseDialogIdle()
    await user.click(screen.getByRole('combobox', { name: 'Character Set' }))
    // Use findByRole (async) to wait for the Dropdown portal option to appear in DOM
    await user.click(await screen.findByRole('option', { name: /^latin1$/ }))

    expect(screen.getByText('latin1')).toBeInTheDocument()

    rerender(<AlterDatabaseDialog {...defaultProps} isOpen={false} />)
    rerender(<AlterDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForAlterDatabaseDialogIdle()
    expect(screen.getByText('utf8mb4')).toBeInTheDocument()
    expect(screen.getByText('utf8mb4_general_ci')).toBeInTheDocument()
  })

  it('clears stale submit errors when switching databases while open', async () => {
    const user = userEvent.setup()

    // Track how many times get_database_details is called to return different responses
    let callCount = 0
    ipc.override('get_database_details', () => {
      callCount++
      if (callCount === 1) {
        return { name: 'test_db', defaultCharacterSet: 'utf8mb4', defaultCollation: 'utf8mb4_general_ci' }
      }
      return { name: 'other_db', defaultCharacterSet: 'latin1', defaultCollation: 'latin1_swedish_ci' }
    })
    ipc.override('alter_database', () => {
      throw new Error('Permission denied')
    })

    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForAlterDatabaseDialogIdle()
    await user.click(screen.getByTestId('alter-db-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('alter-db-error')).toHaveTextContent('Permission denied')
    })

    rerender(<AlterDatabaseDialog {...defaultProps} databaseName="other_db" isOpen={true} />)

    await waitFor(() => {
      expect(screen.queryByTestId('alter-db-error')).not.toBeInTheDocument()
      expect(screen.getByText('latin1')).toBeInTheDocument()
      expect(screen.getByText('latin1_swedish_ci')).toBeInTheDocument()
    })
  })
})
