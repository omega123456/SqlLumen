import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionsBoard } from '../../../../components/connections-page/board/ConnectionsBoard'
import { useConnectionStore } from '../../../../stores/connection-store'
import { useConnectionsPageStore } from '../../../../stores/connections-page-store'
import type { ConnectionGroup, SavedConnection } from '../../../../types/connection'
import { ipc } from '../../../ipc-mock'
import { makeActiveConnection, makeSavedConnection } from '../../../helpers/connection-test-utils'

const ORDERS = makeSavedConnection({
  id: 'orders',
  name: 'Orders primary',
  host: 'orders-db',
  username: 'app_rw',
  groupId: 'prod',
  sslMode: 'verify_ca',
  readOnly: true,
})
const SAMPLE = makeSavedConnection({ id: 'sample', name: 'Sample MySQL', hasPassword: false })
const PRODUCTION: ConnectionGroup = {
  id: 'prod',
  name: 'Production',
  parentId: null,
  sortOrder: 0,
  createdAt: '',
  color: '#3366ff',
}

function seedBoard(savedConnections: SavedConnection[] = [ORDERS, SAMPLE]) {
  act(() => {
    useConnectionStore.setState({
      savedConnections: savedConnections,
      connectionGroups: [PRODUCTION],
      savedConnectionsLoad: { status: 'ready' },
    })
  })
  ipc.override('list_connections', () => savedConnections)
  ipc.override('list_connection_groups', () => [PRODUCTION])
}

function tileOf(name: string): HTMLElement {
  return screen.getByRole('button', { name: `Connect to ${name}` }).closest('li') as HTMLElement
}

beforeEach(() => {
  act(() => {
    useConnectionsPageStore.getState().openPage()
    useConnectionStore.setState({
      activeConnections: {},
      activeConnectionOrder: [],
      activeTabId: null,
    })
  })
})

describe('ConnectionsBoard', () => {
  it('lists servers by group and connects in one click', async () => {
    const user = userEvent.setup()
    seedBoard()
    render(<ConnectionsBoard />)

    expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument()
    expect(screen.getByText('2 saved servers')).toBeInTheDocument()
    expect(screen.getByTestId('connections-composer')).toHaveFocus()
    const production = screen.getByRole('region', { name: 'Production' })
    expect(within(production).getByText('orders-db')).toBeInTheDocument()
    expect(within(tileOf('Orders primary')).getByText('Read-only')).toBeInTheDocument()
    expect(within(tileOf('Orders primary')).getByText('TLS')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recent' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Connect to Sample MySQL' }))
    await waitFor(() => expect(useConnectionsPageStore.getState().isOpen).toBe(false))
    expect(ipc.calls('open_connection')).toHaveLength(1)
  })

  it('switches to an open profile on click, and opens another session from its icon or menu', async () => {
    const user = userEvent.setup()
    seedBoard()
    act(() => {
      useConnectionStore.setState({
        activeConnections: {
          'sess-a': makeActiveConnection({ id: 'sess-a' }),
          'sess-s': makeActiveConnection({ id: 'sess-s', profile: SAMPLE }),
        },
        activeConnectionOrder: ['sess-a', 'sess-s'],
        activeTabId: 'sess-a',
      })
    })
    render(<ConnectionsBoard />)

    expect(within(tileOf('Sample MySQL')).getByText('Open')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Connect to Sample MySQL' }))
    expect(useConnectionStore.getState().activeTabId).toBe('sess-s')
    expect(useConnectionsPageStore.getState().isOpen).toBe(false)
    expect(ipc.calls('open_connection')).toHaveLength(0)

    act(() => useConnectionsPageStore.getState().openPage())
    await user.click(screen.getByRole('button', { name: 'Open Sample MySQL in a new session' }))
    await waitFor(() => expect(ipc.calls('open_connection')).toHaveLength(1))
    expect(useConnectionsPageStore.getState().isOpen).toBe(false)

    act(() => useConnectionsPageStore.getState().openPage())
    await user.click(screen.getByRole('button', { name: 'More actions for Sample MySQL' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open in new session' }))
    await waitFor(() => expect(ipc.calls('open_connection')).toHaveLength(2))
  })

  it('asks for a password after access denied, and connects and saves it', async () => {
    const user = userEvent.setup()
    seedBoard()
    ipc.override('open_connection', () => {
      throw { kind: 'accessDenied', message: 'Access denied for user' }
    })
    render(<ConnectionsBoard />)

    await user.click(screen.getByRole('button', { name: 'Connect to Sample MySQL' }))
    const passwordField = await screen.findByLabelText('Password for Sample MySQL')
    expect(within(tileOf('Sample MySQL')).getByText('This server needs a password.')).toBeVisible()

    ipc.override('open_connection', () => ({
      sessionId: 'sess-new',
      serverVersion: '8.0.33',
      lastConnectedAt: null,
    }))
    await user.type(passwordField, 'pw')
    await user.click(within(tileOf('Sample MySQL')).getByRole('checkbox'))
    await user.click(within(tileOf('Sample MySQL')).getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(useConnectionsPageStore.getState().isOpen).toBe(false))
    expect(ipc.calls('open_connection')[1]).toMatchObject({
      payload: { profileId: 'sample', password: 'pw' },
    })
    expect(ipc.calls('update_connection')).toHaveLength(1)
  })

  it('shows other connect failures on the tile with an Edit link', async () => {
    const user = userEvent.setup()
    seedBoard()
    ipc.override('open_connection', () => {
      throw { kind: 'failed', message: 'Host unreachable' }
    })
    render(<ConnectionsBoard />)

    await user.click(screen.getByRole('button', { name: 'Connect to Orders primary' }))
    const tile = tileOf('Orders primary')
    expect(await within(tile).findByText('Host unreachable')).toBeInTheDocument()
    await user.click(within(tile).getByRole('button', { name: 'Edit' }))
    expect(useConnectionsPageStore.getState().view).toEqual({
      kind: 'profile',
      target: { kind: 'existing', profileId: 'orders' },
    })
  })

  it('filters as you type, and offers to clear a filter with no match', async () => {
    const user = userEvent.setup()
    seedBoard()
    render(<ConnectionsBoard />)

    await user.type(screen.getByTestId('connections-composer'), 'orders')
    expect(screen.queryByRole('button', { name: 'Connect to Sample MySQL' })).toBeNull()
    await user.type(screen.getByTestId('connections-composer'), 'zzz')
    expect(screen.getByText('No servers match “orderszzz”')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getByTestId('connections-composer')).toHaveValue('')
  })

  it('reviews a pasted URL, saves it and connects', async () => {
    const user = userEvent.setup()
    seedBoard()
    render(<ConnectionsBoard />)
    const composer = screen.getByTestId('connections-composer')

    await user.click(composer)
    await user.paste('mysqlx://root@localhost')
    expect(screen.getByRole('alert')).toHaveTextContent('X Protocol')
    await user.keyboard('{Escape}')
    expect(composer).toHaveValue('')

    await user.paste('mysql://deploy:s3cret@shop-db.acme.io/shop?charset=utf8')
    const review = screen.getByTestId('url-review')
    expect(within(review).getByText('shop-db.acme.io')).toBeInTheDocument()
    expect(within(review).getByText('From URL, saved encrypted')).toBeInTheDocument()
    expect(within(review).getByText('charset')).toBeInTheDocument()
    expect(within(review).queryByText('s3cret')).toBeNull()

    ipc.override('list_connections', () => [makeSavedConnection({ id: 'conn-mock-new' })])
    await user.click(within(review).getByRole('button', { name: 'Save and connect' }))
    await waitFor(() => expect(useConnectionsPageStore.getState().isOpen).toBe(false))
    expect(ipc.calls('save_connection')[0]).toMatchObject({
      data: { name: 'shop-db.acme.io', host: 'shop-db.acme.io', password: 's3cret' },
    })
    expect(composer).toHaveValue('')
  })

  it('opens a pasted URL as a prefilled new profile', async () => {
    const user = userEvent.setup()
    seedBoard()
    render(<ConnectionsBoard />)

    await user.click(screen.getByTestId('connections-composer'))
    await user.paste('mysql://deploy@shop-db.acme.io:3307')
    expect(within(screen.getByTestId('url-review')).getByText('Not in URL')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review all settings' }))
    expect(useConnectionsPageStore.getState().view).toMatchObject({
      kind: 'profile',
      target: { kind: 'new', seed: { data: { host: 'shop-db.acme.io', port: 3307 } } },
    })
  })

  it('shows loading, load failure with retry, and the empty state', async () => {
    const user = userEvent.setup()
    act(() => {
      useConnectionStore.setState({
        savedConnections: [],
        savedConnectionsLoad: { status: 'loading' },
      })
    })
    render(<ConnectionsBoard />)
    expect(screen.getByTestId('board-skeleton')).toBeInTheDocument()

    act(() => {
      useConnectionStore.setState({
        savedConnectionsLoad: { status: 'failed', message: 'db locked' },
      })
    })
    expect(screen.getByText('db locked')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('No saved connections yet')).toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: 'New connection' })[1])
    expect(useConnectionsPageStore.getState().view).toEqual({
      kind: 'profile',
      target: { kind: 'new', seed: null },
    })
  })

  it('edits, duplicates, copies and deletes from the More menu', async () => {
    const user = userEvent.setup()
    seedBoard()
    render(<ConnectionsBoard />)
    const openMenu = () =>
      user.click(screen.getByRole('button', { name: 'More actions for Orders primary' }))

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Copy URL' }))
    expect(await navigator.clipboard.readText()).toBe('mysql://app_rw@orders-db:3306')

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => expect(ipc.calls('delete_connection')).toHaveLength(1))

    await openMenu()
    const moveTargets = screen.getAllByRole('menuitemradio')
    expect(moveTargets.map((target) => target.textContent)).toEqual(['Ungrouped', 'Production'])
    expect(moveTargets[1]).toHaveAttribute('aria-checked', 'true')
    await user.click(moveTargets[0])
    await waitFor(() => expect(ipc.payloads('update_connection')).toHaveLength(1))
    expect(ipc.payloads('update_connection')[0]).toMatchObject({
      id: 'orders',
      data: { groupId: null },
    })

    await user.pointer({ keys: '[MouseRight]', target: tileOf('Orders primary') })
    expect(screen.queryByRole('menuitem', { name: 'Edit group…' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(useConnectionsPageStore.getState().view).toMatchObject({
      target: { kind: 'new', seed: { data: { name: 'Copy of Orders primary' } } },
    })

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(useConnectionsPageStore.getState().view).toMatchObject({
      target: { kind: 'existing', profileId: 'orders' },
    })
  })

  it('creates a group, then edits and deletes it from its pencil and menu', async () => {
    const user = userEvent.setup()
    seedBoard()
    act(() => {
      useConnectionStore.setState({
        activeConnections: { 'sess-o': makeActiveConnection({ id: 'sess-o', profile: ORDERS }) },
      })
    })
    render(<ConnectionsBoard />)

    await user.click(screen.getByRole('button', { name: 'New group' }))
    await user.type(screen.getByLabelText('New group name'), 'Staging{Enter}')
    await waitFor(() => expect(ipc.calls('create_connection_group')).toHaveLength(1))

    const pencil = screen.getByRole('button', { name: 'Edit group Production' })
    await user.click(pencil)
    const nameField = screen.getByLabelText('Group name')
    expect(nameField).toHaveFocus()
    await user.clear(nameField)
    await user.type(nameField, 'Live{Enter}')
    await waitFor(() =>
      expect(ipc.payloads('update_connection_group')).toEqual([
        { id: 'prod', name: 'Live', color: '#3366ff' },
      ])
    )
    expect(pencil).toHaveFocus()

    await user.click(pencil)
    await user.type(screen.getByLabelText('Group name'), ' renamed')
    await user.click(screen.getByRole('button', { name: 'Choose color' }))
    await user.click(screen.getByRole('button', { name: 'Clear color' }))
    expect(within(screen.getByTestId('group-edit-popover')).getByText('None')).toBeVisible()
    await user.click(screen.getByLabelText('Group name'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(ipc.payloads('update_connection_group')).toHaveLength(2))
    expect(ipc.payloads('update_connection_group')[1]).toEqual({
      id: 'prod',
      name: 'Production',
      color: null,
    })
    expect(screen.queryByTestId('group-edit-popover')).toBeNull()

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('heading', { name: 'Production' }),
    })
    await user.click(screen.getByRole('menuitem', { name: 'Delete group…' }))
    await waitFor(() => expect(screen.getByTestId('confirm-cancel-button')).toHaveFocus())
    expect(
      screen.getByText('Open sessions for these connections will lose the group colour.')
    ).toBeVisible()
    await user.click(screen.getByTestId('confirm-confirm-button'))
    await waitFor(() => expect(ipc.calls('delete_connection_group')).toEqual([{ id: 'prod' }]))
  })

  it('moves between tiles with arrow keys, opens the menu with Shift+F10 and edits with E', async () => {
    const user = userEvent.setup()
    seedBoard()
    render(<ConnectionsBoard />)
    const orders = screen.getByRole('button', { name: 'Connect to Orders primary' })
    const sample = screen.getByRole('button', { name: 'Connect to Sample MySQL' })
    expect(orders).toHaveAttribute('tabindex', '0')
    expect(sample).toHaveAttribute('tabindex', '-1')

    act(() => orders.focus())
    await user.keyboard('{End}')
    expect(sample).toHaveFocus()
    expect(sample).toHaveAttribute('tabindex', '0')
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    act(() => sample.focus())
    await user.keyboard('e')
    expect(useConnectionsPageStore.getState().view).toMatchObject({
      target: { kind: 'existing', profileId: 'sample' },
    })
  })
})
