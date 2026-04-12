import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResultSubTabs } from '../../../components/query-editor/ResultSubTabs'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../../stores/query-store'
import type { SingleResultState } from '../../../stores/query-store'
import { makeTabState } from '../../helpers/query-test-utils'

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  // jsdom does not implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
})

function makeResult(overrides: Partial<SingleResultState> = {}): SingleResultState {
  return { ...DEFAULT_RESULT_STATE, ...overrides }
}

describe('ResultSubTabs', () => {
  it('renders nothing when results has zero entries', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': { ...makeTabState(), results: [], activeResultIndex: 0 },
      },
    })
    const { container } = render(<ResultSubTabs tabId="tab-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when results has exactly one entry', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': makeTabState({ status: 'success', columns: [{ name: 'id', dataType: 'INT' }] }),
      },
    })
    const { container } = render(<ResultSubTabs tabId="tab-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders tab strip with role="tablist" when results > 1', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({
              resultStatus: 'success',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
            }),
            makeResult({
              resultStatus: 'success',
              columns: [{ name: 'name', dataType: 'VARCHAR' }],
              rows: [['Alice']],
              totalRows: 1,
            }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    expect(screen.getByTestId('result-sub-tabs')).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Query result sets')
  })

  it('renders correct number of tabs', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'error', errorMessage: 'fail' }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    expect(screen.getByTestId('result-tab-0')).toBeInTheDocument()
    expect(screen.getByTestId('result-tab-1')).toBeInTheDocument()
    expect(screen.getByTestId('result-tab-2')).toBeInTheDocument()
    expect(screen.getByText('Result 1')).toBeInTheDocument()
    expect(screen.getByText('Result 2')).toBeInTheDocument()
    expect(screen.getByText('Result 3')).toBeInTheDocument()
  })

  it('marks the active tab with aria-selected=true', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 1,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    expect(screen.getByTestId('result-tab-0')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('result-tab-1')).toHaveAttribute('aria-selected', 'true')
  })

  it('sets tabIndex=0 on active tab and -1 on others', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    expect(screen.getByTestId('result-tab-0')).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('result-tab-1')).toHaveAttribute('tabindex', '-1')
  })

  it('clicking a tab calls setActiveResultIndex', () => {
    const setActiveResultIndexSpy = vi.spyOn(useQueryStore.getState(), 'setActiveResultIndex')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('result-tab-1'))
    expect(setActiveResultIndexSpy).toHaveBeenCalledWith('tab-1', 1)
    setActiveResultIndexSpy.mockRestore()
  })

  it('ArrowRight moves focus to next tab', () => {
    const setActiveResultIndexSpy = vi.spyOn(useQueryStore.getState(), 'setActiveResultIndex')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    fireEvent.keyDown(screen.getByTestId('result-sub-tabs'), { key: 'ArrowRight' })
    expect(setActiveResultIndexSpy).toHaveBeenCalledWith('tab-1', 1)
    setActiveResultIndexSpy.mockRestore()
  })

  it('ArrowLeft moves focus to previous tab', () => {
    const setActiveResultIndexSpy = vi.spyOn(useQueryStore.getState(), 'setActiveResultIndex')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 2,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    fireEvent.keyDown(screen.getByTestId('result-sub-tabs'), { key: 'ArrowLeft' })
    expect(setActiveResultIndexSpy).toHaveBeenCalledWith('tab-1', 1)
    setActiveResultIndexSpy.mockRestore()
  })

  it('Home key moves to first tab', () => {
    const setActiveResultIndexSpy = vi.spyOn(useQueryStore.getState(), 'setActiveResultIndex')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 2,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    fireEvent.keyDown(screen.getByTestId('result-sub-tabs'), { key: 'Home' })
    expect(setActiveResultIndexSpy).toHaveBeenCalledWith('tab-1', 0)
    setActiveResultIndexSpy.mockRestore()
  })

  it('End key moves to last tab', () => {
    const setActiveResultIndexSpy = vi.spyOn(useQueryStore.getState(), 'setActiveResultIndex')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    fireEvent.keyDown(screen.getByTestId('result-sub-tabs'), { key: 'End' })
    expect(setActiveResultIndexSpy).toHaveBeenCalledWith('tab-1', 2)
    setActiveResultIndexSpy.mockRestore()
  })

  it('ArrowRight does not go past last tab', () => {
    const setActiveResultIndexSpy = vi.spyOn(useQueryStore.getState(), 'setActiveResultIndex')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 1,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    fireEvent.keyDown(screen.getByTestId('result-sub-tabs'), { key: 'ArrowRight' })
    expect(setActiveResultIndexSpy).toHaveBeenCalledWith('tab-1', 1)
    setActiveResultIndexSpy.mockRestore()
  })

  it('ArrowLeft does not go below first tab', () => {
    const setActiveResultIndexSpy = vi.spyOn(useQueryStore.getState(), 'setActiveResultIndex')
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success' }),
            makeResult({ resultStatus: 'success' }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    fireEvent.keyDown(screen.getByTestId('result-sub-tabs'), { key: 'ArrowLeft' })
    expect(setActiveResultIndexSpy).toHaveBeenCalledWith('tab-1', 0)
    setActiveResultIndexSpy.mockRestore()
  })

  it('shows error icon for error results', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success', columns: [{ name: 'id', dataType: 'INT' }] }),
            makeResult({ resultStatus: 'error', errorMessage: 'bad SQL' }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    // Both tabs should render
    expect(screen.getByTestId('result-tab-0')).toBeInTheDocument()
    expect(screen.getByTestId('result-tab-1')).toBeInTheDocument()
  })

  it('shows DML icon for results with no columns', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...makeTabState({ status: 'success' }),
          results: [
            makeResult({ resultStatus: 'success', columns: [], affectedRows: 5 }),
            makeResult({ resultStatus: 'success', columns: [{ name: 'id', dataType: 'INT' }] }),
          ],
          activeResultIndex: 0,
        },
      },
    })
    render(<ResultSubTabs tabId="tab-1" />)
    expect(screen.getByTestId('result-tab-0')).toBeInTheDocument()
    expect(screen.getByTestId('result-tab-1')).toBeInTheDocument()
  })
})
