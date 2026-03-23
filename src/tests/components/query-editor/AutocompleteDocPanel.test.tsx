import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AutocompleteDocPanel } from '../../../components/query-editor/AutocompleteDocPanel'

// Mock the AutocompleteProvider module
let subscribedCallback: ((item: unknown) => void) | null = null
const mockGetDocItem = vi.fn()

vi.mock('../../../components/query-editor/AutocompleteProvider', () => ({
  subscribeDocItem: (fn: (item: unknown) => void) => {
    subscribedCallback = fn
    return () => {
      subscribedCallback = null
    }
  },
  getDocItem: () => mockGetDocItem(),
}))

// Mock MutationObserver
let observerCallback: MutationCallback | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

class MockMutationObserver {
  constructor(callback: MutationCallback) {
    observerCallback = callback
  }
  observe = mockObserve
  disconnect = mockDisconnect
  takeRecords = vi.fn(() => [])
}

beforeEach(() => {
  vi.clearAllMocks()
  observerCallback = null
  subscribedCallback = null
  mockGetDocItem.mockReturnValue(null)
  vi.stubGlobal('MutationObserver', MockMutationObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Clean up any suggest-widget elements
  document.querySelectorAll('.suggest-widget').forEach((el) => el.remove())
})

function createSuggestWidget() {
  const widget = document.createElement('div')
  widget.className = 'suggest-widget visible'
  Object.defineProperty(widget, 'offsetHeight', { value: 200, configurable: true })
  widget.getBoundingClientRect = () => ({
    top: 100,
    left: 50,
    right: 300,
    bottom: 300,
    width: 250,
    height: 200,
    x: 50,
    y: 100,
    toJSON: () => ({}),
  })
  document.body.appendChild(widget)
  return widget
}

function simulateMutation() {
  if (observerCallback) {
    act(() => {
      observerCallback!([], {} as MutationObserver)
    })
  }
}

describe('AutocompleteDocPanel', () => {
  it('does not render when suggest widget is not visible', () => {
    render(<AutocompleteDocPanel connectionId="conn-1" />)
    expect(screen.queryByTestId('autocomplete-doc-panel')).not.toBeInTheDocument()
  })

  it('renders with data-testid when suggest widget is visible', () => {
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    createSuggestWidget()
    simulateMutation()

    expect(screen.getByTestId('autocomplete-doc-panel')).toBeInTheDocument()
  })

  it('shows placeholder when no item selected', () => {
    mockGetDocItem.mockReturnValue(null)
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    createSuggestWidget()
    simulateMutation()

    expect(screen.getByText('Select a suggestion to see documentation')).toBeInTheDocument()
  })

  it('shows DOCUMENTATION header', () => {
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    createSuggestWidget()
    simulateMutation()

    expect(screen.getByText('DOCUMENTATION')).toBeInTheDocument()
  })

  it('shows table metadata when a table item is selected', () => {
    const tableItem = {
      type: 'table' as const,
      name: 'users',
      database: 'app_db',
      tableInfo: {
        name: 'users',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 1000,
        dataSize: 1048576,
      },
      columnCount: 5,
    }
    mockGetDocItem.mockReturnValue(tableItem)
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    createSuggestWidget()
    simulateMutation()

    // Now update the doc item via subscription
    if (subscribedCallback) {
      act(() => {
        subscribedCallback!(tableItem)
      })
    }

    expect(screen.getByText('app_db.users')).toBeInTheDocument()
    expect(screen.getByText('InnoDB')).toBeInTheDocument()
    expect(screen.getByText('utf8mb4')).toBeInTheDocument()
    expect(screen.getByText('~1,000')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows column metadata when a column item is selected', () => {
    const columnItem = {
      type: 'column' as const,
      name: 'email',
      database: 'app_db',
      table: 'users',
      dataType: 'varchar(255)',
    }
    mockGetDocItem.mockReturnValue(columnItem)
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    createSuggestWidget()
    simulateMutation()

    if (subscribedCallback) {
      act(() => {
        subscribedCallback!(columnItem)
      })
    }

    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('varchar(255)')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('app_db')).toBeInTheDocument()
  })

  it('shows keyword type when a keyword item is selected', () => {
    const keywordItem = {
      type: 'keyword' as const,
      name: 'SELECT',
    }
    mockGetDocItem.mockReturnValue(keywordItem)
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    createSuggestWidget()
    simulateMutation()

    if (subscribedCallback) {
      act(() => {
        subscribedCallback!(keywordItem)
      })
    }

    expect(screen.getByText('SELECT')).toBeInTheDocument()
    expect(screen.getByText('SQL Keyword')).toBeInTheDocument()
  })

  it('hides when suggest widget loses visible class', () => {
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    // First show it
    const widget = createSuggestWidget()
    simulateMutation()
    expect(screen.getByTestId('autocomplete-doc-panel')).toBeInTheDocument()

    // Now hide the suggest widget
    widget.className = 'suggest-widget'
    simulateMutation()
    expect(screen.queryByTestId('autocomplete-doc-panel')).not.toBeInTheDocument()
  })

  it('hides when suggest widget is removed from DOM', () => {
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    const widget = createSuggestWidget()
    simulateMutation()
    expect(screen.getByTestId('autocomplete-doc-panel')).toBeInTheDocument()

    widget.remove()
    simulateMutation()
    expect(screen.queryByTestId('autocomplete-doc-panel')).not.toBeInTheDocument()
  })

  it('positions itself to the right of the suggest widget', () => {
    render(<AutocompleteDocPanel connectionId="conn-1" />)

    createSuggestWidget()
    simulateMutation()

    const panel = screen.getByTestId('autocomplete-doc-panel')
    expect(panel.style.position).toBe('fixed')
    expect(panel.style.top).toBe('100px')
    expect(panel.style.left).toBe('300px')
    expect(panel.style.zIndex).toBe('10000')
  })

  it('observes document.body for mutations', () => {
    render(<AutocompleteDocPanel connectionId="conn-1" />)
    expect(mockObserve).toHaveBeenCalledWith(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
  })

  it('disconnects observer on unmount', () => {
    const { unmount } = render(<AutocompleteDocPanel connectionId="conn-1" />)
    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
  })
})
