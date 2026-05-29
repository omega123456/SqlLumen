import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import CopyToHostDialog from '../../../components/dialogs/CopyToHostDialog'
import { useConnectionStore } from '../../../stores/connection-store'
import type { ActiveConnection, SavedConnection } from '../../../types/connection'
import type { CopyableObjects, CopyProgress } from '../../../lib/copy-to-host-commands'
import { expectToast, ipc } from '../../ipc-mock'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 'conn-1',
    name: 'Test DB',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    hasPassword: true,
    defaultDatabase: null,
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: '#3b82f6',
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 30,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeActiveConnection(overrides: Partial<ActiveConnection> = {}): ActiveConnection {
  return {
    id: 'session-source',
    profile: makeSavedConnection({ id: 'source-profile', host: 'source-host' }),
    status: 'connected',
    serverVersion: '8.0.35',
    ...overrides,
  }
}

const MOCK_OBJECTS: CopyableObjects = {
  tables: [
    { name: 'users', estimatedRows: 100 },
    { name: 'orders', estimatedRows: 500 },
  ],
  procedures: ['sp_recalc'],
  functions: ['fn_total'],
  triggers: ['trg_audit'],
  events: [],
}

const MOCK_PROGRESS_COMPLETED: CopyProgress = {
  jobId: 'copy-job-1',
  status: 'completed',
  objectsTotal: 3,
  objectsDone: 3,
  currentObject: null,
  currentObjectType: null,
  rowsTotal: null,
  rowsDone: null,
  errorMessage: null,
  cancelRequested: false,
}

const MOCK_PROGRESS_RUNNING: CopyProgress = {
  jobId: 'copy-job-1',
  status: 'running',
  objectsTotal: 3,
  objectsDone: 1,
  currentObject: 'orders',
  currentObjectType: 'table',
  rowsTotal: 500,
  rowsDone: 250,
  errorMessage: null,
  cancelRequested: false,
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  sourceConnectionId: 'session-source',
  sourceConnectionLabel: 'Source DB',
  sourceDatabase: 'shop',
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  act(() => {
    useConnectionStore.setState({
      savedConnections: [
        makeSavedConnection({ id: 'source-profile', name: 'Source DB', host: 'source-host' }),
        makeSavedConnection({ id: 'target-profile', name: 'Target DB', host: 'target-host' }),
        makeSavedConnection({
          id: 'readonly-profile',
          name: 'Readonly DB',
          host: 'readonly-host',
          readOnly: true,
        }),
      ],
      activeConnections: {
        'session-source': makeActiveConnection(),
        'session-target': makeActiveConnection({
          id: 'session-target',
          profile: makeSavedConnection({ id: 'target-profile', name: 'Target DB', host: 'target-host' }),
        }),
      },
      activeTabId: 'session-source',
    })
  })

  ipc.override('list_copyable_objects', () => MOCK_OBJECTS)
  ipc.override('list_databases', () => ['target_existing', 'target_other'])
  ipc.override('start_copy_to_host', () => 'copy-job-1')
  ipc.override('get_copy_progress', () => MOCK_PROGRESS_COMPLETED)
  ipc.override('cancel_copy', () => null)
})

async function waitForLoaded() {
  await screen.findByTestId('copy-object-tree')
}

async function selectFromDropdown(_user: UserEvent, triggerTestId: string, optionValue: string) {
  const trigger = screen.getByTestId(triggerTestId)
  const optionTestId = `${triggerTestId}-option-${optionValue}`
  // The shared Dropdown focuses its listbox on open and closes on blur. Under suite
  // load jsdom can spuriously bounce focus during an await, closing the panel. Drive
  // open + select synchronously inside a single waitFor tick so no async boundary lets
  // the panel blur, while still retrying until async-loaded options appear.
  await waitFor(() => {
    if (trigger.getAttribute('aria-expanded') !== 'true') {
      fireEvent.click(trigger)
    }
    fireEvent.click(screen.getByTestId(optionTestId))
  })
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
}

async function chooseTarget(user: UserEvent, connectionValue: string, databaseValue: string) {
  await selectFromDropdown(user, 'copy-target-connection', connectionValue)
  await selectFromDropdown(user, 'copy-target-database', databaseValue)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CopyToHostDialog', () => {
  it('renders source fields as read-only', async () => {
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    const conn = screen.getByTestId('copy-source-connection') as HTMLInputElement
    const db = screen.getByTestId('copy-source-database') as HTMLInputElement
    expect(conn.value).toBe('Source DB')
    expect(conn).toBeDisabled()
    expect(db.value).toBe('shop')
    expect(db).toBeDisabled()
  })

  it('renders the four sections', async () => {
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()
    expect(screen.getByTestId('copy-source-section')).toBeInTheDocument()
    expect(screen.getByTestId('copy-target-section')).toBeInTheDocument()
    expect(screen.getByTestId('copy-objects-section')).toBeInTheDocument()
    expect(screen.getByTestId('copy-options-section')).toBeInTheDocument()
  })

  it('defaults the target database to the source database when present on the target', async () => {
    const user = userEvent.setup()
    ipc.override('list_databases', () => ['target_existing', 'shop', 'target_other'])
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await selectFromDropdown(user, 'copy-target-connection', 'target-profile')

    await waitFor(() =>
      expect(screen.getByTestId('copy-target-database')).toHaveTextContent('shop')
    )
  })

  it('leaves the target database unset when the source name is absent on the target', async () => {
    const user = userEvent.setup()
    ipc.override('list_databases', () => ['target_existing', 'target_other'])
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await selectFromDropdown(user, 'copy-target-connection', 'target-profile')

    await waitFor(() =>
      expect(screen.getByTestId('copy-target-database')).toHaveTextContent('Select a database…')
    )
  })

  it('excludes the source host and read-only connections from the target dropdown', async () => {
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    fireEvent.click(screen.getByTestId('copy-target-connection'))
    // Options render synchronously when the dropdown opens; read them without an
    // intervening await so a spurious focus-blur cannot close the panel mid-assertion.
    expect(screen.getByTestId('copy-target-connection-option-target-profile')).toBeInTheDocument()
    // Source host and read-only host are excluded
    expect(
      screen.queryByTestId('copy-target-connection-option-source-profile')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('copy-target-connection-option-readonly-profile')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('copy-target-connection'))
    await waitFor(() =>
      expect(screen.queryByTestId('copy-target-connection-option-target-profile')).toBeNull()
    )
  })

  it('loads the target databases when a target connection is chosen', async () => {
    const user = userEvent.setup()
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await selectFromDropdown(user, 'copy-target-connection', 'target-profile')
    expect(ipc.calls('list_databases')).toEqual([{ connectionId: 'session-target' }])

    const dbTrigger = screen.getByTestId('copy-target-database')
    await waitFor(() => {
      if (dbTrigger.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(dbTrigger)
      }
      expect(screen.getByTestId('copy-target-database-option-target_existing')).toBeInTheDocument()
    })
  })

  it('does not call list_databases with a saved profile id when target is not open', async () => {
    const user = userEvent.setup()
    act(() => {
      useConnectionStore.setState({
        activeConnections: { 'session-source': makeActiveConnection() },
      })
    })

    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await selectFromDropdown(user, 'copy-target-connection', 'target-profile')

    expect(ipc.calls('list_databases')).toEqual([])
    expect(screen.getByTestId('copy-target-database-notice')).toHaveTextContent(
      'Open this target connection first'
    )
    fireEvent.click(screen.getByTestId('copy-target-database'))
    expect(screen.getByTestId('copy-target-database-option-__new__')).toBeInTheDocument()
  })

  it('normalizes source-host filtering with trim and lowercase', async () => {
    act(() => {
      useConnectionStore.setState({
        savedConnections: [
          makeSavedConnection({ id: 'source-profile', name: 'Source DB', host: 'source-host' }),
          makeSavedConnection({ id: 'same-profile', name: 'Same DB', host: ' SOURCE-HOST ' }),
          makeSavedConnection({ id: 'target-profile', name: 'Target DB', host: 'target-host' }),
        ],
        activeConnections: {
          'session-source': makeActiveConnection({
            profile: makeSavedConnection({ id: 'source-profile', host: ' source-host ' }),
          }),
        },
      })
    })

    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    fireEvent.click(screen.getByTestId('copy-target-connection'))
    expect(screen.queryByTestId('copy-target-connection-option-same-profile')).not.toBeInTheDocument()
    expect(screen.getByTestId('copy-target-connection-option-target-profile')).toBeInTheDocument()
  })

  it('shows an error toast when target databases fail to load', async () => {
    const user = userEvent.setup()
    ipc.override('list_databases', () => {
      throw new Error('Target unavailable')
    })

    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await selectFromDropdown(user, 'copy-target-connection', 'target-profile')

    await expectToast('error', 'Failed to load target databases')
    fireEvent.click(screen.getByTestId('copy-target-database'))
    expect(screen.getByTestId('copy-target-database-option-__new__')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-target-database-option-target_existing')).not.toBeInTheDocument()
  })

  it('reveals a new-database name input when the sentinel is chosen and hides it otherwise', async () => {
    const user = userEvent.setup()
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await selectFromDropdown(user, 'copy-target-connection', 'target-profile')
    await waitFor(() =>
      expect(screen.getByTestId('copy-target-database')).not.toBeDisabled()
    )

    await selectFromDropdown(user, 'copy-target-database', '__new__')
    expect(await screen.findByTestId('copy-new-database-name')).toBeInTheDocument()

    // Selecting an existing DB hides the new-name field
    await selectFromDropdown(user, 'copy-target-database', 'target_existing')
    await waitFor(() =>
      expect(screen.queryByTestId('copy-new-database-name')).not.toBeInTheDocument()
    )
  })

  it('renders five categories and disables empty categories', async () => {
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    expect(screen.getByTestId('copy-category-tables')).toBeInTheDocument()
    expect(screen.getByTestId('copy-category-procedures')).toBeInTheDocument()
    expect(screen.getByTestId('copy-category-functions')).toBeInTheDocument()
    expect(screen.getByTestId('copy-category-triggers')).toBeInTheDocument()
    // Events category is empty (0) -> disabled
    expect(screen.getByTestId('copy-category-events')).toBeDisabled()
  })

  it('checks the pre-selected object and expands its category on mount', async () => {
    render(
      <CopyToHostDialog
        {...defaultProps}
        preSelectedObject={{ category: 'procedures', name: 'sp_recalc' }}
      />
    )
    await waitForLoaded()

    const checkbox = (await screen.findByTestId(
      'copy-object-procedures-sp_recalc'
    )) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('toggles all objects in a category via select-all and shows indeterminate for partial', async () => {
    const user = userEvent.setup()
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    const categoryCheckbox = screen.getByTestId('copy-category-tables') as HTMLInputElement

    // Select all
    await user.click(categoryCheckbox)
    expect((screen.getByTestId('copy-object-tables-users') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('copy-object-tables-orders') as HTMLInputElement).checked).toBe(true)
    expect(categoryCheckbox.checked).toBe(true)

    // Deselect one -> indeterminate
    await user.click(screen.getByTestId('copy-object-tables-users'))
    expect(categoryCheckbox.indeterminate).toBe(true)
    expect(categoryCheckbox.checked).toBe(false)
  })

  it('disables the data block for "Structure only" and the structure block for "Data only"', async () => {
    const user = userEvent.setup()
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    // Structure only -> data block disabled with note
    await selectFromDropdown(user, 'copy-type', 'structureOnly')
    expect(screen.getByTestId('copy-data-group')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('copy-data-na')).toBeInTheDocument()
    expect(screen.getByTestId('copy-truncate')).toBeDisabled()

    // Data only -> structure block disabled with note
    await selectFromDropdown(user, 'copy-type', 'dataOnly')
    expect(screen.getByTestId('copy-structure-group')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('copy-structure-na')).toBeInTheDocument()
    expect(screen.getByTestId('copy-drop-if-exists')).toBeDisabled()
    expect(screen.getByText('CREATE TABLE IF NOT EXISTS')).toBeInTheDocument()
  })

  it('keeps non-table selections enabled in "Data only" mode', async () => {
    const user = userEvent.setup()
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await user.click(screen.getByTestId('copy-object-procedures-sp_recalc'))
    expect(screen.getByTestId('copy-object-procedures-sp_recalc')).toBeChecked()
    expect(screen.getByTestId('copy-objects-section')).toHaveTextContent('Objects (1)')

    await selectFromDropdown(user, 'copy-type', 'dataOnly')

    expect(screen.getByTestId('copy-object-procedures-sp_recalc')).toBeChecked()
    expect(screen.getByTestId('copy-object-procedures-sp_recalc')).toBeEnabled()
    expect(screen.getByTestId('copy-category-procedures')).toBeEnabled()
    expect(screen.getByTestId('copy-objects-section')).toHaveTextContent('Objects (1)')
  })

  it('disables Copy until a target DB is set and at least one object is selected', async () => {
    const user = userEvent.setup()
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    const copyBtn = screen.getByTestId('copy-submit-button')
    expect(copyBtn).toBeDisabled()

    // Pick target connection + database
    await chooseTarget(user, 'target-profile', 'target_existing')
    // Still disabled — no object selected
    expect(copyBtn).toBeDisabled()

    // Select an object
    await user.click(screen.getByTestId('copy-object-tables-users'))
    expect(copyBtn).toBeEnabled()
  })

  it('starts a copy and renders polled dual progress reaching a terminal state', async () => {
    const user = userEvent.setup()
    ipc.override('get_copy_progress', () => MOCK_PROGRESS_RUNNING)

    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await chooseTarget(user, 'target-profile', 'target_existing')
    await user.click(screen.getByTestId('copy-object-tables-users'))
    await user.click(screen.getByTestId('copy-submit-button'))

    // Dual progress renders: macro objects count + micro row count
    const progress = await screen.findByTestId('copy-progress')
    await waitFor(() => expect(within(progress).getByText('1 / 3')).toBeInTheDocument())
    expect(screen.getByTestId('copy-row-count')).toBeInTheDocument()

    // The single action button is Cancel while running
    expect(screen.getByTestId('copy-progress-action')).toHaveTextContent('Cancel')

    // Flip to completed -> terminal state with success status + Close relabel
    ipc.override('get_copy_progress', () => MOCK_PROGRESS_COMPLETED)
    await waitFor(() => expect(screen.getByTestId('copy-status-success')).toBeInTheDocument())
    expect(screen.getByTestId('copy-progress-action')).toHaveTextContent('Close')
  })

  it('submits selected non-table objects during Data only copies', async () => {
    const user = userEvent.setup()
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await chooseTarget(user, 'target-profile', 'target_existing')
    await user.click(screen.getByTestId('copy-object-procedures-sp_recalc'))
    await selectFromDropdown(user, 'copy-type', 'dataOnly')
    await user.click(screen.getByTestId('copy-submit-button'))

    expect(ipc.calls('start_copy_to_host')[0]).toMatchObject({
      params: {
        objects: { tables: [], procedures: ['sp_recalc'] },
        options: { copyStructure: false, copyData: true },
      },
    })
  })

  it('relabels Cancel to Close and renders the cancel status at terminal state', async () => {
    const user = userEvent.setup()
    ipc.override('get_copy_progress', () => MOCK_PROGRESS_RUNNING)

    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await chooseTarget(user, 'target-profile', 'target_existing')
    await user.click(screen.getByTestId('copy-object-tables-users'))
    await user.click(screen.getByTestId('copy-submit-button'))

    await screen.findByTestId('copy-progress')
    expect(screen.getByTestId('copy-progress-action')).toHaveTextContent('Cancel')

    // Cancel -> backend reports cancelled
    ipc.override('get_copy_progress', () => ({
      ...MOCK_PROGRESS_RUNNING,
      status: 'cancelled' as const,
      objectsDone: 1,
    }))
    await user.click(screen.getByTestId('copy-progress-action'))

    await waitFor(() => expect(screen.getByTestId('copy-status-cancel')).toBeInTheDocument())
    expect(screen.getByTestId('copy-progress-action')).toHaveTextContent('Close')
  })

  it('renders the footer hint about foreign-key checks', async () => {
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()
    expect(screen.getByText(/Foreign-key checks are disabled on the target/)).toBeInTheDocument()
  })

  it('passes every toggled option through to the copy request', async () => {
    const user = userEvent.setup()
    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await chooseTarget(user, 'target-profile', 'target_existing')
    await user.click(screen.getByTestId('copy-object-tables-users'))

    // Flip every option away from its default.
    await user.click(screen.getByTestId('copy-drop-if-exists'))
    await user.click(screen.getByTestId('copy-create-if-not-exists'))
    await selectFromDropdown(user, 'copy-insert-mode', 'insertIgnore')
    await user.click(screen.getByTestId('copy-truncate'))
    await user.click(screen.getByTestId('copy-ignore-definer'))

    await user.click(screen.getByTestId('copy-submit-button'))

    expect(ipc.calls('start_copy_to_host')[0]).toMatchObject({
      params: {
        options: {
          copyStructure: true,
          copyData: true,
          dropIfExists: false,
          createIfNotExists: false,
          truncateBeforeInsert: true,
          insertMode: 'insertIgnore',
          ignoreDefiner: false,
        },
      },
    })
  })

  it('renders the failed status and an error toast when the job fails', async () => {
    const user = userEvent.setup()
    ipc.override('get_copy_progress', () => ({
      ...MOCK_PROGRESS_RUNNING,
      status: 'failed' as const,
      currentObject: 'orders',
      errorMessage: 'Target connection lost',
    }))

    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await chooseTarget(user, 'target-profile', 'target_existing')
    await user.click(screen.getByTestId('copy-object-tables-users'))
    await user.click(screen.getByTestId('copy-submit-button'))

    const status = await screen.findByTestId('copy-status-error')
    expect(status).toHaveTextContent('Target connection lost')
    expect(screen.getByTestId('copy-progress-action')).toHaveTextContent('Close')
    await expectToast('error', 'Copy failed')
  })

  it('shows an error toast and resets when starting the copy fails', async () => {
    const user = userEvent.setup()
    ipc.override('start_copy_to_host', () => {
      throw new Error('boom')
    })

    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await chooseTarget(user, 'target-profile', 'target_existing')
    await user.click(screen.getByTestId('copy-object-tables-users'))
    await user.click(screen.getByTestId('copy-submit-button'))

    await expectToast('error', 'Copy failed')
    // The submit controls return (no progress action) so the user can retry.
    expect(screen.getByTestId('copy-submit-button')).toBeInTheDocument()
  })

  it('surfaces a toast when cancelling the copy fails', async () => {
    const user = userEvent.setup()
    ipc.override('get_copy_progress', () => MOCK_PROGRESS_RUNNING)
    ipc.override('cancel_copy', () => {
      throw new Error('cancel exploded')
    })

    render(<CopyToHostDialog {...defaultProps} />)
    await waitForLoaded()

    await chooseTarget(user, 'target-profile', 'target_existing')
    await user.click(screen.getByTestId('copy-object-tables-users'))
    await user.click(screen.getByTestId('copy-submit-button'))

    await screen.findByTestId('copy-progress')
    await user.click(screen.getByTestId('copy-progress-action'))

    await expectToast('error', 'Failed to cancel copy')
  })
})
