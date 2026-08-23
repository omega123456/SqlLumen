import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { dispatchAuxClick } from '../../helpers/dispatch-aux-click'
import userEvent from '@testing-library/user-event'
import { WorkspaceTabs } from '../../../components/workspace/WorkspaceTabs'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { resetWorkspaceStore } from '../../helpers/workspace-test-utils'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useObjectEditorStore } from '../../../stores/object-editor-store'

beforeEach(() => {
  resetWorkspaceStore()
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      'results.tableTabsInBottomPanel': 'false',
    },
  }))
  useTableDesignerStore.setState({ tabs: {} })
  useObjectEditorStore.setState({ tabs: {} })
})

function setCompactWorkspaceTabsWidth(width: number) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      const testId = this.getAttribute?.('data-testid')
      if (testId === 'workspace-tabs') {
        return width
      }
      return original?.get ? original.get.call(this) : 1024
    },
  })

  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
      return
    }
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
  }
}

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
    expect(screen.getByTestId('workspace-stack-chip-tables')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-stack-chip-schema')).toBeInTheDocument()
    expect(screen.queryByText('users')).not.toBeInTheDocument()
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
      dispatchAuxClick(screen.getByTestId('workspace-pinned-tab-history'))
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
      dispatchAuxClick(screen.getByTestId('workspace-pinned-tab-processlist'))
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

  it('shows distinct icons for other tab types', async () => {
    const user = userEvent.setup()
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

    expect(screen.getByTestId('workspace-stack-icon-schema')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-stack-icon-tables')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-stack-icon-queries')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-stack-icon-designers')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-stack-icon-objects')).toBeInTheDocument()

    await user.click(screen.getByTestId('workspace-stack-chip-schema'))
    expect(screen.getByTestId('workspace-tab-icon-schema-info')).toBeInTheDocument()

    await user.click(screen.getByTestId('workspace-stack-chip-tables'))
    expect(screen.getByTestId('workspace-tab-icon-table-data')).toBeInTheDocument()

    await user.click(screen.getByTestId('workspace-stack-chip-queries'))
    expect(screen.getByTestId('workspace-tab-icon-query-editor')).toBeInTheDocument()

    await user.click(screen.getByTestId('workspace-stack-chip-designers'))
    expect(screen.getByTestId('workspace-tab-icon-table-designer')).toBeInTheDocument()

    await user.click(screen.getByTestId('workspace-stack-chip-objects'))
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

  it('supports horizontal top-row keyboard navigation from the "+" button', async () => {
    const user = userEvent.setup()

    act(() => {
      useWorkspaceStore.getState().openTab({
        type: 'table-data',
        label: 'users',
        connectionId: 'conn-1',
        databaseName: 'mydb',
        objectName: 'users',
        objectType: 'table',
      })
      useWorkspaceStore.getState().openHistoryTab('conn-1')
      useWorkspaceStore.getState().openProcessListTab('conn-1')
    })

    render(<WorkspaceTabs connectionId="conn-1" />)

    const plusButton = screen.getByTestId('new-query-tab-button')
    const tablesChip = screen.getByTestId('workspace-stack-chip-tables')
    const historyTab = screen.getByTestId('workspace-pinned-tab-history')
    const processListTab = screen.getByTestId('workspace-pinned-tab-processlist')

    plusButton.focus()
    expect(plusButton).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(tablesChip).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(plusButton).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(historyTab).toHaveFocus()

    await user.keyboard('{Home}')
    expect(tablesChip).toHaveFocus()

    await user.keyboard('{End}')
    expect(processListTab).toHaveFocus()
  })

  it('hands focus down from the active stack chip into the visible member row and back up', async () => {
    const user = userEvent.setup()
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query A')
    const queryTab = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.id === queryTabId)

    if (!queryTab) {
      throw new Error('Expected query tab to exist')
    }

    render(<WorkspaceTabs connectionId="conn-1" />)

    const queryStackChip = screen.getByTestId('workspace-stack-chip-queries')
    const memberTab = screen
      .getByTestId(`workspace-tab-${queryTabId}`)
      .querySelector('[role="button"]')

    if (!memberTab) {
      throw new Error('Expected workspace member tab label button to exist')
    }

    queryStackChip.focus()
    expect(queryStackChip).toHaveFocus()

    await user.keyboard('{ArrowDown}')

    await waitFor(() => {
      expect(memberTab).toHaveFocus()
    })

    await user.keyboard('{ArrowUp}')
    expect(queryStackChip).toHaveFocus()
    expect(screen.getByTestId(`workspace-tab-${queryTabId}`)).toHaveTextContent(queryTab.label)
  })

  it('ArrowDown uses the focused stack chip even when another stack or pinned tab is active', async () => {
    const user = userEvent.setup()
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query A')
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    useWorkspaceStore.getState().openHistoryTab('conn-1', false)

    render(<WorkspaceTabs connectionId="conn-1" />)

    await user.click(screen.getByTestId('workspace-pinned-tab-history'))
    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection[
          'conn-1'
        ].find((tab) => tab.id === useWorkspaceStore.getState().activeTabByConnection['conn-1'])
        ?.type
    ).toBe('history')

    const queryStackChip = screen.getByTestId('workspace-stack-chip-queries')

    queryStackChip.focus()
    expect(queryStackChip).toHaveFocus()

    await user.keyboard('{ArrowDown}')

    await waitFor(() => {
      const memberTab = screen
        .getByTestId(`workspace-tab-${queryTabId}`)
        .querySelector('[role="button"]')

      if (!memberTab) {
        throw new Error('Expected workspace member tab label button to exist')
      }

      expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTabId)
      expect(memberTab).toHaveFocus()
    })
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

  it('suppresses the active-tab scroll-into-view lookup while the connection is inactive', () => {
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

    render(<WorkspaceTabs connectionId="conn-1" connectionActive={false} />)

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    // The WorkspaceTabs scroll effect resolves its target via
    // document.querySelector('[data-testid="workspace-tab-<id>"]'). While the
    // connection is hidden and inert, that lookup must be skipped entirely.
    const querySpy = vi.spyOn(document, 'querySelector')

    act(() => {
      useWorkspaceStore.getState().setActiveTab('conn-1', tabs[0].id)
    })

    const lookedUpActiveTab = querySpy.mock.calls.some(
      ([selector]) => selector === `[data-testid="workspace-tab-${tabs[0].id}"]`
    )
    expect(lookedUpActiveTab).toBe(false)

    querySpy.mockRestore()
  })

  it('runs the active-tab scroll-into-view lookup while the connection is active', () => {
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock

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

    render(<WorkspaceTabs connectionId="conn-1" connectionActive={true} />)

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    scrollIntoViewMock.mockClear()

    act(() => {
      useWorkspaceStore.getState().setActiveTab('conn-1', tabs[0].id)
    })

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
    const memberRow = screen.queryByTestId('workspace-tab-members')
    const plusButton = screen.getByTestId('new-query-tab-button')

    expect(memberRow?.contains(plusButton) ?? false).toBe(false)
  })

  it('renders history and processlist tabs outside the scrollable tab area', () => {
    act(() => {
      useWorkspaceStore.getState().openHistoryTab('conn-1')
      useWorkspaceStore.getState().openProcessListTab('conn-1')
    })

    render(<WorkspaceTabs connectionId="conn-1" />)
    const memberRow = screen.queryByTestId('workspace-tab-members')
    const historyTab = screen.getByTestId('workspace-pinned-tab-history')
    const processlistTab = screen.getByTestId('workspace-pinned-tab-processlist')

    expect(memberRow?.contains(historyTab) ?? false).toBe(false)
    expect(memberRow?.contains(processlistTab) ?? false).toBe(false)
  })

  it('gives compact stack chips a real accessible name on the focusable control', () => {
    const restoreWidth = setCompactWorkspaceTabsWidth(230)

    try {
      useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
      useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 2')

      render(<WorkspaceTabs connectionId="conn-1" />)

      expect(screen.getByLabelText('Queries stack, 2 tabs')).toHaveAttribute(
        'data-testid',
        'workspace-stack-chip-queries'
      )
    } finally {
      restoreWidth()
    }
  })

  it('abbreviates pinned tabs in compact modes while preserving full accessible labels', () => {
    const restoreWidth = setCompactWorkspaceTabsWidth(230)

    try {
      act(() => {
        useWorkspaceStore.getState().openHistoryTab('conn-1')
        useWorkspaceStore.getState().openProcessListTab('conn-1')
        useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
        useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 2')
      })

      render(<WorkspaceTabs connectionId="conn-1" />)

      const historyTab = screen.getByLabelText('History')
      const processListTab = screen.getByLabelText('Process List')
      expect(historyTab).toHaveTextContent('Hist')
      expect(historyTab).not.toHaveTextContent('History')
      expect(processListTab).toHaveTextContent('Proc')
      expect(processListTab).not.toHaveTextContent('Process List')
    } finally {
      restoreWidth()
    }
  })

  it('activates the most recent tab in a stack when clicking its stack chip', async () => {
    const user = userEvent.setup()

    const queryA = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query A')
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const queryB = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query B')

    render(<WorkspaceTabs connectionId="conn-1" />)

    act(() => {
      useWorkspaceStore.getState().setActiveTab('conn-1', queryA)
      useWorkspaceStore.getState().setActiveTab('conn-1', queryB)
      useWorkspaceStore.getState().setActiveTab('conn-1', queryA)
    })

    await user.click(screen.getByTestId('workspace-stack-chip-queries'))

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryA)
  })

  it('falls back to the first visible stack member when no recency exists', async () => {
    const user = userEvent.setup()

    const queryA = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query A')
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Query B')

    useWorkspaceStore.setState((state) => ({
      stackRecencyByConnection: {
        ...state.stackRecencyByConnection,
        'conn-1': {},
      },
      activeTabByConnection: {
        ...state.activeTabByConnection,
        'conn-1': null,
      },
    }))

    render(<WorkspaceTabs connectionId="conn-1" />)

    await user.click(screen.getByTestId('workspace-stack-chip-queries'))

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryA)
  })

  it('does not activate a different stack when navigation is blocked on the current tab', async () => {
    const user = userEvent.setup()

    const activeQueryId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query A')
    const tableTabId = (() => {
      useWorkspaceStore.getState().openTab({
        type: 'table-data',
        label: 'users',
        connectionId: 'conn-1',
        databaseName: 'mydb',
        objectName: 'users',
        objectType: 'table',
      })
      return useWorkspaceStore.getState().activeTabByConnection['conn-1']
    })()
    act(() => {
      useWorkspaceStore.getState().setActiveTab('conn-1', activeQueryId)
    })
    expect(tableTabId).not.toBe(activeQueryId)
    useWorkspaceStore.getState().setBlockingNavigation(activeQueryId, true)

    render(<WorkspaceTabs connectionId="conn-1" />)

    await user.click(screen.getByTestId('workspace-stack-chip-tables'))

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(activeQueryId)
    expect(screen.queryByText('users')).not.toBeInTheDocument()
  })

  it('opens tab context menu with Shift+F10 and triggers rename action for query tabs', async () => {
    const user = userEvent.setup()
    const onRequestRenameTab = vi.fn()
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query A')

    render(<WorkspaceTabs connectionId="conn-1" onRequestRenameTab={onRequestRenameTab} />)

    const tabLabelButton = screen.getByText('Query A').closest('[role="button"]') as HTMLElement
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
        .tabsByConnection['conn-1'].filter((tab) => tab.type === 'query-editor')
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
        .tabsByConnection['conn-1'].filter((tab) => tab.type === 'query-editor')
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
        .tabsByConnection['conn-1'].filter((tab) => tab.type === 'query-editor')
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
        .tabsByConnection['conn-1'].filter((tab) => tab.type === 'query-editor')
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
    fireEvent.pointerDown(closeButton, { button: 0, clientX: 210, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 120, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 120, clientY: 15 })

    expect(
      useWorkspaceStore
        .getState()
        .tabsByConnection['conn-1'].filter((entry) => entry.type === 'query-editor')
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
        .tabsByConnection['conn-1'].filter((entry) => entry.type === 'query-editor')
        .map((entry) => entry.id)
    ).toEqual([q1, q2])
  })

  it('with hideTableDataTabs=true, only scoped table-data tabs are excluded from the top rail', () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      activeTabByConnection: {
        ...state.activeTabByConnection,
        'conn-1': 'query-a',
      },
      tabsByConnection: {
        ...state.tabsByConnection,
        'conn-1': [
          {
            id: 'query-a',
            type: 'query-editor',
            label: 'Query A',
            connectionId: 'conn-1',
          },
          {
            id: 'scoped-users',
            type: 'table-data',
            label: 'users',
            connectionId: 'conn-1',
            databaseName: 'mydb',
            objectName: 'users',
            objectType: 'table',
            parentQueryTabId: 'query-a',
          },
          {
            id: 'scoped-orders',
            type: 'table-data',
            label: 'orders',
            connectionId: 'conn-1',
            databaseName: 'mydb',
            objectName: 'orders',
            objectType: 'table',
            parentQueryTabId: 'query-a',
          },
          {
            id: 'table-data-products-standalone',
            type: 'table-data',
            label: 'products',
            connectionId: 'conn-1',
            databaseName: 'mydb',
            objectName: 'products',
            objectType: 'table',
          },
        ],
      },
    }))

    render(<WorkspaceTabs connectionId="conn-1" hideTableDataTabs={true} />)
    const stackRail = screen.getByTestId('workspace-tabs')

    expect(within(stackRail).getByText('Queries')).toBeInTheDocument()
    expect(within(stackRail).getByText('Tables')).toBeInTheDocument()
    expect(within(stackRail).queryByText('users')).not.toBeInTheDocument()
    expect(within(stackRail).queryByText('orders')).not.toBeInTheDocument()
    expect(screen.queryByText('products')).not.toBeInTheDocument()
  })

  it('does not start pointer reorder for pinned tabs', () => {
    useWorkspaceStore.getState().openHistoryTab('conn-1')
    useWorkspaceStore.getState().openProcessListTab('conn-1')
    render(<WorkspaceTabs connectionId="conn-1" />)

    const historyTab = screen.getByTestId('workspace-pinned-tab-history')
    const processTab = screen.getByTestId('workspace-pinned-tab-processlist')

    if (historyTab === null || processTab === null) {
      throw new Error('Expected pinned tabs to be rendered')
    }

    fireEvent.pointerDown(historyTab, { button: 0, clientX: 180, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 188, clientY: 15 })
    expect(historyTab?.className ?? '').not.toContain('dragging')

    fireEvent.pointerDown(processTab, { button: 0, clientX: 180, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 188, clientY: 15 })
    expect(processTab?.className ?? '').not.toContain('dragging')
  })
})

// ---------------------------------------------------------------------------
// WorkspaceTabRail — filtered visible group and safe subset reorder tests
// ---------------------------------------------------------------------------

import { WorkspaceTabRail } from '../../../components/workspace/WorkspaceTabRail'

describe('WorkspaceTabRail — filtered visible group rendering', () => {
  it('renders only the tabs passed in the visible group', () => {
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')
    useWorkspaceStore.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      objectType: 'table',
    })
    const allTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    // Only pass the first tab (Q1) as the visible group
    const visibleGroup = allTabs.filter((t) => t.id === q1)
    const allMovableTabIds = allTabs.map((t) => t.id)

    render(
      <WorkspaceTabRail
        connectionId="conn-1"
        tabs={visibleGroup}
        allMovableTabIds={allMovableTabIds}
        activeTabId={null}
      />
    )

    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.queryByText('Q2')).not.toBeInTheDocument()
    expect(screen.queryByText('users')).not.toBeInTheDocument()
  })

  it('activates a tab in a filtered visible group', async () => {
    const user = userEvent.setup()
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const q2 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')
    const allTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const allMovableTabIds = allTabs.map((t) => t.id)

    render(
      <WorkspaceTabRail
        connectionId="conn-1"
        tabs={allTabs}
        allMovableTabIds={allMovableTabIds}
        activeTabId={q2}
      />
    )

    await user.click(screen.getByText('Q1'))
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(q1)
  })

  it('closing a tab in a visible group removes it from the store', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const allTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const allMovableTabIds = allTabs.map((t) => t.id)

    render(
      <WorkspaceTabRail
        connectionId="conn-1"
        tabs={allTabs}
        allMovableTabIds={allMovableTabIds}
        activeTabId={null}
      />
    )

    await user.click(screen.getByLabelText('Close Q1'))
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(0)
  })
})

describe('WorkspaceTabRail — safe subset reorder', () => {
  /**
   * Full list: [pinned-history, pinned-processlist, A, B, C, D]
   * Visible group (subset): [A, C]   (B and D are intentionally excluded)
   * allMovableTabIds: [A, B, C, D]
   *
   * Reordering C before A (subsetInsertIndex=0) should translate to full list
   * insertIndex=0 (before A in the movable list), giving result [C, A, B, D].
   */
  it('reordering in a filtered subset does not disturb tabs outside the visible group', () => {
    const a = useWorkspaceStore.getState().openQueryTab('conn-1', 'A')
    const b = useWorkspaceStore.getState().openQueryTab('conn-1', 'B')
    const c = useWorkspaceStore.getState().openQueryTab('conn-1', 'C')
    const d = useWorkspaceStore.getState().openQueryTab('conn-1', 'D')
    const allTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const allMovableTabIds = [a, b, c, d]
    // Visible group contains only A and C
    const visibleGroup = allTabs.filter((t) => t.id === a || t.id === c)

    render(
      <WorkspaceTabRail
        connectionId="conn-1"
        tabs={visibleGroup}
        allMovableTabIds={allMovableTabIds}
        activeTabId={null}
      />
    )

    const draggingTab = screen.getByTestId(`workspace-tab-${c}`)
    const targetTab = screen.getByTestId(`workspace-tab-${a}`)

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

    // Drag C over the left half of A → drop before A → subsetInsertIndex=0 → fullInsertIndex=0
    fireEvent.pointerDown(draggingTab, { button: 0, clientX: 260, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 130, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 130, clientY: 15 })

    const ordered = useWorkspaceStore.getState().tabsByConnection['conn-1']
    // C moved before A; B and D should remain in their original relative positions
    const movableOrder = ordered.filter((t) => [a, b, c, d].includes(t.id)).map((t) => t.id)
    expect(movableOrder).toEqual([c, a, b, d])
  })

  it('reordering to end of visible subset inserts after last visible tab in full list', () => {
    const a = useWorkspaceStore.getState().openQueryTab('conn-1', 'A')
    const b = useWorkspaceStore.getState().openQueryTab('conn-1', 'B')
    const c = useWorkspaceStore.getState().openQueryTab('conn-1', 'C')
    const allTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const allMovableTabIds = [a, b, c]
    // Visible group contains only A and B; C is outside the visible group
    const visibleGroup = allTabs.filter((t) => t.id === a || t.id === b)

    render(
      <WorkspaceTabRail
        connectionId="conn-1"
        tabs={visibleGroup}
        allMovableTabIds={allMovableTabIds}
        activeTabId={null}
      />
    )

    const draggingTab = screen.getByTestId(`workspace-tab-${a}`)
    const targetTab = screen.getByTestId(`workspace-tab-${b}`)

    vi.spyOn(targetTab, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      top: 0,
      right: 300,
      bottom: 30,
      width: 100,
      height: 30,
      x: 200,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    // Drag A over right half of B → drop after B → subsetInsertIndex=2 → fullInsertIndex=2
    // (after B, before C — C must stay after B in the full list)
    fireEvent.pointerDown(draggingTab, { button: 0, clientX: 120, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 270, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 270, clientY: 15 })

    const ordered = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const movableOrder = ordered.filter((t) => [a, b, c].includes(t.id)).map((t) => t.id)
    // A moved after B; C stays after B
    expect(movableOrder).toEqual([b, a, c])
  })

  it('calls onRequestReorderTab with full-list insert index when reordering in subset', () => {
    const onRequestReorderTab = vi.fn()
    const a = useWorkspaceStore.getState().openQueryTab('conn-1', 'A')
    const b = useWorkspaceStore.getState().openQueryTab('conn-1', 'B')
    const c = useWorkspaceStore.getState().openQueryTab('conn-1', 'C')
    const allTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    // Visible group: A and C; B is outside the group
    const visibleGroup = allTabs.filter((t) => t.id === a || t.id === c)
    const allMovableTabIds = [a, b, c]

    render(
      <WorkspaceTabRail
        connectionId="conn-1"
        tabs={visibleGroup}
        allMovableTabIds={allMovableTabIds}
        activeTabId={null}
        onRequestReorderTab={onRequestReorderTab}
      />
    )

    const draggingTab = screen.getByTestId(`workspace-tab-${c}`)
    const targetTab = screen.getByTestId(`workspace-tab-${a}`)

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

    // Drag C before A → subsetInsertIndex=0 → should translate to fullInsertIndex=0
    fireEvent.pointerDown(draggingTab, { button: 0, clientX: 260, clientY: 15 })
    fireEvent.pointerMove(window, { clientX: 130, clientY: 15 })
    fireEvent.pointerUp(window, { clientX: 130, clientY: 15 })

    expect(onRequestReorderTab).toHaveBeenCalledWith(c, 0)
  })
})
