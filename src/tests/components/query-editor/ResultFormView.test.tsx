import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ResultFormView } from '../../../components/query-editor/ResultFormView'
import { useQueryStore } from '../../../stores/query-store'
import type { ColumnMeta } from '../../../types/schema'

// Mock the clipboard utility
const mockWriteClipboardText = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../lib/context-menu-utils', () => ({
  writeClipboardText: (...args: unknown[]) => mockWriteClipboardText(...args),
}))

const columns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'email', dataType: 'VARCHAR' },
]

const rows: unknown[][] = [
  [1, 'Alice', 'alice@example.com'],
  [2, 'Bob', null],
  [3, 'Charlie', 'charlie@example.com'],
  [4, 'Dave', 'dave@example.com'],
  [5, null, 'eve@example.com'],
]

const defaultProps = {
  columns,
  rows,
  selectedRowIndex: 0 as number | null,
  totalRows: 5,
  currentPage: 1,
  totalPages: 1,
  onNavigate: vi.fn(),
  tabId: 'tab-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIPC(() => null)
  // Set up query store with tab state (so pageSize is accessible)
  useQueryStore.setState({
    tabs: {
      'tab-1': {
        content: '',
        filePath: null,
        status: 'success',
        columns,
        rows,
        totalRows: 5,
        executionTimeMs: 10,
        affectedRows: 0,
        queryId: 'q1',
        currentPage: 1,
        totalPages: 1,
        pageSize: 1000,
        autoLimitApplied: false,
        errorMessage: null,
        cursorPosition: null,
        viewMode: 'form',
        sortColumn: null,
        sortDirection: null,
        selectedRowIndex: 0,
        exportDialogOpen: false,
        lastExecutedSql: null,
      },
    },
  })
})

describe('ResultFormView', () => {
  it('renders with data-testid="result-form-view"', () => {
    render(<ResultFormView {...defaultProps} />)
    expect(screen.getByTestId('result-form-view')).toBeInTheDocument()
  })

  it('shows "Record 1 of 5" heading when selectedRowIndex is 0', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={0} />)
    expect(screen.getByText('Record 1 of 5')).toBeInTheDocument()
  })

  it('shows "Record 3 of 5" heading when selectedRowIndex is 2', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} />)
    expect(screen.getByText('Record 3 of 5')).toBeInTheDocument()
  })

  it('defaults to first record when selectedRowIndex is null', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={null} />)
    expect(screen.getByText('Record 1 of 5')).toBeInTheDocument()
  })

  it('shows all column names as uppercase labels', () => {
    render(<ResultFormView {...defaultProps} />)
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('NAME')).toBeInTheDocument()
    expect(screen.getByText('EMAIL')).toBeInTheDocument()
  })

  it('shows all values for the selected row', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={0} />)
    expect(screen.getByTestId('field-value-0')).toHaveTextContent('1')
    expect(screen.getByTestId('field-value-1')).toHaveTextContent('Alice')
    expect(screen.getByTestId('field-value-2')).toHaveTextContent('alice@example.com')
  })

  it('shows NULL as italic "NULL" for null values', () => {
    // Row index 1: [2, 'Bob', null] — email is null
    render(<ResultFormView {...defaultProps} selectedRowIndex={1} />)
    const emailField = screen.getByTestId('field-value-2')
    expect(emailField).toHaveTextContent('NULL')
    // Check that it has the null styling class
    expect(emailField.className).toContain('nullValue')
  })

  it('shows NULL for undefined values', () => {
    // Row index 4: [5, null, 'eve@example.com'] — name is null
    render(<ResultFormView {...defaultProps} selectedRowIndex={4} />)
    const nameField = screen.getByTestId('field-value-1')
    expect(nameField).toHaveTextContent('NULL')
    expect(nameField.className).toContain('nullValue')
  })

  it('Previous button calls onNavigate("prev")', () => {
    const onNavigate = vi.fn()
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByTestId('prev-record-button'))
    expect(onNavigate).toHaveBeenCalledWith('prev')
  })

  it('Next button calls onNavigate("next")', () => {
    const onNavigate = vi.fn()
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByTestId('next-record-button'))
    expect(onNavigate).toHaveBeenCalledWith('next')
  })

  it('Previous button is disabled on first record', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={0} />)
    expect(screen.getByTestId('prev-record-button')).toBeDisabled()
  })

  it('Next button is disabled on last record', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={4} />)
    expect(screen.getByTestId('next-record-button')).toBeDisabled()
  })

  it('both navigation buttons enabled for middle records', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} />)
    expect(screen.getByTestId('prev-record-button')).not.toBeDisabled()
    expect(screen.getByTestId('next-record-button')).not.toBeDisabled()
  })

  it('copy button calls writeClipboardText with field value', async () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={0} />)
    fireEvent.click(screen.getByTestId('copy-field-1'))
    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledWith('Alice')
    })
  })

  it('copy button copies "NULL" for null values', async () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={1} />)
    // email field (index 2) is null for row 1
    fireEvent.click(screen.getByTestId('copy-field-2'))
    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledWith('NULL')
    })
  })

  it('renders with empty rows without crashing', () => {
    render(<ResultFormView {...defaultProps} rows={[]} totalRows={0} />)
    expect(screen.getByTestId('result-form-view')).toBeInTheDocument()
    expect(screen.getByText('Record 1 of 0')).toBeInTheDocument()
  })

  it('shows correct values for different selected rows', () => {
    // Select row 2 (Charlie)
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} />)
    expect(screen.getByTestId('field-value-0')).toHaveTextContent('3')
    expect(screen.getByTestId('field-value-1')).toHaveTextContent('Charlie')
    expect(screen.getByTestId('field-value-2')).toHaveTextContent('charlie@example.com')
  })

  it('has copy buttons for all fields', () => {
    render(<ResultFormView {...defaultProps} />)
    columns.forEach((_, i) => {
      expect(screen.getByTestId(`copy-field-${i}`)).toBeInTheDocument()
    })
  })

  it('has aria-labels on navigation buttons', () => {
    render(<ResultFormView {...defaultProps} />)
    expect(screen.getByLabelText('Previous record')).toBeInTheDocument()
    expect(screen.getByLabelText('Next record')).toBeInTheDocument()
  })
})
