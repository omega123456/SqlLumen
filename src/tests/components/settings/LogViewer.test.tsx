import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogViewer } from '../../../components/settings/LogViewer'
import { ipc } from '../../ipc-mock'

function expectedTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(new Date(value))
    .replace(',', '')
}

describe('LogViewer', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('loads and renders log rows with formatted timestamps and tooltips', async () => {
    ipc.override('list_logs', () => ({
      entries: [
        {
          id: 1,
          timestamp: '2026-06-06T14:32:07.000Z',
          level: 'ERROR',
          target: 'sqllumen::tests',
          message: 'first line\nsecond line',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    }))

    render(<LogViewer />)

    expect(await screen.findByText('ERROR')).toBeInTheDocument()
    expect(screen.getByText(expectedTimestamp('2026-06-06T14:32:07.000Z'))).toBeInTheDocument()
    expect(screen.getByTestId('log-viewer-message-1')).toHaveAttribute(
      'title',
      'first line\nsecond line'
    )
    expect(ipc.calls('list_logs')[0]).toEqual({ page: 1, level: 'all' })
  })

  it('resets to page 1 when the filter changes', async () => {
    const user = userEvent.setup()

    ipc.override('list_logs', (args) => {
      const page = Number(args?.page ?? 1)
      const level = String(args?.level ?? 'all')
      return {
        entries: [
          {
            id: page,
            timestamp: '2026-06-06T12:00:00.000Z',
            level: level === 'warn' ? 'WARN' : 'INFO',
            target: 'sqllumen::tests',
            message: `row-${page}-${level}`,
          },
        ],
        total: 60,
        page,
        pageSize: 20,
      }
    })

    render(<LogViewer />)

    await screen.findByText('row-1-all')
    await user.click(screen.getAllByLabelText('Next page')[0])
    await screen.findByText('row-2-all')

    await user.click(screen.getByTestId('log-viewer-level-filter'))
    await user.click(screen.getByTestId('log-viewer-level-filter-option-warn'))

    await screen.findByText('row-1-warn')
    const calls = ipc.calls('list_logs') as Array<Record<string, unknown>>
    expect(calls[calls.length - 1]).toEqual({ page: 1, level: 'warn' })
    expect((screen.getAllByTestId('pagination-page-input')[0] as HTMLInputElement).value).toBe('1')
  })

  it('auto-refreshes every 5 seconds while enabled and stops when toggled off', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    ipc.override('list_logs', () => ({
      entries: [
        {
          id: 5,
          timestamp: '2026-06-06T12:00:00.000Z',
          level: 'INFO',
          target: 'sqllumen::tests',
          message: 'auto',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    }))

    render(<LogViewer />)

    await screen.findByText('auto')
    expect(ipc.calls('list_logs')).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    await waitFor(() => {
      expect(ipc.calls('list_logs')).toHaveLength(2)
    })

    await user.click(screen.getByLabelText('Auto-refresh'))
    expect(screen.getByTestId('log-viewer-auto-refresh-status')).toHaveTextContent(
      'Auto-refresh off'
    )

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(ipc.calls('list_logs')).toHaveLength(2)
  })

  it('renders an inline error state and logs failures', async () => {
    ipc.override('list_logs', () => {
      throw new Error('list failed')
    })

    render(<LogViewer />)

    expect(await screen.findByTestId('log-viewer-error')).toHaveTextContent('Failed to load logs.')

    await waitFor(() => {
      const logCall = (ipc.calls('log_frontend') as Array<Record<string, unknown>>).find(
        (call) =>
          call.level === 'error' &&
          typeof call.message === 'string' &&
          call.message.includes('[log-viewer] Failed to load logs: list failed')
      )
      expect(logCall).toBeTruthy()
    })
  })

  it('shows first and last pagination controls without a page-size dropdown', async () => {
    const user = userEvent.setup()

    ipc.override('list_logs', (args) => {
      const page = Number(args?.page ?? 1)
      return {
        entries: [
          {
            id: page,
            timestamp: '2026-06-06T12:00:00.000Z',
            level: 'DEBUG',
            target: 'sqllumen::tests',
            message: `page-${page}`,
          },
        ],
        total: 60,
        page,
        pageSize: 20,
      }
    })

    render(<LogViewer />)

    await screen.findByText('page-1')
    expect(screen.queryByTestId('page-size-select')).not.toBeInTheDocument()

    await user.click(screen.getAllByLabelText('Last page')[0])
    await screen.findByText('page-3')

    await user.click(screen.getAllByLabelText('First page')[0])
    await screen.findByText('page-1')
  })

  it('opens the integrated export dialog from the toolbar', async () => {
    const user = userEvent.setup()

    render(<LogViewer />)

    await screen.findByText('Primary log fixture entry')
    await user.click(screen.getByTestId('log-viewer-export'))

    expect(ipc.calls('export_logs')).toHaveLength(0)
    expect(screen.getByTestId('log-export-dialog')).toBeInTheDocument()
  })
})
