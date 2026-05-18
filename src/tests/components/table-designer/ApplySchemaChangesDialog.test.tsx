import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplySchemaChangesDialog } from '../../../components/table-designer/ApplySchemaChangesDialog'
import { useToastStore } from '../../../stores/toast-store'
import { expectToast, ipc } from '../../ipc-mock'

describe('ApplySchemaChangesDialog', () => {
  const defaultProps = {
    isOpen: true,
    ddl: 'ALTER TABLE `users` ADD COLUMN `nickname` VARCHAR(64);',
    warnings: [] as string[],
    connectionId: 'conn-1',
    database: 'app_db',
    schemaMode: 'alter' as const,
    tableLabel: 'app_db.users',
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('renders DDL code block content', () => {
    render(<ApplySchemaChangesDialog {...defaultProps} />)
    expect(screen.getByTestId('apply-schema-ddl')).toHaveTextContent('ALTER TABLE `users`')
  })

  it('shows rename warning section when warnings non-empty', () => {
    render(
      <ApplySchemaChangesDialog {...defaultProps} warnings={['Column rename may rebuild table']} />
    )
    expect(screen.getByTestId('apply-schema-warnings')).toBeInTheDocument()
    expect(screen.getByText('Column rename may rebuild table')).toBeInTheDocument()
  })

  it('warning section absent when warnings empty', () => {
    render(<ApplySchemaChangesDialog {...defaultProps} warnings={[]} />)
    expect(screen.queryByTestId('apply-schema-warnings')).not.toBeInTheDocument()
  })

  it('Cancel button calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ApplySchemaChangesDialog {...defaultProps} onCancel={onCancel} />)
    await user.click(screen.getByTestId('apply-schema-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Execute Changes button calls applyTableDdl and onSuccess on success', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<ApplySchemaChangesDialog {...defaultProps} onSuccess={onSuccess} />)

    await user.click(screen.getByTestId('apply-schema-confirm'))

    await waitFor(() => {
      expect(ipc.calls('apply_table_ddl')).toContainEqual({
        connectionId: 'conn-1',
        database: 'app_db',
        ddl: 'ALTER TABLE `users` ADD COLUMN `nickname` VARCHAR(64);',
      })
    })
    await expectToast('success', 'Table updated')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('shows Table created success toast when schemaMode is create', async () => {
    const user = userEvent.setup()
    render(
      <ApplySchemaChangesDialog
        {...defaultProps}
        schemaMode="create"
        tableLabel="app_db.audit_log"
        ddl="CREATE TABLE `audit_log` (`id` INT);"
      />
    )

    await user.click(screen.getByTestId('apply-schema-confirm'))
    await expectToast('success', 'Table created')
  })

  it('shows error message below code block on IPC failure', async () => {
    const user = userEvent.setup()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipc.override('apply_table_ddl', () => {
      throw new Error('DDL apply failed')
    })

    try {
      render(<ApplySchemaChangesDialog {...defaultProps} />)
      await user.click(screen.getByTestId('apply-schema-confirm'))

      await waitFor(() => {
        expect(screen.getByTestId('apply-schema-error')).toHaveTextContent('DDL apply failed')
      })
      await expectToast('error', 'Failed to apply schema changes')
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('Execute Changes button disabled while in-flight', async () => {
    const user = userEvent.setup()
    let resolvePromise: (() => void) | undefined
    ipc.override(
      'apply_table_ddl',
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve
        })
    )

    render(<ApplySchemaChangesDialog {...defaultProps} />)
    await user.click(screen.getByTestId('apply-schema-confirm'))

    expect(screen.getByTestId('apply-schema-confirm')).toBeDisabled()
    expect(screen.getByTestId('apply-schema-confirm')).toHaveTextContent('Executing...')
    resolvePromise?.()
    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled()
    })
  })

  it('backdrop click does not close dialog while executing', async () => {
    const user = userEvent.setup()
    let resolvePromise: (() => void) | undefined
    ipc.override(
      'apply_table_ddl',
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve
        })
    )

    const onCancel = vi.fn()
    render(<ApplySchemaChangesDialog {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByTestId('apply-schema-confirm'))
    await user.click(screen.getByTestId('apply-schema-dialog'))

    expect(onCancel).not.toHaveBeenCalled()

    resolvePromise?.()
    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled()
    })
  })

  it('Escape key does not close dialog while executing', async () => {
    const user = userEvent.setup()
    let resolvePromise: (() => void) | undefined
    ipc.override(
      'apply_table_ddl',
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve
        })
    )

    const onCancel = vi.fn()
    render(<ApplySchemaChangesDialog {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByTestId('apply-schema-confirm'))
    await user.keyboard('{Escape}')

    expect(onCancel).not.toHaveBeenCalled()

    resolvePromise?.()
    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled()
    })
  })
})
