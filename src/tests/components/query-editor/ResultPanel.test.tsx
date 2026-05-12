import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { DEFAULT_RESULT_STATE, useQueryStore } from '../../../stores/query-store'

vi.mock('../../../components/query-editor/ResultToolbar', () => ({
  ResultToolbar: ({ tabId }: { tabId: string }) => <div data-testid="result-toolbar">{tabId}</div>,
}))
vi.mock('../../../components/query-editor/ResultGridView', () => ({
  ResultGridView: ({ rows }: { rows: unknown[][] }) => (
    <div data-testid="grid-view">Grid rows: {rows.length}</div>
  ),
}))
vi.mock('../../../components/query-editor/ResultFormView', () => ({
  ResultFormView: ({ totalRows }: { totalRows: number }) => (
    <div data-testid="form-view">Form rows: {totalRows}</div>
  ),
}))
vi.mock('../../../components/query-editor/ResultTextView', () => ({
  ResultTextView: ({ rows }: { rows: unknown[][] }) => (
    <div data-testid="text-view">Text rows: {rows.length}</div>
  ),
}))
vi.mock('../../../components/dialogs/FilterDialog', () => ({
  FilterDialog: () => null,
}))

const result = {
  ...DEFAULT_RESULT_STATE,
  resultStatus: 'success' as const,
  columns: [{ name: 'id', dataType: 'INT' }],
  rows: [[1], [2]],
  totalRows: 2,
}

describe('ResultPanel', () => {
  beforeEach(() => {
    act(() => {
      useQueryStore.setState({
        tabs: {
          tab1: {
            content: '',
            selectedText: '',
            filePath: null,
            tabStatus: 'success',
            prevTabStatus: 'idle',
            cursorPosition: null,
            connectionId: 'c1',
            results: [result],
            activeResultIndex: 0,
            pendingNavigationAction: null,
            executionStartedAt: null,
            isCancelling: false,
            wasCancelled: false,
          },
        },
      })
    })
  })

  it('renders the grid result view and row count', () => {
    render(<ResultPanel tabId="tab1" connectionId="c1" />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('grid-view')).toHaveTextContent('Grid rows: 2')
  })

  it('switching view mode changes the rendered view', async () => {
    const user = userEvent.setup()
    render(<ResultPanel tabId="tab1" connectionId="c1" />)
    act(() => useQueryStore.getState().setViewMode('tab1', 'form'))
    expect(await screen.findByTestId('form-view')).toHaveTextContent('Form rows: 2')
    act(() => useQueryStore.getState().setViewMode('tab1', 'text'))
    await user.click(document.body)
    expect(await screen.findByTestId('text-view')).toHaveTextContent('Text rows: 2')
  })

  it('handles empty successful results', () => {
    act(() => {
      useQueryStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          tab1: {
            ...state.tabs.tab1,
            results: [{ ...result, columns: [], rows: [], affectedRows: 0 }],
          },
        },
      }))
    })
    render(<ResultPanel tabId="tab1" connectionId="c1" />)
    expect(screen.getByTestId('dml-success')).toHaveTextContent('Query executed successfully')
  })

  it('renders idle empty state when no results exist', () => {
    act(() => useQueryStore.setState({ tabs: {} }))
    render(<ResultPanel tabId="missing" connectionId="c1" />)
    expect(screen.getByText('Run a query to see results')).toBeInTheDocument()
  })
})
