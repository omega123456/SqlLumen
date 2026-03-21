import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceTabs } from '../../../components/workspace/WorkspaceTabs'
import { useWorkspaceStore, _resetTabIdCounter } from '../../../stores/workspace-store'

beforeEach(() => {
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  _resetTabIdCounter()
})

describe('WorkspaceTabs', () => {
  it('renders nothing when no tabs exist', () => {
    const { container } = render(<WorkspaceTabs connectionId="conn-1" />)
    expect(container.innerHTML).toBe('')
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

  it('does not render tabs for other connections', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-2',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    const { container } = render(<WorkspaceTabs connectionId="conn-1" />)
    expect(container.innerHTML).toBe('')
  })
})
