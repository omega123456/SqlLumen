import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { dispatchAuxClick } from '../../helpers/dispatch-aux-click'
import userEvent from '@testing-library/user-event'
import { WorkspaceTabs } from '../../../components/workspace/WorkspaceTabs'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'

beforeEach(() => {
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  useTableDesignerStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
})

describe('WorkspaceTabs', () => {
  it('renders tab bar with "+" button even when no tabs exist', () => {
    render(<WorkspaceTabs connectionId="conn-1" />)
    expect(screen.getByTestId('workspace-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('new-query-tab-button')).toBeInTheDocument()
  })

  it('renders tabs for the active connection', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openTab({
      type: 'schema-info',
      label: 'orders',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'orders',
      objectType: 'table',
    })

    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(screen.getByTestId('workspace-tabs')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
  })

  it('clicking a tab activates it', async () => {
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

    render(<WorkspaceTabs connectionId="conn-1" />)

    // orders is active (last opened)
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(tabs[1].id)

    // Click users tab
    await user.click(screen.getByText('users'))

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(tabs[0].id)
  })

  it('clicking close button (×) closes the tab', async () => {
    const user = userEvent.setup()

    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceTabs connectionId="conn-1" />)

    const closeBtn = screen.getByLabelText('Close users')
    await user.click(closeBtn)

    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(0)
  })

  it('middle-click (aux click) on a tab closes it', async () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    render(<WorkspaceTabs connectionId="conn-1" />)

    await act(async () => {
      dispatchAuxClick(screen.getByTestId(`workspace-tab-${tabId}`))
    })

    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(0)
  })

  it('middle-click on History tab does not close it', async () => {
    useWorkspaceStore.getState().openHistoryTab('conn-1', true)
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const historyTab = tabs.find((t) => t.type === 'history')
    expect(historyTab).toBeDefined()

    render(<WorkspaceTabs connectionId="conn-1" />)

    await act(async () => {
      dispatchAuxClick(screen.getByTestId(`workspace-tab-${historyTab!.id}`))
    })

    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(2)
    expect(
      useWorkspaceStore.getState().tabsByConnection['conn-1'].some((t) => t.type === 'history')
    ).toBe(true)
  })

  it('shows correct tab labels', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'mydb.users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(screen.getByText('mydb.users')).toBeInTheDocument()
  })

  it('"+" button renders even with no tabs for a different connection', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-2',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceTabs connectionId="conn-1" />)
    // No tab labels from conn-2 visible
    expect(screen.queryByText('users')).not.toBeInTheDocument()
    // But "+" button is present
    expect(screen.getByTestId('new-query-tab-button')).toBeInTheDocument()
  })

  it('clicking "+" creates a new query tab', async () => {
    const user = userEvent.setup()

    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toBeUndefined()

    await user.click(screen.getByTestId('new-query-tab-button'))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('query-editor')
    expect(tabs[0].label).toBe('Query 1')
  })

  it('clicking "+" multiple times creates numbered query tabs', async () => {
    const user = userEvent.setup()

    render(<WorkspaceTabs connectionId="conn-1" />)

    await user.click(screen.getByTestId('new-query-tab-button'))
    await user.click(screen.getByTestId('new-query-tab-button'))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(2)
    expect(tabs[0].label).toBe('Query 1')
    expect(tabs[1].label).toBe('Query 2')
  })

  it('shows dirty indicator on table-designer tabs', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-designer',
      label: 'users',
      connectionId: 'conn-1',
      mode: 'alter',
      databaseName: 'mydb',
      objectName: 'users',
    })

    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    useTableDesignerStore.getState().initTab(tabId, 'alter', 'conn-1', 'mydb', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...state.tabs[tabId],
          isDirty: true,
        },
      },
    }))

    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(screen.getByTestId(`workspace-tab-${tabId}`)).toHaveTextContent('users ●')
  })
})
