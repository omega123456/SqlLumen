import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionsPage } from '../../../components/connections-page/ConnectionsPage'
import { useConnectionStore } from '../../../stores/connection-store'
import { useConnectionsPageStore } from '../../../stores/connections-page-store'
import { ipc } from '../../ipc-mock'
import { makeActiveConnection, makeSavedConnection } from '../../helpers/connection-test-utils'

const SAMPLE = makeSavedConnection({ id: 'sample', name: 'Sample MySQL' })

function seedSession() {
  act(() => {
    useConnectionStore.setState({
      activeConnections: { 'sess-1': makeActiveConnection({ id: 'sess-1', profile: SAMPLE }) },
      activeConnectionOrder: ['sess-1'],
      activeTabId: 'sess-1',
    })
  })
}

beforeEach(() => {
  ipc.override('list_connections', () => [SAMPLE])
  act(() => {
    useConnectionStore.setState({
      activeConnections: {},
      activeConnectionOrder: [],
      activeTabId: null,
      savedConnectionsLoad: { status: 'idle' },
    })
    useConnectionsPageStore.getState().openPage()
  })
})

describe('ConnectionsPage', () => {
  it('loads saved servers, and Esc stays on the board without a session', async () => {
    const user = userEvent.setup()
    render(<ConnectionsPage />)

    expect(await screen.findByRole('button', { name: 'Connect to Sample MySQL' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull()
    await user.keyboard('{Escape}')
    expect(useConnectionsPageStore.getState().isOpen).toBe(true)
  })

  it('clears the composer first, then Esc returns to the session', async () => {
    const user = userEvent.setup()
    seedSession()
    render(<ConnectionsPage />)

    await user.type(await screen.findByTestId('connections-composer'), 'sam')
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('connections-composer')).toHaveValue('')
    expect(useConnectionsPageStore.getState().isOpen).toBe(true)
    await user.keyboard('{Escape}')
    expect(useConnectionsPageStore.getState().isOpen).toBe(false)
  })

  it('confirms before Esc leaves a profile with unsaved edits', async () => {
    const user = userEvent.setup()
    seedSession()
    render(<ConnectionsPage />)

    await user.click(await screen.findByRole('button', { name: 'Edit Sample MySQL' }))
    await user.click(screen.getByRole('button', { name: 'Edit Server' }))
    await user.type(screen.getByLabelText('Host'), 'x')
    await user.keyboard('{Escape}')
    expect(await screen.findByText('Discard unsaved changes?')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))

    await waitFor(() => expect(useConnectionsPageStore.getState().view).toEqual({ kind: 'board' }))
    await user.click(screen.getByRole('button', { name: 'Back to Sample MySQL' }))
    expect(useConnectionsPageStore.getState().isOpen).toBe(false)
  })
})
