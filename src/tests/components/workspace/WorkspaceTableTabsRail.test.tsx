import { describe, it, expect, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { dispatchAuxClick } from '../../helpers/dispatch-aux-click'
import { WorkspaceTableTabsRail } from '../../../components/workspace/WorkspaceTableTabsRail'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useObjectEditorStore } from '../../../stores/object-editor-store'

beforeEach(() => {
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  useTableDesignerStore.setState({ tabs: {} })
  useObjectEditorStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
})

describe('WorkspaceTableTabsRail', () => {
  it('renders with data-testid="bottom-table-tabs"', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    expect(screen.getByTestId('bottom-table-tabs')).toBeInTheDocument()
  })

  it('returns null when there are no table-data tabs', () => {
    // Only a query tab, no table-data tabs
    useWorkspaceStore.getState().openQueryTab('conn-1')

    const { container } = render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('bottom-table-tabs')).not.toBeInTheDocument()
  })

  it('returns null when there are no tabs at all', () => {
    const { container } = render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    expect(container.firstChild).toBeNull()
  })

  it('renders only table-data tabs — not query tabs, schema-info tabs, etc.', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openQueryTab('conn-1')
    useWorkspaceStore.getState().openTab({
      type: 'schema-info',
      label: 'orders info',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'orders',
      objectType: 'table',
    })

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    // Only the table-data tab label should appear
    expect(screen.getByText('users')).toBeInTheDocument()
    // Query and schema-info tabs should not appear
    expect(screen.queryByText('Query 1')).not.toBeInTheDocument()
    expect(screen.queryByText('orders info')).not.toBeInTheDocument()
  })

  it('renders multiple table-data tabs', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'orders',
      objectType: 'table',
    })

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
  })

  it('clicking a table-data tab activates it', async () => {
    const user = userEvent.setup()

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'orders',
      objectType: 'table',
    })

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const usersTab = tabs[0]
    const ordersTab = tabs[1]

    // orders is active (last opened)
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(ordersTab.id)

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    // Click users
    await user.click(screen.getByText('users'))

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(usersTab.id)
  })

  it('close button (×) closes the tab through workspace store', async () => {
    const user = userEvent.setup()

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    const closeBtn = screen.getByLabelText('Close users')
    await user.click(closeBtn)

    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1']?.filter((t) => t.type === 'table-data')
    ).toHaveLength(0)
  })

  it('middle-click (aux click) closes the tab', async () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    await act(async () => {
      dispatchAuxClick(screen.getByTestId(`workspace-tab-${tabId}`))
    })

    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1']?.filter((t) => t.type === 'table-data')
    ).toHaveLength(0)
  })

  it('Enter key activates the focused tab', async () => {
    const user = userEvent.setup()

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'orders',
      objectType: 'table',
    })

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const usersTab = tabs[0]

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    // Focus the users tab label button and press Enter
    const usersTabEl = screen.getByTestId(`workspace-tab-${usersTab.id}`)
    const labelButton = usersTabEl.querySelector<HTMLElement>('[role="button"]')!
    labelButton.focus()

    await user.keyboard('{Enter}')

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(usersTab.id)
  })

  it('Space key activates the focused tab', async () => {
    const user = userEvent.setup()

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'orders',
      objectType: 'table',
    })

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const usersTab = tabs[0]

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    const usersTabEl = screen.getByTestId(`workspace-tab-${usersTab.id}`)
    const labelButton = usersTabEl.querySelector<HTMLElement>('[role="button"]')!
    labelButton.focus()

    await user.keyboard(' ')

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(usersTab.id)
  })

  it('Shift+F10 opens context menu for the focused tab', async () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    const tabEl = screen.getByTestId(`workspace-tab-${tabId}`)
    const labelButton = tabEl.querySelector<HTMLElement>('[role="button"]')!
    labelButton.focus()

    fireEvent.keyDown(labelButton, { key: 'F10', shiftKey: true })

    // Context menu should be visible
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('ContextMenu key opens context menu for the focused tab', async () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    const tabEl = screen.getByTestId(`workspace-tab-${tabId}`)
    const labelButton = tabEl.querySelector<HTMLElement>('[role="button"]')!
    labelButton.focus()

    fireEvent.keyDown(labelButton, { key: 'ContextMenu' })

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('right-click opens context menu for the tab', async () => {
    const user = userEvent.setup()

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByTestId(`workspace-tab-${tabId}`),
    })

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('reorder: moving a table-data tab preserves non-table movable tabs relative order', () => {
    // Setup: queryTab, tableA, tableB — movable order = [queryTab, tableA, tableB]
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'tableA',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'tableA',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'tableB',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'tableB',
      objectType: 'table',
    })

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const tableATab = tabs.find((t) => t.label === 'tableA')!
    const tableBTab = tabs.find((t) => t.label === 'tableB')!

    // Move tableA to after tableB (subset insert index 2 = end of table-data group)
    // In the full movable list [queryTab, tableA, tableB], end of table-data group = index 3
    act(() => {
      useWorkspaceStore.getState().reorderWorkspaceTab('conn-1', tableATab.id, 3)
    })

    const reorderedTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const movableIds = reorderedTabs
      .filter((t) => t.type !== 'history' && t.type !== 'processlist')
      .map((t) => t.id)

    // queryTab should still be first, tableB second, tableA last
    expect(movableIds).toEqual([queryTabId, tableBTab.id, tableATab.id])
  })

  it('disappears from DOM after the last table-data tab is closed', async () => {
    const user = userEvent.setup()

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceTableTabsRail connectionId="conn-1" />)

    expect(screen.getByTestId('bottom-table-tabs')).toBeInTheDocument()

    // Close the only table-data tab
    const closeBtn = screen.getByLabelText('Close users')
    await user.click(closeBtn)

    expect(screen.queryByTestId('bottom-table-tabs')).not.toBeInTheDocument()
  })
})
