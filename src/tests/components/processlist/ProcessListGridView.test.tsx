import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessListGridView } from '../../../components/processlist/ProcessListGridView'
import { useProcessListStore } from '../../../stores/processlist-store'
import type { ProcessRow } from '../../../lib/processlist-commands'

const mockCanvasBaseGridView = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => (
    <div data-testid="mock-canvas-grid" data-row-count={(props.rows as unknown[])?.length ?? 0} />
  ))
)

vi.mock('../../../components/shared/glide/CanvasBaseGridView', () => ({
  CanvasBaseGridView: mockCanvasBaseGridView,
}))

vi.mock('../../../components/processlist/InfoCellPopover', () => ({
  InfoCellPopover: ({ sql }: { sql: string | null }) =>
    sql ? <div data-testid="info-popover">{sql}</div> : null,
}))

const rows: ProcessRow[] = [
  {
    id: 2,
    user: 'bob',
    host: 'h2',
    db: 'app',
    command: 'Query',
    time: 4,
    state: 'run',
    info: 'SELECT 2',
  },
  { id: 1, user: 'ada', host: 'h1', db: null, command: 'Sleep', time: 9, state: null, info: '' },
]

describe('ProcessListGridView', () => {
  beforeEach(() => {
    mockCanvasBaseGridView.mockClear()
    act(() => {
      useProcessListStore.setState({
        rowsByConnection: { c1: rows },
        selectedIdsByConnection: {},
        excludeIdleConnectionsByConnection: { c1: false },
        sortColumnByConnection: {},
      })
    })
  })

  it('renders processes and passes showInfoColumn', () => {
    render(<ProcessListGridView connectionId="c1" />)
    expect(screen.getByTestId('mock-canvas-grid')).toHaveAttribute('data-row-count', '2')
    expect(mockCanvasBaseGridView.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ showInfoColumn: true, testId: 'processlist-grid-view' })
    )
  })

  it('handles an empty process list', () => {
    act(() => useProcessListStore.setState({ rowsByConnection: { c1: [] } }))
    render(<ProcessListGridView connectionId="c1" />)
    expect(screen.getByTestId('mock-canvas-grid')).toHaveAttribute('data-row-count', '0')
  })

  it('sorts and filters processes from store state', () => {
    act(() => {
      useProcessListStore.setState({
        excludeIdleConnectionsByConnection: { c1: true },
        sortColumnByConnection: { c1: { columnKey: 'time', direction: 'DESC' } },
      })
    })
    render(<ProcessListGridView connectionId="c1" />)
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as { rows: ProcessRow[] }
    expect(props.rows.map((row) => row.id)).toEqual([2])
  })

  it('updates sort and selected process ids through grid callbacks', () => {
    render(<ProcessListGridView connectionId="c1" />)
    const props = mockCanvasBaseGridView.mock.lastCall?.[0] as {
      onSortChange: (column: string | null, direction: 'ASC' | 'DESC' | null) => void
      onRowMarkersChange: (selectedRows: Record<string, unknown>[]) => void
      onInfoCellClick: (row: Record<string, unknown>, rect: DOMRect) => void
    }
    act(() => props.onSortChange('user', 'ASC'))
    expect(useProcessListStore.getState().sortColumnByConnection.c1).toEqual({
      columnKey: 'user',
      direction: 'ASC',
    })
    act(() => props.onRowMarkersChange([{ id: 2 }]))
    expect([...useProcessListStore.getState().selectedIdsByConnection.c1]).toEqual([2])
    act(() => props.onInfoCellClick({ info: 'SELECT 1' }, new DOMRect()))
    expect(screen.getByTestId('info-popover')).toHaveTextContent('SELECT 1')
  })
})
