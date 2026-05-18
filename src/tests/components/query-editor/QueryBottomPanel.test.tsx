import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryBottomPanel } from '../../../components/query-editor/QueryBottomPanel'
import { useQueryStore } from '../../../stores/query-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makeTabState } from '../../helpers/query-test-utils'
import * as ResultPanelModule from '../../../components/query-editor/ResultPanel'
import * as TableDataTabModule from '../../../components/table-data/TableDataTab'

// Use vi.spyOn to install per-test mock implementations without vi.mock().
// These stubs provide data-testid attributes the tests assert on.

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })

  vi.spyOn(ResultPanelModule, 'ResultPanel').mockImplementation((props) => {
    const p = props as unknown as Record<string, unknown>
    return (
      <div data-testid="result-panel-mock" data-hide-sub-tabs={String(p.hideSubTabs)}>
        results:{String(p.isActive)}
      </div>
    ) as unknown as React.ReactElement
  })

  vi.spyOn(TableDataTabModule, 'TableDataTab').mockImplementation((props) => (
    <div
      data-testid={`table-data-tab-mock-${props.tab.id}`}
      data-render-mode={String(props.renderMode)}
      data-active={String(props.isActive)}
    >
      {props.tab.label}
    </div>
  ) as unknown as React.ReactElement)
})

describe('QueryBottomPanel', () => {
  it('shows result content by default and hides scoped table panels', () => {
    useQueryStore.setState({
      tabs: {
        'query-1': makeTabState({
          connectionId: 'conn-1',
          status: 'success',
          activeBottomPanelItem: { type: 'result' },
        }),
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

    render(<QueryBottomPanel queryTabId="query-1" connectionId="conn-1" />)

    const resultTabPanel = screen.getByTestId('query-bottom-panel-results')
    expect(resultTabPanel).toHaveAttribute('id', 'result-tabpanel-query-1-0')
    expect(resultTabPanel).toHaveAttribute('aria-labelledby', 'result-query-1-0')
    expect(resultTabPanel).toBeVisible()
    expect(screen.getByTestId('result-panel-mock')).toHaveAttribute('data-hide-sub-tabs', 'true')
    const hiddenTablePanel = screen.getByTestId('query-bottom-panel-table-table-1')
    expect(hiddenTablePanel).toHaveAttribute('hidden')
    expect(hiddenTablePanel).not.toBeVisible()
    expect(screen.getByTestId('table-data-tab-mock-table-1')).toHaveAttribute(
      'data-active',
      'false'
    )
  })

  it('shows bottom-panel table content and resets to results when scoped tab disappears', async () => {
    useQueryStore.setState({
      tabs: {
        'query-1': makeTabState({
          connectionId: 'conn-1',
          status: 'success',
          activeBottomPanelItem: { type: 'table-data', tabId: 'table-1' },
        }),
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
          {
            id: 'table-2',
            type: 'table-data',
            label: 'orders',
            connectionId: 'conn-1',
            databaseName: 'app',
            objectName: 'orders',
            objectType: 'table',
            parentQueryTabId: 'query-1',
          },
        ],
      },
      activeTabByConnection: { 'conn-1': 'query-1' },
    })

    const { rerender } = render(<QueryBottomPanel queryTabId="query-1" connectionId="conn-1" />)

    expect(screen.getByTestId('query-bottom-panel-results')).toHaveAttribute('hidden')
    expect(screen.getByTestId('query-bottom-panel-results')).not.toBeVisible()
    expect(screen.getByTestId('query-bottom-panel-table-table-1')).toBeVisible()
    expect(screen.getByTestId('table-data-tab-mock-table-1')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('table-data-tab-mock-table-1')).toHaveAttribute(
      'data-render-mode',
      'bottom-panel'
    )

    act(() => {
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [
            {
              id: 'table-2',
              type: 'table-data',
              label: 'orders',
              connectionId: 'conn-1',
              databaseName: 'app',
              objectName: 'orders',
              objectType: 'table',
              parentQueryTabId: 'query-1',
            },
          ],
        },
      })
      rerender(<QueryBottomPanel queryTabId="query-1" connectionId="conn-1" />)
    })

    await waitFor(() => {
      expect(useQueryStore.getState().tabs['query-1']?.activeBottomPanelItem).toEqual({
        type: 'result',
      })
    })
  })

  it('keeps inactive scoped table-data tabs mounted while the query tab is active', () => {
    useQueryStore.setState({
      tabs: {
        'query-1': makeTabState({
          connectionId: 'conn-1',
          status: 'success',
          activeBottomPanelItem: { type: 'table-data', tabId: 'table-1' },
        }),
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
          {
            id: 'table-2',
            type: 'table-data',
            label: 'orders',
            connectionId: 'conn-1',
            databaseName: 'app',
            objectName: 'orders',
            objectType: 'table',
            parentQueryTabId: 'query-1',
          },
        ],
      },
      activeTabByConnection: { 'conn-1': 'query-1' },
    })

    render(<QueryBottomPanel queryTabId="query-1" connectionId="conn-1" />)

    expect(screen.getByTestId('query-bottom-panel-table-table-1')).not.toHaveAttribute('hidden')
    expect(screen.getByTestId('query-bottom-panel-table-table-1')).toBeVisible()
    expect(screen.getByTestId('query-bottom-panel-table-table-2')).toHaveAttribute('hidden')
    expect(screen.getByTestId('query-bottom-panel-table-table-2')).not.toBeVisible()
    expect(screen.getByTestId('table-data-tab-mock-table-1')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('table-data-tab-mock-table-2')).toHaveAttribute(
      'data-active',
      'false'
    )
  })

  it('renders a real panel target for each result tab and only mounts the active result content', () => {
    useQueryStore.setState({
      tabs: {
        'query-1': makeTabState({
          connectionId: 'conn-1',
          status: 'success',
          activeResultIndex: 1,
          activeBottomPanelItem: { type: 'result' },
          results: [
            { ...makeTabState({}).results[0] },
            { ...makeTabState({}).results[0], rows: [[2]] },
          ],
        }),
      },
    })
    useWorkspaceStore.setState({
      tabsByConnection: { 'conn-1': [] },
      activeTabByConnection: { 'conn-1': 'query-1' },
    })

    render(<QueryBottomPanel queryTabId="query-1" connectionId="conn-1" />)

    const resultPanels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(resultPanels).toHaveLength(2)
    const inactiveResultPanel = screen.getByTestId('query-bottom-panel-result-0')
    expect(inactiveResultPanel).toHaveAttribute('hidden')
    expect(inactiveResultPanel).not.toBeVisible()
    const activeResultPanel = screen.getByTestId('query-bottom-panel-results')
    expect(activeResultPanel).toHaveAttribute('id', 'result-tabpanel-query-1-1')
    expect(activeResultPanel).toBeVisible()
    expect(screen.getAllByTestId('result-panel-mock')).toHaveLength(1)
  })

  it('does not keep scoped table-data content mounted for inactive query tabs', () => {
    useQueryStore.setState({
      tabs: {
        'query-1': makeTabState({
          connectionId: 'conn-1',
          status: 'success',
          activeBottomPanelItem: { type: 'table-data', tabId: 'table-1' },
        }),
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

    render(<QueryBottomPanel queryTabId="query-1" connectionId="conn-1" isActive={false} />)

    expect(screen.getByTestId('query-bottom-panel-table-table-1')).toHaveAttribute('hidden')
    expect(screen.queryByTestId('table-data-tab-mock-table-1')).not.toBeInTheDocument()
  })
})
