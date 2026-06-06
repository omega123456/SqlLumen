import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SnapshotDialog } from '../../../components/dialogs/SnapshotDialog'
import { useSnapshotStore } from '../../../stores/snapshot-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { SnapshotSummary } from '../../../lib/session-snapshot-commands'

const SNAPSHOTS: SnapshotSummary[] = [
  {
    id: 2,
    createdAt: new Date(2026, 5, 5, 14, 32, 0).toISOString(),
    triggerType: 'manual',
    connectionCount: 3,
    tabCount: 7,
    connections: [
      { name: 'ProdDB', tabCount: 4 },
      { name: 'Staging', tabCount: 2 },
      { name: 'Analytics', tabCount: 1 },
    ],
  },
  {
    id: 1,
    createdAt: new Date(2026, 5, 4, 18, 11, 0).toISOString(),
    triggerType: 'onClose',
    connectionCount: 1,
    tabCount: 2,
    connections: [{ name: 'ProdDB', tabCount: 2 }],
  },
]

function setStore(overrides: Partial<ReturnType<typeof useSnapshotStore.getState>>) {
  act(() => {
    useSnapshotStore.setState({ ...overrides })
  })
}

let createManualSnapshot: () => Promise<void>
let restoreSnapshot: (id: number) => Promise<void>
let deleteSnapshot: (id: number) => Promise<void>

beforeEach(() => {
  createManualSnapshot = vi.fn(() => Promise.resolve())
  restoreSnapshot = vi.fn((_id: number) => Promise.resolve())
  deleteSnapshot = vi.fn((_id: number) => Promise.resolve())

  act(() => {
    useSnapshotStore.setState({
      snapshots: SNAPSHOTS,
      isDialogOpen: true,
      isLoading: false,
      selectedSnapshotId: null,
      isBusy: false,
      createManualSnapshot,
      restoreSnapshot,
      deleteSnapshot,
    })
    useConnectionStore.setState({})
  })
  vi.spyOn(useConnectionStore.getState(), 'connectionsWithUnsavedEdits').mockReturnValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SnapshotDialog', () => {
  it('renders snapshot rows with timestamp, trigger chip, counts and breakdown', () => {
    render(<SnapshotDialog />)

    const row = screen.getByTestId('snapshot-row-2')
    expect(within(row).getByText('Jun 5, 2026 · 14:32')).toBeInTheDocument()
    expect(within(row).getByText('Manual')).toBeInTheDocument()
    expect(within(row).getByText('3 connections · 7 tabs')).toBeInTheDocument()
    expect(within(row).getByText('ProdDB: 4 · Staging: 2 · Analytics: 1')).toBeInTheDocument()
  })

  it('disables Restore until a row is selected and enables it after selection', async () => {
    const user = userEvent.setup()
    render(<SnapshotDialog />)

    expect(screen.getByTestId('snapshot-restore-button')).toBeDisabled()

    await user.click(screen.getByTestId('snapshot-row-2'))

    expect(useSnapshotStore.getState().selectedSnapshotId).toBe(2)
  })

  it('runs the create confirmation flow', async () => {
    const user = userEvent.setup()
    render(<SnapshotDialog />)

    await user.click(screen.getByTestId('snapshot-create-button'))
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-confirm-button'))

    await waitFor(() => expect(createManualSnapshot).toHaveBeenCalledTimes(1))
  })

  it('runs the restore confirmation flow with the standard warning', async () => {
    const user = userEvent.setup()
    setStore({ selectedSnapshotId: 2 })
    render(<SnapshotDialog />)

    await user.click(screen.getByTestId('snapshot-restore-button'))

    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument()
    expect(
      screen.getByText('Your current session is saved as a snapshot first, then closed.')
    ).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => expect(restoreSnapshot).toHaveBeenCalledWith(2))
  })

  it('shows the unsaved-changes line when connections have unsaved edits', async () => {
    vi.spyOn(useConnectionStore.getState(), 'connectionsWithUnsavedEdits').mockReturnValue([
      'a',
      'b',
    ])
    const user = userEvent.setup()
    setStore({ selectedSnapshotId: 2 })
    render(<SnapshotDialog />)

    await user.click(screen.getByTestId('snapshot-restore-button'))

    expect(
      await screen.findByText('2 connections have unsaved changes that will be lost.')
    ).toBeInTheDocument()
  })

  it('omits the unsaved-changes line when there are no unsaved edits', async () => {
    const user = userEvent.setup()
    setStore({ selectedSnapshotId: 2 })
    render(<SnapshotDialog />)

    await user.click(screen.getByTestId('snapshot-restore-button'))

    await screen.findByTestId('confirm-dialog')
    expect(screen.queryByText(/unsaved changes that will be lost/)).not.toBeInTheDocument()
  })

  it('runs the delete confirmation flow from a row', async () => {
    const user = userEvent.setup()
    render(<SnapshotDialog />)

    await user.click(screen.getByTestId('snapshot-delete-2'))
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => expect(deleteSnapshot).toHaveBeenCalledWith(2))
  })

  it('renders the empty state when there are no snapshots', () => {
    setStore({ snapshots: [] })
    render(<SnapshotDialog />)

    expect(screen.getByText('No snapshots yet.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /create your first snapshot/i })
    ).toBeInTheDocument()
  })

  it('moves selection with arrow keys', async () => {
    render(<SnapshotDialog />)

    const listbox = screen.getByRole('listbox', { name: 'Session snapshots' })

    listbox.focus()
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    await waitFor(() => expect(useSnapshotStore.getState().selectedSnapshotId).toBe(2))

    listbox.focus()
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    await waitFor(() => expect(useSnapshotStore.getState().selectedSnapshotId).toBe(1))

    listbox.focus()
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    await waitFor(() => expect(useSnapshotStore.getState().selectedSnapshotId).toBe(2))
  })

  it('gives each per-row delete button a row-specific aria-label', () => {
    render(<SnapshotDialog />)

    expect(
      screen.getByRole('button', { name: 'Delete snapshot from Jun 5, 2026 · 14:32' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete snapshot from Jun 4, 2026 · 18:11' })
    ).toBeInTheDocument()
  })
})
