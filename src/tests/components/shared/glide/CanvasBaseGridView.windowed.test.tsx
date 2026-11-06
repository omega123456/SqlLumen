/**
 * CanvasBaseGridView in windowed mode (a row source backed by a page cache):
 * loading cells and the skeleton draw, visible-range reporting and repaint,
 * Glide's copy keybinding off, a never-fetching getCellsForSelection, and the
 * fetch-first Copy / Cut / Clear / Paste paths (D21, wireframe 8).
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { CompactSelection, GridCellKind, type GridSelection } from '@glideapps/glide-data-grid'
import {
  CanvasBaseGridView,
  type GridRowActions,
} from '../../../../components/shared/glide/CanvasBaseGridView'
import * as GlideDataGridModule from '../../../../components/shared/glide/GlideDataGrid'
import type { GridRowSource, RowRange } from '../../../../components/shared/glide/grid-row-source'
import { useToastStore } from '../../../../stores/toast-store'
import { expectToast } from '../../../ipc-mock'

type Row = Record<string, unknown>

const originalGlideDataGrid = GlideDataGridModule.GlideDataGrid
const mockGlideDataGrid = vi.fn()
const mockUpdateCells = vi.fn()

const columns = [
  {
    key: 'name',
    displayName: 'Name',
    dataType: 'VARCHAR',
    editable: true,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
]

type ReadRange = NonNullable<GridRowSource<Row>['readRange']>

interface FakeSource extends GridRowSource<Row> {
  readRange: Mock<ReadRange>
  onVisibleRangeChange: Mock<(range: RowRange) => void>
  emit: (range: RowRange, info?: { reseeded: boolean }) => void
}

/** A windowed source of `rowCount` rows where only `loaded` positions are in memory. */
function fakeSource(
  rowCount: number,
  loaded: Set<number>,
  read: (range: RowRange) => Promise<Row[]> = async ([start, end]) =>
    Array.from({ length: end - start }, (_, offset) => ({ name: `row ${start + offset}` }))
): FakeSource {
  const listeners = new Set<(range: RowRange, info?: { reseeded: boolean }) => void>()
  return {
    kind: 'windowed',
    rowCount,
    getRow: (index) => (loaded.has(index) ? { name: `row ${index}` } : undefined),
    isLoaded: (index) => loaded.has(index),
    onVisibleRangeChange: vi.fn<(range: RowRange) => void>(),
    readRange: vi.fn<ReadRange>(async (range, options) => {
      const rows = await read(range)
      options?.onProgress?.({ done: rows.length, total: rows.length })
      return rows
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: (range, info) => listeners.forEach((listener) => listener(range, info)),
  }
}

function fakeRowActions(visible = false) {
  const finish = vi.fn(() => visible)
  const update = vi.fn()
  const actions: GridRowActions & { begin: ReturnType<typeof vi.fn> } = {
    begin: vi.fn(() => ({ update, finish })),
    onExpired: vi.fn(),
  }
  return { actions, update, finish }
}

type GridProps = {
  rows: unknown[]
  rowCount?: number
  keybindings?: { copy: boolean; cut: boolean }
  getCellContent: (cell: [number, number]) => { kind: string; copyData?: string }
  getCellsForSelection?: (rect: { x: number; y: number; width: number; height: number }) => unknown
  onVisibleRegionChanged: (range: { x: number; y: number; width: number; height: number }) => void
  onKeyDown: (event: Record<string, unknown>) => void
  onDelete: (selection: GridSelection) => boolean
  onPaste: (target: [number, number], values: string[][]) => boolean
  onSelectionChange: (selection: GridSelection) => void
  drawCell: (args: Record<string, unknown>, drawContent: () => void) => void
}

function gridProps(): GridProps {
  return mockGlideDataGrid.mock.lastCall?.[0] as GridProps
}

function selection(rows: CompactSelection, current?: GridSelection['current']): GridSelection {
  return { rows, columns: CompactSelection.empty(), current }
}

function rangeSelection(y: number, height: number): GridSelection {
  return selection(CompactSelection.empty(), {
    cell: [0, y],
    range: { x: 0, y, width: 1, height },
    rangeStack: [],
  })
}

function keyEvent(key: string, extra: Record<string, unknown> = {}) {
  return { key, metaKey: false, ctrlKey: false, preventDefault: vi.fn(), cancel: vi.fn(), ...extra }
}

beforeEach(() => {
  mockGlideDataGrid.mockClear()
  mockUpdateCells.mockClear()
  useToastStore.setState({ toasts: [] })
  Object.defineProperty(GlideDataGridModule, 'GlideDataGrid', {
    value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockGlideDataGrid(props)
      React.useImperativeHandle(ref, () => ({
        selectCell: vi.fn(),
        scrollToCell: vi.fn(),
        updateCells: mockUpdateCells,
        element: null,
      }))
      return React.createElement('div', { 'data-testid': 'glide' }, 'glide')
    }),
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(GlideDataGridModule, 'GlideDataGrid', {
    value: originalGlideDataGrid,
    writable: true,
    configurable: true,
  })
})

function renderWindowed(
  source: GridRowSource<Row>,
  props: Partial<React.ComponentProps<typeof CanvasBaseGridView>> = {}
) {
  return render(
    <CanvasBaseGridView
      rows={[]}
      rowSource={source}
      columns={columns}
      editState={null}
      isEditMode={true}
      editableColumnKeys={new Set(['name'])}
      {...props}
    />
  )
}

async function setSelection(next: GridSelection) {
  await act(async () => {
    gridProps().onSelectionChange(next)
  })
}

describe('CanvasBaseGridView — windowed rendering', () => {
  it('passes the row count, turns off Glide copy/cut and serves loading cells for unloaded rows', () => {
    const source = fakeSource(5000, new Set([0, 1]))
    renderWindowed(source)
    const props = gridProps()
    expect(props.rows).toEqual([])
    expect(props.rowCount).toBe(5000)
    expect(props.keybindings).toEqual({ copy: false, cut: false })
    expect(props.getCellContent([0, 0]).kind).toBe(GridCellKind.Text)
    expect(props.getCellContent([0, 4000]).kind).toBe(GridCellKind.Loading)
  })

  it('getCellsForSelection serves loaded cells only and never fetches', () => {
    const source = fakeSource(5000, new Set([0]))
    renderWindowed(source)
    const cells = gridProps().getCellsForSelection?.({ x: 0, y: 0, width: 1, height: 3 }) as Array<
      Array<{ kind: string }>
    >
    expect(cells.map((row) => row[0].kind)).toEqual([
      GridCellKind.Text,
      GridCellKind.Loading,
      GridCellKind.Loading,
    ])
    expect(source.readRange).not.toHaveBeenCalled()
  })

  it('keeps array mode on Glide copy with getCellsForSelection = true', () => {
    render(<CanvasBaseGridView rows={[{ name: 'a' }]} columns={columns} editState={null} />)
    expect(gridProps().keybindings).toBeUndefined()
    expect(gridProps().getCellsForSelection).toBeUndefined()
  })

  it('draws a flat --skeleton-base bar for unloaded rows instead of the cell content', () => {
    document.documentElement.style.setProperty('--skeleton-base', 'rgb(1, 2, 3)')
    const source = fakeSource(10, new Set([0]))
    renderWindowed(source)
    const ctx = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillStyle: '' }
    const drawContent = vi.fn()
    gridProps().drawCell(
      {
        ctx,
        row: 5,
        col: 0,
        rect: { x: 0, y: 0, width: 120, height: 28 },
        theme: { cellHorizontalPadding: 10, editorFontSize: '13px' },
      },
      drawContent
    )
    expect(drawContent).not.toHaveBeenCalled()
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 8, 100, 13)
    expect(ctx.fillStyle).toBe('rgb(1, 2, 3)')
  })

  it('reports the visible range and repaints only visible cells of newly loaded rows', () => {
    const source = fakeSource(5000, new Set())
    renderWindowed(source)
    act(() => {
      gridProps().onVisibleRegionChanged({ x: 0, y: 100, width: 1, height: 3 })
    })
    expect(source.onVisibleRangeChange).toHaveBeenCalledWith([100, 103])

    act(() => {
      ;(source as FakeSource).emit([0, 500])
    })
    expect(mockUpdateCells).toHaveBeenCalledWith([
      [0, 100],
      [0, 101],
      [0, 102],
    ])
    mockUpdateCells.mockClear()
    act(() => {
      ;(source as FakeSource).emit([1000, 1500])
    })
    expect(mockUpdateCells).not.toHaveBeenCalled()
  })

  it('re-requests the visible range when the source is re-seeded (re-run without a remount)', () => {
    const source = fakeSource(5000, new Set())
    renderWindowed(source)
    // Before any region was reported, a re-seed has nothing to re-request.
    act(() => {
      ;(source as FakeSource).emit([0, 5000], { reseeded: true })
    })
    expect(source.onVisibleRangeChange).not.toHaveBeenCalled()

    act(() => {
      gridProps().onVisibleRegionChanged({ x: 0, y: 4000, width: 1, height: 20 })
    })
    source.onVisibleRangeChange.mockClear()
    act(() => {
      ;(source as FakeSource).emit([0, 5000])
    })
    expect(source.onVisibleRangeChange).not.toHaveBeenCalled()
    act(() => {
      ;(source as FakeSource).emit([0, 5000], { reseeded: true })
    })
    expect(source.onVisibleRangeChange).toHaveBeenCalledWith([4000, 4020])
  })

  it('ignores a single checkbox click on a loading row but keeps header select-all as a range', async () => {
    const onRowMarkerRangesChange = vi.fn()
    const source = fakeSource(100000, new Set([0]))
    renderWindowed(source, { rowMarkers: 'checkbox', onRowMarkerRangesChange })

    await setSelection(selection(CompactSelection.fromSingleSelection(50)))
    expect(onRowMarkerRangesChange).not.toHaveBeenCalled()

    await setSelection(selection(CompactSelection.fromSingleSelection([0, 100000])))
    expect(onRowMarkerRangesChange).toHaveBeenLastCalledWith([[0, 100000]])
    expect(source.readRange).not.toHaveBeenCalled()
  })
})

describe('CanvasBaseGridView — actions over unloaded rows', () => {
  it('Cmd/Ctrl+C fetches unloaded rows first and writes the clipboard through the helper', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    const source = fakeSource(5000, new Set([0]))
    const { actions } = fakeRowActions(false)
    renderWindowed(source, { rowActions: actions })
    void user
    await setSelection(rangeSelection(0, 3))

    const event = keyEvent('c', { metaKey: true })
    await act(async () => {
      gridProps().onKeyDown(event)
    })

    expect(event.preventDefault).toHaveBeenCalled()
    expect(source.readRange).toHaveBeenCalledWith([0, 3], expect.anything())
    expect(actions.begin).toHaveBeenCalledWith('Copying', 3, undefined)
    expect(writeText).toHaveBeenCalledWith('row 0\nrow 1\nrow 2')
    // Under 1 s: no success toast.
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('copies loaded rows directly without fetching or progress', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    const source = fakeSource(10, new Set([0, 1]))
    const { actions } = fakeRowActions()
    renderWindowed(source, { rowActions: actions })
    void user
    await setSelection(rangeSelection(0, 2))
    await act(async () => {
      gridProps().onKeyDown(keyEvent('c', { ctrlKey: true }))
    })
    expect(source.readRange).not.toHaveBeenCalled()
    expect(actions.begin).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith('row 0\nrow 1')
  })

  it('offers cancel for multi-chunk fetches and shows the success toast once progress was visible', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText')
    const source = fakeSource(12340, new Set())
    const { actions } = fakeRowActions(true)
    renderWindowed(source, { rowActions: actions })
    void user
    await setSelection(rangeSelection(0, 12340))
    await act(async () => {
      gridProps().onKeyDown(keyEvent('c', { metaKey: true }))
    })
    expect(actions.begin).toHaveBeenCalledWith('Copying', 12340, expect.any(Function))
    await expectToast('success', '12,340 rows copied to clipboard.')
  })

  it('cancelling (Escape or the toolbar Cancel) aborts without writing', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    let release: (() => void) | undefined
    const source = fakeSource(
      12340,
      new Set(),
      (range) =>
        new Promise((resolve) => {
          release = () =>
            resolve(Array.from({ length: range[1] - range[0] }, () => ({ name: 'x' })))
        })
    )
    const { actions } = fakeRowActions(true)
    renderWindowed(source, { rowActions: actions })
    void user
    await setSelection(rangeSelection(0, 12340))
    act(() => {
      gridProps().onKeyDown(keyEvent('c', { metaKey: true }))
    })
    // A second action while one is pending is ignored.
    act(() => {
      gridProps().onKeyDown(keyEvent('x', { metaKey: true }))
    })
    expect(actions.begin).toHaveBeenCalledTimes(1)

    const escape = keyEvent('Escape')
    act(() => {
      gridProps().onKeyDown(escape)
    })
    expect(escape.preventDefault).toHaveBeenCalled()
    await act(async () => {
      release?.()
    })
    expect(writeText).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows the wireframe 8 toast when the fetch fails, and routes expiry without a toast', async () => {
    const source = fakeSource(5000, new Set(), async () => {
      throw new Error('offline')
    })
    const { actions } = fakeRowActions()
    renderWindowed(source, { rowActions: actions })
    await setSelection(rangeSelection(0, 3))
    await act(async () => {
      gridProps().onKeyDown(keyEvent('c', { metaKey: true }))
    })
    await expectToast('error', "Couldn't load all selected rows. Nothing was copied. Try again.")

    useToastStore.setState({ toasts: [] })
    const expired = fakeSource(5000, new Set(), async () => {
      throw new Error('results_expired: gone')
    })
    const second = fakeRowActions()
    renderWindowed(expired, { rowActions: second.actions })
    await setSelection(rangeSelection(0, 3))
    await act(async () => {
      gridProps().onKeyDown(keyEvent('c', { metaKey: true }))
    })
    expect(second.actions.onExpired).toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('shows Copy failed when the clipboard write fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
    renderWindowed(fakeSource(10, new Set([0])))
    void user
    await setSelection(rangeSelection(0, 1))
    await act(async () => {
      gridProps().onKeyDown(keyEvent('c', { metaKey: true }))
    })
    await expectToast('error', 'Copy failed')
    await expectToast('error', "Couldn't load all selected rows. Nothing was copied. Try again.")
  })

  it('shows Cut failed when the clipboard write fails, and keeps the cells', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
    const onCellValueChange = vi.fn()
    renderWindowed(fakeSource(10, new Set([0])), { onCellValueChange })
    void user
    await setSelection(rangeSelection(0, 1))
    await act(async () => {
      gridProps().onKeyDown(keyEvent('x', { metaKey: true }))
    })
    await expectToast('error', 'Cut failed')
    await expectToast('error', "Couldn't load all selected rows. Nothing was cut. Try again.")
    expect(onCellValueChange).not.toHaveBeenCalled()
  })

  it('Cut copies then clears; on a failed fetch it keeps the cells', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText')
    const onCellValueChange = vi.fn()
    renderWindowed(fakeSource(5000, new Set([0])), { onCellValueChange })
    void user
    await setSelection(rangeSelection(0, 2))
    await act(async () => {
      gridProps().onKeyDown(keyEvent('x', { metaKey: true }))
    })
    expect(onCellValueChange).toHaveBeenCalledTimes(2)
    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', null)

    onCellValueChange.mockClear()
    renderWindowed(
      fakeSource(5000, new Set(), async () => {
        throw new Error('offline')
      }),
      { onCellValueChange }
    )
    await setSelection(rangeSelection(0, 2))
    await act(async () => {
      gridProps().onKeyDown(keyEvent('x', { metaKey: true }))
    })
    expect(onCellValueChange).not.toHaveBeenCalled()
    await expectToast('error', "Couldn't load all selected rows. Nothing was cut. Try again.")
  })

  it('the Delete-key clear fetches unloaded rows, then clears every selected row', async () => {
    const onCellValueChange = vi.fn()
    const source = fakeSource(5000, new Set([0]))
    renderWindowed(source, { onCellValueChange })
    let result = true
    await act(async () => {
      result = gridProps().onDelete(rangeSelection(0, 3))
    })
    expect(result).toBe(false)
    expect(source.readRange).toHaveBeenCalledWith([0, 3], expect.anything())
    expect(onCellValueChange.mock.calls.map((call) => call[0])).toEqual([0, 1, 2])
  })

  it('does not fetch for a clear in read-only mode', () => {
    const source = fakeSource(5000, new Set())
    renderWindowed(source, { isEditMode: false })
    expect(gridProps().onDelete(rangeSelection(0, 3))).toBe(false)
    expect(source.readRange).not.toHaveBeenCalled()
  })

  it('pastes into an unloaded target row after fetching it (Glide must not apply its own paste)', async () => {
    const onCellClipboardEdit = vi.fn(async () => true)
    const source = fakeSource(5000, new Set([0]))
    renderWindowed(source, { onCellClipboardEdit })
    let handled = true
    await act(async () => {
      handled = gridProps().onPaste([0, 3000], [['pasted']])
    })
    expect(handled).toBe(false)
    expect(source.readRange).toHaveBeenCalledWith([3000, 3001], expect.anything())
    expect(onCellClipboardEdit).toHaveBeenCalledWith({
      rowIdx: 3000,
      rowData: { name: 'row 3000' },
      columnKey: 'name',
      action: 'paste',
      text: 'pasted',
    })

    // A loaded target is pasted without a fetch, and never by Glide itself.
    onCellClipboardEdit.mockClear()
    await act(async () => {
      handled = gridProps().onPaste([0, 0], [['here']])
    })
    expect(handled).toBe(false)
    expect(source.readRange).toHaveBeenCalledTimes(1)
    expect(onCellClipboardEdit).toHaveBeenCalledWith(
      expect.objectContaining({ rowIdx: 0, text: 'here' })
    )
  })

  it('shows Paste failed when the target row cannot be loaded', async () => {
    const source = fakeSource(5000, new Set(), async () => {
      throw new Error('offline')
    })
    renderWindowed(source, { onCellClipboardEdit: vi.fn() })
    await act(async () => {
      gridProps().onPaste([0, 3000], [['pasted']])
    })
    await expectToast('error', "Couldn't load all target rows. Nothing was pasted. Try again.")
  })

  it('context-menu Copy, Cut and Paste use the clipboard helpers', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('from clipboard')
    const onCellClipboardEdit = vi.fn(async () => true)
    renderWindowed(fakeSource(10, new Set([0, 1])), { onCellClipboardEdit, testId: 'wgrid' })
    await setSelection(rangeSelection(1, 1))

    fireEvent.contextMenu(screen.getByTestId('glide').parentElement!)
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('row 1')

    fireEvent.contextMenu(screen.getByTestId('glide').parentElement!)
    await user.click(screen.getByRole('menuitem', { name: 'Paste' }))
    expect(onCellClipboardEdit).toHaveBeenCalledWith(
      expect.objectContaining({ rowIdx: 1, text: 'from clipboard' })
    )
  })

  it('shows Paste failed when the clipboard cannot be read', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'readText').mockRejectedValueOnce(new Error('denied'))
    renderWindowed(fakeSource(10, new Set([0])), { onCellClipboardEdit: vi.fn() })
    await setSelection(rangeSelection(0, 1))
    fireEvent.contextMenu(screen.getByTestId('glide').parentElement!)
    await user.click(screen.getByRole('menuitem', { name: 'Paste' }))
    await expectToast('error', 'Paste failed')
    await expectToast('error', "Couldn't load all target rows. Nothing was pasted. Try again.")
  })
})

describe('CanvasBaseGridView — windowed Clear and multi-cell Paste', () => {
  const blockColumns = ['a', 'b', 'c'].map((key) => ({
    ...columns[0],
    key,
    displayName: key.toUpperCase(),
  }))

  const blockRow = (index: number): Row => ({
    a: `a${index}`,
    b: `b${index}`,
    c: `c${index}`,
  })

  /** A windowed three-column source where only `loaded` positions are in memory. */
  function blockSource(
    loaded: Set<number>,
    read: (range: RowRange) => Promise<Row[]> = async ([start, end]) =>
      Array.from({ length: end - start }, (_, offset) => blockRow(start + offset))
  ): FakeSource {
    const source = fakeSource(5000, loaded, read)
    return { ...source, getRow: (index) => (loaded.has(index) ? blockRow(index) : undefined) }
  }

  function renderBlock(
    source: GridRowSource<Row>,
    props: Partial<React.ComponentProps<typeof CanvasBaseGridView>> = {}
  ) {
    return renderWindowed(source, {
      columns: blockColumns,
      editableColumnKeys: new Set(['a', 'b', 'c']),
      ...props,
    })
  }

  const clipboard = [
    ['p1', 'q1', 'r1'],
    ['p2', 'q2', 'r2'],
  ]

  it('shows Clear failed when the rows to clear cannot be loaded', async () => {
    const onCellValueChange = vi.fn()
    renderWindowed(
      fakeSource(5000, new Set(), async () => {
        throw new Error('offline')
      }),
      { onCellValueChange }
    )
    await act(async () => {
      gridProps().onDelete(rangeSelection(0, 3))
    })
    expect(onCellValueChange).not.toHaveBeenCalled()
    await expectToast('error', 'Clear failed')
    await expectToast('error', "Couldn't load all selected rows. No cells were cleared. Try again.")
  })

  it('pastes only the first line of a block into an unloaded row and warns about the rest', async () => {
    const onCellValueChange = vi.fn()
    const onCellClipboardEdit = vi.fn(async () => true)
    const { actions } = fakeRowActions(true)
    const source = blockSource(new Set())
    renderBlock(source, { onCellValueChange, onCellClipboardEdit, rowActions: actions })
    let handled = true
    await act(async () => {
      handled = gridProps().onPaste([0, 3000], clipboard)
    })
    expect(handled).toBe(false)
    // Only the target row is fetched: the other lines are never pasted.
    expect(source.readRange).toHaveBeenCalledTimes(1)
    expect(source.readRange).toHaveBeenCalledWith([3000, 3001], expect.anything())
    expect(actions.begin).toHaveBeenCalledWith('Pasting', 1, undefined)
    expect(onCellClipboardEdit).toHaveBeenCalledTimes(1)
    expect(onCellClipboardEdit).toHaveBeenCalledWith({
      rowIdx: 3000,
      rowData: blockRow(3000),
      columnKey: 'a',
      action: 'paste',
      text: 'p1',
    })
    // The rest of line 1 goes to the same row once it is being edited.
    expect(onCellValueChange.mock.calls).toEqual([
      [3000, 'b', 'q1'],
      [3000, 'c', 'r1'],
    ])
    await expectToast('success', '1 row updated.')
    await expectToast('warning', 'Pasted one row')
    await expectToast('warning', 'only the first of 2 lines was pasted')
  })

  it('pastes the first line of a loaded target itself, never through Glide', async () => {
    const onCellValueChange = vi.fn()
    const onCellClipboardEdit = vi.fn(async () => true)
    const source = blockSource(new Set([0, 1]))
    renderBlock(source, { onCellValueChange, onCellClipboardEdit })
    let handled = true
    await act(async () => {
      handled = gridProps().onPaste([0, 0], clipboard)
    })
    expect(handled).toBe(false)
    expect(source.readRange).not.toHaveBeenCalled()
    expect(onCellClipboardEdit).toHaveBeenCalledWith(
      expect.objectContaining({ rowIdx: 0, columnKey: 'a', text: 'p1' })
    )
    // Nothing from line 2 reaches the row being edited.
    expect(onCellValueChange.mock.calls).toEqual([
      [0, 'b', 'q1'],
      [0, 'c', 'r1'],
    ])
    await expectToast('warning', 'Pasted one row')
  })

  it('clips the pasted line to the grid and shows no warning for a single line', async () => {
    const onCellValueChange = vi.fn()
    const source = blockSource(new Set([4999]))
    renderBlock(source, { onCellValueChange, onCellClipboardEdit: vi.fn(async () => true) })
    await act(async () => {
      // Starts at column B: the third clipboard column falls off the grid.
      gridProps().onPaste([1, 4999], [clipboard[0]])
    })
    expect(source.readRange).not.toHaveBeenCalled()
    expect(onCellValueChange.mock.calls).toEqual([[4999, 'c', 'q1']])
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('applies nothing more when the row could not be put into edit', async () => {
    const onCellValueChange = vi.fn()
    const onCellClipboardEdit = vi.fn(async () => false)
    renderBlock(blockSource(new Set([0])), { onCellValueChange, onCellClipboardEdit })
    await act(async () => {
      gridProps().onPaste([0, 0], clipboard)
    })
    expect(onCellClipboardEdit).toHaveBeenCalledTimes(1)
    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('writes nothing when the fetch for the paste target fails', async () => {
    const onCellValueChange = vi.fn()
    const onCellClipboardEdit = vi.fn(async () => true)
    const source = blockSource(new Set([0]), async () => {
      throw new Error('offline')
    })
    renderBlock(source, { onCellValueChange, onCellClipboardEdit })
    await act(async () => {
      gridProps().onPaste([0, 1], clipboard)
    })
    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(onCellClipboardEdit).not.toHaveBeenCalled()
    await expectToast('error', 'Paste failed')
    await expectToast('error', "Couldn't load all target rows. Nothing was pasted. Try again.")
  })

  it('skips non-editable columns, starting the edit on the first editable one', async () => {
    const onCellValueChange = vi.fn()
    const onCellClipboardEdit = vi.fn(async () => true)
    const source = blockSource(new Set())
    renderBlock(source, {
      columns: blockColumns.map((column) =>
        column.key === 'a' ? { ...column, editable: false } : column
      ),
      editableColumnKeys: new Set(['b', 'c']),
      onCellValueChange,
      onCellClipboardEdit,
    })
    await act(async () => {
      gridProps().onPaste([0, 100], [clipboard[0]])
    })
    expect(onCellClipboardEdit).toHaveBeenCalledWith(
      expect.objectContaining({ rowIdx: 100, columnKey: 'b', text: 'q1' })
    )
    expect(onCellValueChange.mock.calls).toEqual([[100, 'c', 'r1']])
  })

  it('pastes nothing when every target column is read-only', async () => {
    const onCellClipboardEdit = vi.fn(async () => true)
    renderBlock(blockSource(new Set([0])), {
      columns: blockColumns.map((column) => ({ ...column, editable: false })),
      editableColumnKeys: new Set(),
      onCellClipboardEdit,
    })
    await act(async () => {
      gridProps().onPaste([0, 0], [clipboard[0]])
    })
    expect(onCellClipboardEdit).not.toHaveBeenCalled()
  })

  it('pastes into enum and SET cells of the line through their cell renderers', async () => {
    const onCellValueChange = vi.fn()
    const source = blockSource(new Set())
    renderBlock(source, {
      columns: [
        blockColumns[0],
        { ...blockColumns[1], editorType: 'enum', enumValues: ['q1', 'other'] },
        { ...blockColumns[2], editorType: 'set', setValues: ['r1', 'x'] },
      ],
      onCellValueChange,
      onCellClipboardEdit: vi.fn(async () => true),
    })
    await act(async () => {
      gridProps().onPaste([0, 200], [clipboard[0]])
    })
    expect(onCellValueChange.mock.calls).toEqual([
      [200, 'b', 'q1'],
      [200, 'c', 'r1'],
    ])
  })

  it('does not fetch a paste target in read-only mode', () => {
    const source = blockSource(new Set())
    renderBlock(source, { isEditMode: false })
    expect(gridProps().onPaste([0, 10], clipboard)).toBe(false)
    expect(source.readRange).not.toHaveBeenCalled()
  })
})
