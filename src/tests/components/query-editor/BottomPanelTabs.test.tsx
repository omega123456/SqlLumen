import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomPanelTabs } from '../../../components/query-editor/BottomPanelTabs'
import { DEFAULT_RESULT_STATE, useQueryStore } from '../../../stores/query-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
})

describe('BottomPanelTabs', () => {
  it('renders combined result and table-data tabs and activates them', async () => {
    const user = userEvent.setup()

    useQueryStore.setState({
      tabs: {
        'query-1': {
          content: '',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'error',
              errorMessage: 'broken',
            },
          ],
          activeResultIndex: 0,
          activeBottomPanelItem: { type: 'result' },
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'query-1',
            type: 'query-editor',
            label: 'Query 1',
            connectionId: 'conn-1',
          },
          {
            id: 'table-1',
            type: 'table-data',
            label: 'users',
            connectionId: 'conn-1',
            databaseName: 'app',
            objectName: 'users',
            objectType: 'table',
            parentQueryTabId: 'query-1',
          },
        ],
      },
      activeTabByConnection: { 'conn-1': 'query-1' },
    })

    render(<BottomPanelTabs queryTabId="query-1" connectionId="conn-1" />)

    expect(screen.getByRole('tab', { name: /result 1/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /result 1/i })).toHaveAttribute(
      'aria-controls',
      'result-tabpanel-query-1-0'
    )
    expect(screen.getByRole('tab', { name: /result 2/i })).toHaveAttribute(
      'aria-controls',
      'result-tabpanel-query-1-1'
    )
    expect(screen.getByRole('tab', { name: /users/i })).toHaveAttribute(
      'aria-controls',
      'table-data-tabpanel-table-1'
    )
    expect(screen.getByRole('tab', { name: /users/i })).toBeInTheDocument()
    expect(screen.getByTestId('bottom-panel-tabs-separator')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /users/i }))

    expect(useQueryStore.getState().tabs['query-1']?.activeBottomPanelItem).toEqual({
      type: 'table-data',
      tabId: 'table-1',
    })

    await user.keyboard('{ArrowLeft}')

    expect(useQueryStore.getState().tabs['query-1']?.activeBottomPanelItem).toEqual({
      type: 'result',
    })
    expect(useQueryStore.getState().tabs['query-1']?.activeResultIndex).toBe(1)
  })

  it('does not render a separator when only result tabs are present', () => {
    useQueryStore.setState({
      tabs: {
        'query-1': {
          ...useQueryStore.getState().tabs['query-1'],
          content: '',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            { ...DEFAULT_RESULT_STATE, resultStatus: 'success' },
            { ...DEFAULT_RESULT_STATE, resultStatus: 'success' },
          ],
          activeResultIndex: 0,
          activeBottomPanelItem: { type: 'result' },
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
    useWorkspaceStore.setState({
      tabsByConnection: { 'conn-1': [] },
      activeTabByConnection: { 'conn-1': 'query-1' },
    })

    render(<BottomPanelTabs queryTabId="query-1" connectionId="conn-1" />)

    expect(screen.queryByTestId('bottom-panel-tabs-separator')).not.toBeInTheDocument()
  })

  it('closes scoped table-data tabs from close button and middle click', async () => {
    const user = userEvent.setup()
    const closeTabSpy = vi
      .spyOn(useWorkspaceStore.getState(), 'closeTab')
      .mockImplementation(() => undefined)

    useQueryStore.setState({
      tabs: {
        'query-1': {
          content: '',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [{ ...DEFAULT_RESULT_STATE, resultStatus: 'success' }],
          activeResultIndex: 0,
          activeBottomPanelItem: { type: 'table-data', tabId: 'table-1' },
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'table-1',
            type: 'table-data',
            label: 'users',
            connectionId: 'conn-1',
            databaseName: 'app',
            objectName: 'users',
            objectType: 'table',
            parentQueryTabId: 'query-1',
          },
        ],
      },
      activeTabByConnection: { 'conn-1': 'query-1' },
    })

    render(<BottomPanelTabs queryTabId="query-1" connectionId="conn-1" />)

    screen
      .getByTestId('bottom-panel-table-tab-table-1')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 1 }))
    expect(closeTabSpy).toHaveBeenCalledWith('conn-1', 'table-1')

    await user.click(screen.getByTestId('bottom-panel-close-table-1'))
    expect(closeTabSpy).toHaveBeenCalledWith('conn-1', 'table-1')
    expect(closeTabSpy).toHaveBeenCalledTimes(2)
  })
})
