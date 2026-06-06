import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LogExportDialog } from '../../../components/settings/LogExportDialog'
import { expectToast, ipc } from '../../ipc-mock'
import { _resetToastTimeoutsForTests, useToastStore } from '../../../stores/toast-store'

function setDateInput(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } })
}

async function pickDate(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  dayLabel: string
) {
  await user.click(screen.getByTestId(testId))
  const dialogs = await screen.findAllByRole('dialog', { name: 'Choose Date' })
  const dialog = dialogs[dialogs.length - 1]
  if (!dialog) {
    throw new Error('Date picker dialog not found')
  }
  await user.click(within(dialog).getByRole('gridcell', { name: dayLabel }))
}

describe('LogExportDialog', () => {
  beforeEach(() => {
    ipc.override('plugin:dialog|save', () => '/tmp/sql-lumen-logs.csv')
    ipc.override('export_logs', () => 42)
    useToastStore.setState({ toasts: [] })
    _resetToastTimeoutsForTests()
  })

  it('disables export and shows validation for incomplete or oversized ranges', async () => {
    render(<LogExportDialog isOpen={true} onClose={vi.fn()} />)

    const exportButton = screen.getByTestId('log-export-submit-button')
    expect(exportButton).toBeDisabled()
    expect(screen.getByTestId('log-export-validation')).toHaveTextContent(
      'Select both a start and end date.'
    )

    setDateInput('log-export-from-input', '2026-06-01')
    setDateInput('log-export-to-input', '2026-06-08')

    expect(exportButton).toBeDisabled()
    expect(screen.getByTestId('log-export-validation')).toHaveTextContent(
      'Select a date range of 7 days or fewer.'
    )

    setDateInput('log-export-to-input', '2026-06-07')

    expect(exportButton).toBeEnabled()
    expect(screen.getByTestId('log-export-validation')).toHaveTextContent('Up to 7 days inclusive.')
  })

  it('blocks dismissal and shows a spinner while export is in progress', async () => {
    let resolveExport: (value: number) => void = () => {
      throw new Error('export promise resolver was not assigned')
    }
    ipc.override(
      'export_logs',
      () =>
        new Promise<number>((resolve) => {
          resolveExport = resolve
        })
    )

    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<LogExportDialog isOpen={true} onClose={onClose} />)

    await pickDate(user, 'log-export-from-input', 'Choose Monday, June 1st, 2026')
    await pickDate(user, 'log-export-to-input', 'Choose Sunday, June 7th, 2026')

    await user.click(screen.getByTestId('log-export-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('log-export-submit-button')).toBeDisabled()
      expect(screen.getByTestId('log-export-cancel-button')).toBeDisabled()
      expect(screen.getByTestId('log-export-submit-button')).toHaveTextContent('Exporting...')
      expect(screen.getByTestId('log-export-dialog')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('log-export-dialog'))
    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()

    resolveExport(42)

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('exports logs with the selected dates, closes on success, and shows a toast', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<LogExportDialog isOpen={true} onClose={onClose} />)

    await pickDate(user, 'log-export-from-input', 'Choose Monday, June 1st, 2026')
    await pickDate(user, 'log-export-to-input', 'Choose Sunday, June 7th, 2026')

    await user.click(screen.getByTestId('log-export-submit-button'))

    await waitFor(() => {
      const calls = ipc.calls('export_logs')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        startTimestamp: '2026-06-01',
        endTimestamp: '2026-06-07',
        filePath: '/tmp/sql-lumen-logs.csv',
      })
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    await expectToast('success', 'Export completed')
  })

  it('stays open and idle when the save dialog is cancelled', async () => {
    ipc.override('plugin:dialog|save', () => null)

    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<LogExportDialog isOpen={true} onClose={onClose} />)

    await pickDate(user, 'log-export-from-input', 'Choose Monday, June 1st, 2026')
    await pickDate(user, 'log-export-to-input', 'Choose Sunday, June 7th, 2026')

    await user.click(screen.getByTestId('log-export-submit-button'))

    await waitFor(() => {
      expect(ipc.calls('plugin:dialog|save')).toHaveLength(1)
    })

    expect(ipc.calls('export_logs')).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('log-export-submit-button')).toBeEnabled()
    expect(screen.getByTestId('log-export-cancel-button')).toBeEnabled()
  })

  it('exports using local calendar dates so non-UTC users keep the selected inclusive days', async () => {
    const user = userEvent.setup()
    render(<LogExportDialog isOpen={true} onClose={vi.fn()} />)

    setDateInput('log-export-from-input', '2026-06-01')
    setDateInput('log-export-to-input', '2026-06-07')

    await user.click(screen.getByTestId('log-export-submit-button'))

    await waitFor(() => {
      expect(ipc.calls('export_logs')).toHaveLength(1)
    })

    const [call] = ipc.calls('export_logs') as Array<Record<string, string>>
    expect(call.startTimestamp).toBe('2026-06-01')
    expect(call.endTimestamp).toBe('2026-06-07')
  })
})
