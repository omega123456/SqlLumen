import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTextView } from '../../../../components/shared/data-view/DataTextView'
import { formatTextOutput } from '../../../../components/shared/data-view/text-format'
import { useQueryStore } from '../../../../stores/query-store'
import { expectToast, ipc } from '../../../ipc-mock'
import { DATA_VIEW_TAB_ID, seedDataView } from '../../../helpers/data-view-test-utils'
import type { ColumnMeta } from '../../../../types/schema'

// Real context-menu-utils is used. In jsdom, writeClipboardText falls through to
// navigator.clipboard.writeText (polyfilled in setup.ts as a vi.fn).

const columns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'email', dataType: 'VARCHAR' },
]

const rows: unknown[][] = [
  [1, 'Alice', 'alice@example.com'],
  [2, 'Bob', null],
  [3, 'Charlie', 'charlie@example.com'],
]

beforeEach(() => {
  vi.clearAllMocks()
})

interface TextViewSetup {
  viewRowCount?: number
  loaded?: unknown[][]
  truncated?: boolean
}

function renderTextView({
  viewRowCount = rows.length,
  loaded = rows,
  truncated,
}: TextViewSetup = {}) {
  const source = seedDataView({
    columns: columns,
    rows: loaded,
    viewRowCount: viewRowCount,
    truncated: truncated,
  })
  return render(<DataTextView source={source} />)
}

describe('DataTextView', () => {
  it('renders the rows of the current view from the page cache', async () => {
    renderTextView()
    expect(screen.getByTestId('result-text-view')).toBeInTheDocument()
    await waitFor(() => {
      const text = screen.getByTestId('result-text-view').querySelector('pre')!.textContent!
      expect(text).toContain('id')
      expect(text).toContain('Alice')
      expect(text).toContain('Charlie')
      expect(text).toContain('NULL')
    })
    expect(ipc.payloads('fetch_result_window')).toHaveLength(0)
  })

  it('shows "Copy all" without a strip when the view has at most 5,000 rows', async () => {
    renderTextView()
    expect(await screen.findByText('Copy all')).toBeInTheDocument()
    expect(screen.queryByTestId('result-text-view-cap-strip')).not.toBeInTheDocument()
  })

  it('Copy all writes the formatted text through the clipboard helper', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderTextView()
    await waitFor(() => expect(screen.getByTestId('copy-all-button')).toBeEnabled())
    await user.click(screen.getByTestId('copy-all-button'))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(formatTextOutput(columns, rows))
    })
  })

  it('shows a Copy failed toast when the clipboard write fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
    renderTextView()
    await waitFor(() => expect(screen.getByTestId('copy-all-button')).toBeEnabled())
    await user.click(screen.getByTestId('copy-all-button'))
    await expectToast('error', 'Copy failed')
    await expectToast('error', "Couldn't load all selected rows. Nothing was copied. Try again.")
  })

  it('caps at 5,000 rows with the strip and the relabelled shared Button', async () => {
    ipc.overridePayload('fetch_result_window', (args) => {
      const offset = Number(args?.offset)
      const limit = Number(args?.limit)
      const windowRows = Array.from({ length: limit }, (_, i) => [offset + i, 'x', null])
      return {
        offset,
        rows: windowRows,
        baseIndices: windowRows.map((row) => row[0] as number),
        viewRowCount: 12340,
        viewVersion: 1,
      }
    })
    renderTextView({ viewRowCount: 12340, loaded: [] })

    const strip = await screen.findByTestId('result-text-view-cap-strip')
    expect(strip).toHaveTextContent('Showing first 5,000 of 12,340 rows in this view.')
    const button = screen.getByTestId('copy-all-button')
    expect(button).toHaveTextContent('Copy first 5,000')
    expect(button).toHaveAttribute(
      'title',
      'Copies the rows shown. Export all rows for the full result.'
    )
    await waitFor(() => {
      const text = screen.getByTestId('result-text-view').querySelector('pre')!.textContent!
      expect(text.split('\n')).toHaveLength(5002)
    })
    const calls = ipc.payloads('fetch_result_window') as Array<Record<string, number>>
    expect(calls.reduce((sum, call) => sum + call.limit, 0)).toBe(5000)
    expect(Math.max(...calls.map((call) => call.limit))).toBeLessThanOrEqual(2000)
  })

  it('uses the truncated copy when the result hit the row ceiling', async () => {
    ipc.overridePayload('fetch_result_window', (args) => ({
      offset: Number(args?.offset),
      rows: [],
      baseIndices: [],
      viewRowCount: 100000,
      viewVersion: 1,
    }))
    renderTextView({ viewRowCount: 100000, loaded: [], truncated: true })
    expect(await screen.findByTestId('result-text-view-cap-strip')).toHaveTextContent(
      'Showing first 5,000 of 100,000+ rows · truncated'
    )
  })

  it('routes results_expired to the expired block and logs other load failures', async () => {
    ipc.override('fetch_result_window', () => {
      throw new Error('results_expired: gone')
    })
    renderTextView({ viewRowCount: 9000, loaded: [] })
    await waitFor(() =>
      expect(
        useQueryStore.getState().tabs[DATA_VIEW_TAB_ID]!.results[0].view.residency.isExpired
      ).toBe(true)
    )
  })

  it('shows an error toast when rows cannot be loaded', async () => {
    ipc.override('fetch_result_window', () => {
      throw new Error('offline')
    })
    renderTextView({ viewRowCount: 9000, loaded: [] })
    await expectToast('error', "Couldn't load rows")
  })

  it('renders only the header for an empty view', () => {
    renderTextView({ viewRowCount: 0, loaded: [] })
    const text = screen.getByTestId('result-text-view').querySelector('pre')!.textContent!
    expect(text.split('\n')).toHaveLength(2)
  })
})
