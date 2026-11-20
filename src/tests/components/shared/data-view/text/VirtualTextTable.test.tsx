import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VirtualTextTable } from '../../../../../components/shared/data-view/text/VirtualTextTable'
import { TextTableLayout } from '../../../../../components/shared/data-view/text-format'
import type { ColumnMeta } from '../../../../../types/schema'

const JSDOM_TEXT_LINE_HEIGHT_PX = 21

const CHARACTER_WIDTH_PX = 8

const VIEWPORT_WIDTH_PX = 800

const columns: ColumnMeta[] = [{ name: 'id', dataType: 'INT' }]

function layoutWithRows(rowCount: number): TextTableLayout {
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => [rowIndex])
  return TextTableLayout.fromRows(columns, rows)
}

function wideLayout(): TextTableLayout {
  const wideColumns: ColumnMeta[] = Array.from({ length: 20 }, (_, columnIndex) => ({
    name: `column_${columnIndex}`,
    dataType: 'VARCHAR',
  }))
  const wideRows = Array.from({ length: 3 }, (_, rowIndex) =>
    wideColumns.map((_, columnIndex) => `value_${rowIndex}_${columnIndex}_padding_text`)
  )
  return TextTableLayout.fromRows(wideColumns, wideRows)
}

function scrollTo(scroller: HTMLElement, position: { top: number; left: number }) {
  scroller.scrollTop = position.top
  scroller.scrollLeft = position.left
  fireEvent.scroll(scroller)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VirtualTextTable', () => {
  it('renders no stale rows when a scrolled table gets a shorter layout', () => {
    const { rerender } = render(
      <VirtualTextTable layout={layoutWithRows(5000)} topSpacing="strip" isBusy={false} />
    )
    const scroller = screen.getByTestId('text-view-scroller')
    scrollTo(scroller, { top: JSDOM_TEXT_LINE_HEIGHT_PX * 3000, left: 0 })
    expect(screen.getAllByTestId('text-view-row')[0]).toHaveTextContent(/^2944/)

    rerender(<VirtualTextTable layout={layoutWithRows(0)} topSpacing="strip" isBusy />)
    expect(screen.queryByTestId('text-view-row')).not.toBeInTheDocument()
    expect(scroller).toHaveAttribute('aria-busy', 'true')
  })

  it('keeps rendered rows in place while the table scrolls', () => {
    render(<VirtualTextTable layout={layoutWithRows(5000)} topSpacing="strip" isBusy={false} />)
    const scroller = screen.getByTestId('text-view-scroller')
    const firstRow = screen.getAllByTestId('text-view-row')[0]

    scrollTo(scroller, { top: JSDOM_TEXT_LINE_HEIGHT_PX * 40, left: 0 })

    const rowsAfterScroll = screen.getAllByTestId('text-view-row')
    expect(rowsAfterScroll[0]).toBe(firstRow)
    expect(firstRow.parentElement).toHaveStyle({ top: '0px' })
    expect(rowsAfterScroll).toHaveLength(96)
  })

  it('renders only the visible characters of each line and of the header', () => {
    const layout = wideLayout()
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(
      layout.lineLength * CHARACTER_WIDTH_PX
    )
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH_PX)
    render(<VirtualTextTable layout={layout} topSpacing="strip" isBusy={false} />)

    scrollTo(screen.getByTestId('text-view-scroller'), { top: 0, left: CHARACTER_WIDTH_PX * 200 })

    const rowTexts = screen.getAllByTestId('text-view-row').map((row) => row.textContent)
    expect(rowTexts).toEqual([0, 1, 2].map((rowIndex) => layout.rowLine(rowIndex).slice(128, 384)))
    expect(screen.getByTestId('text-view-header').textContent).toBe(
      layout.headerLine().slice(128, 384)
    )
  })
})
