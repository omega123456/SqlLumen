import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileView } from '../../../../components/connections-page/profile/ProfileView'
import { useConnectionStore } from '../../../../stores/connection-store'
import {
  useConnectionsPageStore,
  type ProfileTarget,
} from '../../../../stores/connections-page-store'
import type { SavedConnection } from '../../../../types/connection'
import { ipc } from '../../../ipc-mock'
import { makeActiveConnection, makeSavedConnection } from '../../../helpers/connection-test-utils'

const ORDERS = makeSavedConnection({
  id: 'orders',
  name: 'Orders primary',
  host: 'orders-db',
  username: 'app_rw',
  defaultDatabase: 'orders',
  sslMode: 'verify_ca',
  sslCaPath: '/certs/rds-bundle.pem',
  groupId: 'prod',
  color: '#d13438',
})

const EXISTING: ProfileTarget = { kind: 'existing', profileId: 'orders' }

function seedProfiles(savedConnections: SavedConnection[] = [ORDERS]) {
  act(() => {
    useConnectionStore.setState({
      savedConnections: savedConnections,
      connectionGroups: [
        {
          id: 'prod',
          name: 'Production',
          parentId: null,
          sortOrder: 0,
          createdAt: '',
          color: '#3366ff',
        },
      ],
      activeConnections: {},
      activeTabId: null,
    })
  })
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name: name })
}

function renderProfile(target: ProfileTarget) {
  act(() => {
    useConnectionsPageStore.getState().openPage()
    useConnectionsPageStore.getState().showProfile(target)
  })
  return render(<ProfileView target={target} />)
}

beforeEach(() => {
  seedProfiles()
})

describe('ProfileView', () => {
  it('reads every setting as text, then edits and saves one section', async () => {
    const user = userEvent.setup()
    renderProfile(EXISTING)

    expect(screen.getByRole('heading', { name: 'Orders primary' })).toBeInTheDocument()
    expect(screen.getByText('app_rw@orders-db:3306 / orders')).toBeInTheDocument()
    expect(within(section('Server')).getByText('10 s to connect · 30 s keepalive')).toBeVisible()
    expect(within(section('Sign-in')).getByText('Saved, encrypted on this device')).toBeVisible()
    expect(within(section('Security')).getByText('Verify CA')).toBeVisible()
    expect(within(section('Security')).getByText('rds-bundle.pem')).toBeVisible()
    expect(within(section('Name and behaviour')).getByText('Production')).toBeVisible()
    expect(within(section('Name and behaviour')).getByText('Read and write')).toBeVisible()
    expect(within(section('Name and behaviour')).getByText('· Own colour')).toBeVisible()
    expect(screen.queryByTestId('save-bar')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit Server' }))
    expect(screen.getByTestId('save-bar')).toHaveTextContent('Editing Server')
    const host = screen.getByLabelText('Host')
    await user.clear(host)
    await user.type(host, 'orders-2')
    expect(useConnectionsPageStore.getState().hasUnsavedEdits).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByTestId('save-bar')).toBeNull())
    expect(ipc.calls('update_connection')[0]).toMatchObject({
      payload: { id: 'orders', data: { host: 'orders-2' } },
    })
  })

  it('asks before switching away from a changed section, and discards back to the saved values', async () => {
    const user = userEvent.setup()
    renderProfile(EXISTING)

    await user.click(screen.getByRole('button', { name: 'Edit Name and behaviour' }))
    const useGroupColour = screen.getByLabelText('Use group colour (Production)')
    expect(useGroupColour).not.toBeChecked()
    await user.click(useGroupColour)
    expect(screen.getByText('· From group Production')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Choose color' })).toBeDisabled()
    await user.click(useGroupColour)
    expect(screen.getByText('#3366ff')).toBeVisible()
    expect(screen.getByText('· Own colour')).toBeVisible()
    await user.click(screen.getByLabelText('Read-only, block writes'))
    await user.click(screen.getByRole('button', { name: 'Edit Security' }))
    expect(useConnectionsPageStore.getState().pendingLeave).not.toBeNull()
    expect(section('Security')).not.toHaveAttribute('data-editing')

    act(() => useConnectionsPageStore.getState().confirmLeave())
    expect(section('Security')).toHaveAttribute('data-editing')
    expect(section('Name and behaviour')).not.toHaveAttribute('data-editing')
    expect(within(section('Name and behaviour')).getByText('Read and write')).toBeVisible()

    await user.type(screen.getByLabelText('CA certificate'), '2')
    await user.click(screen.getByRole('button', { name: 'Connections' }))
    expect(useConnectionsPageStore.getState().pendingLeave).not.toBeNull()
    act(() => useConnectionsPageStore.getState().cancelLeave())

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByTestId('save-bar')).toBeNull()
  })

  it('shows only the certificate fields the SSL mode uses, and requires certificate and key together', async () => {
    const user = userEvent.setup()
    ipc.override('plugin:dialog|open', () => '/certs/client.pem')
    renderProfile(EXISTING)

    await user.click(screen.getByRole('button', { name: 'Edit Security' }))
    expect(screen.getByLabelText('CA certificate')).toHaveValue('/certs/rds-bundle.pem')
    await user.click(screen.getByTestId('ssl-mode-dropdown'))
    await user.click(screen.getByTestId('ssl-mode-dropdown-option-required'))
    expect(screen.queryByLabelText('CA certificate')).toBeNull()
    expect(screen.getByText('Always encrypt, without checking the certificate.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Browse for client certificate' }))
    expect(screen.getByLabelText('Client certificate')).toHaveValue('/certs/client.pem')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText('Add the client key that goes with the certificate')
    ).toBeVisible()
    expect(ipc.calls('update_connection')).toHaveLength(0)
  })

  it('tests the settings on screen and reports the result under the header', async () => {
    const user = userEvent.setup()
    renderProfile(EXISTING)

    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText(/Reachable · MySQL 8\.0\.33-mock/)).toBeVisible()

    ipc.override('test_connection', () => {
      throw new Error('refused')
    })
    await user.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Could not connect: refused')).toBeVisible()
  })

  it('switches to the open session instead of connecting twice', async () => {
    const user = userEvent.setup()
    act(() => {
      useConnectionStore.setState({
        activeConnections: { 'sess-o': makeActiveConnection({ id: 'sess-o', profile: ORDERS }) },
        activeConnectionOrder: ['sess-o'],
      })
    })
    renderProfile(EXISTING)

    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(useConnectionStore.getState().activeTabId).toBe('sess-o')
    expect(useConnectionsPageStore.getState().isOpen).toBe(false)
    expect(ipc.calls('open_connection')).toHaveLength(0)
  })

  it('creates a new profile with its errors opened, then shows the saved profile', async () => {
    const user = userEvent.setup()
    const seed = {
      data: { ...ORDERS, name: 'Copy of Orders primary', password: '' },
      sourceHadPassword: true,
    }
    renderProfile({ kind: 'new', seed: seed })

    expect(screen.getByTestId('save-bar')).toHaveTextContent('New connection, not saved yet')
    expect(screen.getByTestId('duplicate-password-hint')).toBeVisible()
    expect(section('Security')).not.toHaveAttribute('data-editing')
    await user.clear(screen.getByLabelText('Name'))
    await user.click(screen.getByRole('button', { name: 'Save connection' }))
    expect(screen.getByText('Connection name is required')).toBeVisible()

    await user.type(screen.getByLabelText('Name'), 'Orders copy')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByLabelText('Save password, encrypted on this device'))
    await user.click(screen.getByRole('button', { name: 'Save connection' }))
    await waitFor(() =>
      expect(ipc.calls('save_connection')[0]).toMatchObject({ data: { password: null } })
    )
    await waitFor(() =>
      expect(useConnectionsPageStore.getState().view).toEqual({
        kind: 'profile',
        target: { kind: 'existing', profileId: 'conn-mock-new' },
      })
    )
  })

  it('discards a new profile back to the board', async () => {
    const user = userEvent.setup()
    renderProfile({ kind: 'new', seed: null })

    expect(screen.getByRole('heading', { name: 'New connection' })).toBeInTheDocument()
    expect(screen.getByText('Fill in the server and sign-in to connect.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(useConnectionsPageStore.getState().view).toEqual({ kind: 'board' })
  })
})
