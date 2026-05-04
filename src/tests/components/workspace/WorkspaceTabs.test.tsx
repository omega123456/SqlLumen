import { describe, it, expect, beforeEach, vi } from 'vitest'
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

  it('middle-click on Process List tab does not close it', async () => {
    useWorkspaceStore.getState().openProcessListTab('conn-1')
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const processListTab = tabs.find((t) => t.type === 'processlist')
    expect(processListTab).toBeDefined()

    render(<WorkspaceTabs connectionId="conn-1" />)

    await act(async () => {
      dispatchAuxClick(screen.getByTestId(`workspace-tab-${processListTab!.id}`))
    })

    expect(
      useWorkspaceStore.getState().tabsByConnection['conn-1'].some((t) => t.type === 'processlist')
    ).toBe(true)
  })

  it('shows icons for History and Process List tabs', () => {
    useWorkspaceStore.getState().openHistoryTab('conn-1', false)
    useWorkspaceStore.getState().openProcessListTab('conn-1')

    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(screen.getByTestId('workspace-tab-icon-history')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-tab-icon-processlist')).toBeInTheDocument()
  })

  it('shows distinct icons for other tab types', () => {
    useWorkspaceStore.getState().openTab({
      type: 'schema-info',
      label: 'orders',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'orders',
      objectType: 'table',
    })
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
      type: 'table-designer',
      label: 'users (design)',
      connectionId: 'conn-1',
      mode: 'alter',
      databaseName: 'mydb',
      objectName: 'users',
    })
    useWorkspaceStore.getState().openTab({
      type: 'object-editor',
      label: 'Stored Procedure: my_proc',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'my_proc',
      objectType: 'procedure',
      mode: 'alter',
    })

    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(screen.getByTestId('workspace-tab-icon-schema-info')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-tab-icon-table-data')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-tab-icon-query-editor')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-tab-icon-table-designer')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-tab-icon-object-editor-procedure')).toBeInTheDocument()
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

  it('shows dirty indicator on object-editor tabs when content changes', () => {
    useWorkspaceStore.getState().openTab({
      type: 'object-editor',
      label: 'Stored Procedure: my_proc',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'my_proc',
      objectType: 'procedure',
      mode: 'alter',
    })

    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    useObjectEditorStore.setState({
      tabs: {
        [tabId]: {
          connectionId: 'conn-1',
          database: 'mydb',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'SELECT 2',
          originalContent: 'SELECT 1',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(screen.getByTestId(`workspace-tab-${tabId}`)).toHaveTextContent(
      'Stored Procedure: my_proc ●'
    )
  })

  it('does not show dirty indicator for object-editor tabs without editor state', () => {
    useWorkspaceStore.getState().openTab({
      type: 'object-editor',
      label: 'Stored Procedure: my_proc',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'my_proc',
      objectType: 'procedure',
      mode: 'alter',
    })

    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(screen.getByTestId(`workspace-tab-${tabId}`)).not.toHaveTextContent('●')
  })

  it('does not show dirty indicator when object-editor content is unchanged', () => {
    useWorkspaceStore.getState().openTab({
      type: 'object-editor',
      label: 'Stored Procedure: my_proc',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'my_proc',
      objectType: 'procedure',
      mode: 'alter',
    })

    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    useObjectEditorStore.setState({
      tabs: {
        [tabId]: {
          connectionId: 'conn-1',
          database: 'mydb',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'SELECT 1',
          originalContent: 'SELECT 1',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<WorkspaceTabs connectionId="conn-1" />)

    expect(screen.getByTestId(`workspace-tab-${tabId}`)).not.toHaveTextContent('●')
  })

  it('prevents browser autoscroll by calling preventDefault on middle-button mousedown', () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })

    render(<WorkspaceTabs connectionId="conn-1" />)

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const tabEl = screen.getByTestId(`workspace-tab-${tabs[0].id}`)

    const mousedownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 1,
    })

    const preventDefaultSpy = vi.spyOn(mousedownEvent, 'preventDefault')
    tabEl.dispatchEvent(mousedownEvent)

    expect(preventDefaultSpy).toHaveBeenCalled()
  })
})
