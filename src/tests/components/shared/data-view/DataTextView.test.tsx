import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTextView } from '../../../../components/shared/data-view/DataTextView'
import { TextTableLayout } from '../../../../components/shared/data-view/text-format'
import { useQueryStore } from '../../../../stores/query-store'
import { expectToast, ipc } from '../../../ipc-mock'
import { DATA_VIEW_TAB_ID, seedDataView } from '../../../helpers/data-view-test-utils'
import type { ColumnMeta } from '../../../../types/schema'

// Real context-menu-utils is used. In jsdom, writeClipboardText falls through to
// navigator.clipboard.writeText (polyfilled in setup.ts as a vi.fn).

const JSDOM_TEXT_LINE_HEIGHT_PX = 21

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

function renderedRowTexts(): string[] {
  return screen.getAllByTestId('text-view-row').map((row) => row.textContent ?? '')
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
      const text = renderedRowTexts().join('\n')
      expect(text).toContain('Alice')
      expect(text).toContain('Charlie')
      expect(text).toContain('NULL')
    })
    expect(screen.getByTestId('text-view-header')).toHaveTextContent(/^id\s+name\s+email/)
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
      expect(writeText).toHaveBeenCalledWith(TextTableLayout.fromRows(columns, rows).fullText())
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
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
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
    await waitFor(() => expect(button).toBeEnabled())
    const scroller = screen.getByTestId('text-view-scroller')
    expect(scroller).toHaveAttribute('aria-busy', 'false')
    const initialRows = renderedRowTexts()
    expect(initialRows.length).toBeLessThan(100)
    expect(initialRows[0]).toMatch(/^0\s/)

    scroller.scrollTop = JSDOM_TEXT_LINE_HEIGHT_PX * 3000
    fireEvent.scroll(scroller)
    await waitFor(() => expect(renderedRowTexts()).toContainEqual(expect.stringMatching(/^3000\s/)))
    expect(renderedRowTexts().length).toBeLessThan(100)

    await user.click(button)
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(String(writeText.mock.calls[0][0]).split('\n')).toHaveLength(5002)
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
    expect(screen.getByTestId('text-view-header')).toHaveTextContent(/^id\s+name\s+email/)
    expect(screen.queryByTestId('text-view-row')).not.toBeInTheDocument()
  })
})
