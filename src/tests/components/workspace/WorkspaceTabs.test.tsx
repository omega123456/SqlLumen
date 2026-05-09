import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('right-click (auxclick button 2) on a tab does NOT close it', async () => {
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
      const tabEl = screen.getByTestId(`workspace-tab-${tabId}`)
      tabEl.dispatchEvent(
        new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 })
      )
    })

    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(1)
  })

  it('scrolls newly active tab into view when active tab changes', async () => {
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock

    // Open two tabs
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

    // Reset mock after initial render
    scrollIntoViewMock.mockClear()

    // Click the first tab to switch to it
    const user = userEvent.setup()
    await user.click(screen.getByText('users'))

    // The active tab element should have been scrolled into view
    expect(scrollIntoViewMock).toHaveBeenCalled()
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

  it('renders the "+" button outside the scrollable tab area', () => {
    render(<WorkspaceTabs connectionId="conn-1" />)
    const tabBar = screen.getByTestId('workspace-tabs')
    const plusButton = screen.getByTestId('new-query-tab-button')

    // The "+" button should NOT be a direct child of the scrollable container.
    // It should be outside it so it remains always visible.
    expect(plusButton.parentElement).not.toBe(tabBar)
  })

  it('renders history and processlist tabs outside the scrollable tab area', () => {
    act(() => {
      useWorkspaceStore.getState().openHistoryTab('conn-1')
      useWorkspaceStore.getState().openProcessListTab('conn-1')
    })

    render(<WorkspaceTabs connectionId="conn-1" />)
    const tabBar = screen.getByTestId('workspace-tabs')
    const historyTab = screen.getByText('History').closest('[data-testid^="workspace-tab-"]')!
    const processlistTab = screen
      .getByText('Process List')
      .closest('[data-testid^="workspace-tab-"]')!

    // History and processlist tabs should be pinned outside the scrollable area
    expect(historyTab.parentElement).not.toBe(tabBar)
    expect(processlistTab.parentElement).not.toBe(tabBar)
  })

  it('opens tab context menu with Shift+F10 and triggers rename action for query tabs', async () => {
    const user = userEvent.setup()
    const onRequestRenameTab = vi.fn()
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query A')

    render(<WorkspaceTabs connectionId="conn-1" onRequestRenameTab={onRequestRenameTab} />)

    const tabLabelButton = screen
      .getByText('Query A')
      .closest('[role="button"]') as HTMLElement
    tabLabelButton.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')

    await user.click(screen.getByTestId('tab-context-menu-item-rename'))
    expect(onRequestRenameTab).toHaveBeenCalledWith(tabId)
  })

  it('shows move actions disabled when movement is not possible', async () => {
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    render(<WorkspaceTabs connectionId="conn-1" onRequestMoveTab={vi.fn()} />)

    fireEvent.contextMenu(screen.getByTestId(`workspace-tab-${tabId}`), {
      clientX: 100,
      clientY: 120,
    })

    expect(screen.getByTestId('tab-context-menu-item-move-left')).toBeDisabled()
    expect(screen.getByTestId('tab-context-menu-item-move-right')).toBeDisabled()
    expect(screen.getByTestId('tab-context-menu-item-move-start')).toBeDisabled()
    expect(screen.getByTestId('tab-context-menu-item-move-end')).toBeDisabled()
  })

  it('renames a query tab on double-click and Enter', async () => {
    const user = userEvent.setup()
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    render(<WorkspaceTabs connectionId="conn-1" />)

    await user.dblClick(screen.getByText('Query 1'))
    const renameInput = screen.getByTestId('workspace-tab-rename-input')
    await user.clear(renameInput)
    await user.type(renameInput, 'Revenue-Query{Enter}')

    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'].find((t) => t.id === tabId)
    expect(tab?.label).toBe('Revenue-Query')
    expect(screen.getByText('Revenue-Query')).toBeInTheDocument()
  })

  it('supports rename with F2, Escape cancel, and rejects blank commit', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Original')
    render(<WorkspaceTabs connectionId="conn-1" />)

    const tabButton = screen.getByText('Original').closest('[role="button"]') as HTMLElement
    tabButton.focus()
    await user.keyboard('{F2}')
    const firstRenameInput = screen.getByTestId('workspace-tab-rename-input')
    await user.clear(firstRenameInput)
    await user.type(firstRenameInput, 'Updated{Escape}')
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1'][0].label).toBe('Original')
    expect(tabButton).toHaveFocus()

    tabButton.focus()
    await user.keyboard('{F2}')
    const renameInput = screen.getByTestId('workspace-tab-rename-input')
    await user.clear(renameInput)
    await user.type(renameInput, '   {Enter}')
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1'][0].label).toBe('Original')
  })

  it('right-click inside rename input does not open tab context menu', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    render(<WorkspaceTabs connectionId="conn-1" />)

    await user.dblClick(screen.getByText('Query 1'))
    const renameInput = screen.getByTestId('workspace-tab-rename-input')
    fireEvent.contextMenu(renameInput, { clientX: 120, clientY: 80 })

    expect(screen.queryByTestId('tab-context-menu')).not.toBeInTheDocument()
  })

  it('opens context menu with Menu key, anchors from tab rect, and restores focus on close', async () => {
    const user = userEvent.setup()
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query A')
    render(<WorkspaceTabs connectionId="conn-1" />)

    const tabEl = screen.getByTestId(`workspace-tab-${tabId}`)
    vi.spyOn(tabEl, 'getBoundingClientRect').mockReturnValue({
      left: 44,
      top: 22,
      right: 144,
      bottom: 66,
      width: 100,
      height: 44,
      x: 44,
      y: 22,
      toJSON: () => ({}),
    })

    const tabButton = tabEl.querySelector('[role="button"]') as HTMLElement
    tabButton.focus()
    await user.keyboard('{ContextMenu}')

    const menu = screen.getByTestId('tab-context-menu')
    expect(menu).toBeInTheDocument()
    expect(menu.style.left).not.toBe('')
    expect(menu.style.top).not.toBe('')

    await user.keyboard('{Escape}')
    expect(tabButton).toHaveFocus()
  })

  it('moves query tabs via context-menu move actions', async () => {
    const user = userEvent.setup()
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const q2 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')
    const q3 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q3')
    render(<WorkspaceTabs connectionId="conn-1" />)

    fireEvent.contextMenu(screen.getByTestId(`workspace-tab-${q2}`), {
      clientX: 120,
      clientY: 120,
    })
    await user.click(screen.getByTestId('tab-context-menu-item-move-left'))
    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1']
        .filter((tab) => tab.type === 'query-editor')
        .map((tab) => tab.id)
    ).toEqual([q2, q1, q3])

    fireEvent.contextMenu(screen.getByTestId(`workspace-tab-${q2}`), {
      clientX: 120,
      clientY: 120,
    })
    await user.click(screen.getByTestId('tab-context-menu-item-move-right'))
    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1']
        .filter((tab) => tab.type === 'query-editor')
        .map((tab) => tab.id)
    ).toEqual([q1, q2, q3])

    fireEvent.contextMenu(screen.getByTestId(`workspace-tab-${q1}`), {
      clientX: 120,
      clientY: 120,
    })
    await user.click(screen.getByTestId('tab-context-menu-item-move-end'))
    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1']
        .filter((tab) => tab.type === 'query-editor')
        .map((tab) => tab.id)
    ).toEqual([q2, q3, q1])

    fireEvent.contextMenu(screen.getByTestId(`workspace-tab-${q1}`), {
      clientX: 120,
      clientY: 120,
    })
    await user.click(screen.getByTestId('tab-context-menu-item-move-start'))
    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1']
        .filter((tab) => tab.type === 'query-editor')
        .map((tab) => tab.id)
    ).toEqual([q1, q2, q3])
  })

  it('reorders movable tabs via drag and drop and keeps pinned tabs fixed', () => {
    useWorkspaceStore.getState().openHistoryTab('conn-1', false)
    useWorkspaceStore.getState().openProcessListTab('conn-1')
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const q2 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')
    const q3 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q3')
    render(<WorkspaceTabs connectionId="conn-1" />)

    const draggingTab = screen.getByTestId(`workspace-tab-${q3}`)
    const targetTab = screen.getByTestId(`workspace-tab-${q1}`)
    vi.spyOn(targetTab, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 0,
      right: 200,
      bottom: 30,
      width: 100,
      height: 30,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(draggingTab, { button: 0, clientX: 260, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 198, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 198, clientY: 15 })

    const ordered = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(ordered[0].type).toBe('history')
    expect(ordered[1].type).toBe('processlist')
    expect(ordered.slice(2).map((tab) => tab.id)).toEqual([q1, q3, q2])
  })

  it('does not reorder when pointer drag starts from the close button', () => {
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const q2 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')
    render(<WorkspaceTabs connectionId="conn-1" />)

    const closeButton = screen.getByLabelText('Close Q2')
    const tab = screen.getByTestId(`workspace-tab-${q2}`)
    fireEvent.pointerDown(closeButton, { button: 0, clientX: 210, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 120, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 120, clientY: 15 })

    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1']
        .filter((entry) => entry.type === 'query-editor')
        .map((entry) => entry.id)
    ).toEqual([q1, q2])
  })

  it('starts pointer reorder from the tab container body (not only label hotspot)', async () => {
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const q2 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')
    render(<WorkspaceTabs connectionId="conn-1" />)

    const tab = screen.getByTestId(`workspace-tab-${q1}`)
    const targetTab = screen.getByTestId(`workspace-tab-${q2}`)
    vi.spyOn(targetTab, 'getBoundingClientRect').mockReturnValue({
      left: 220,
      top: 0,
      right: 320,
      bottom: 30,
      width: 100,
      height: 30,
      x: 220,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(tab, { button: 0, clientX: 180, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 222, clientY: 15 })

    await waitFor(() => expect(tab.className).toContain('dragging'))
    fireEvent.pointerUp(window, { clientX: 222, clientY: 15 })

    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1']
        .filter((entry) => entry.type === 'query-editor')
        .map((entry) => entry.id)
    ).toEqual([q1, q2])
  })

  it('does not start pointer reorder for pinned tabs', () => {
    useWorkspaceStore.getState().openHistoryTab('conn-1')
    useWorkspaceStore.getState().openProcessListTab('conn-1')
    render(<WorkspaceTabs connectionId="conn-1" />)

    const historyTab = screen.getByText('History').closest('[data-testid^="workspace-tab-"]')
    const processTab = screen
      .getByText('Process List')
      .closest('[data-testid^="workspace-tab-"]')

    fireEvent.pointerDown(historyTab, { button: 0, clientX: 180, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 188, clientY: 15 })
    expect(historyTab?.className ?? '').not.toContain('dragging')

    fireEvent.pointerDown(processTab, { button: 0, clientX: 180, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 188, clientY: 15 })
    expect(processTab?.className ?? '').not.toContain('dragging')
  })
})
