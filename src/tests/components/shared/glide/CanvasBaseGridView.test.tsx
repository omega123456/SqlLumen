import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GridCellKind } from '@glideapps/glide-data-grid'
import { CanvasBaseGridView } from '../../../../components/shared/glide/CanvasBaseGridView'

const mockGlideDataGrid = vi.fn()
const mockSelectCell = vi.fn()
const mockScrollToCell = vi.fn()
const mockScrollToOffset = vi.fn()

vi.mock('../../../../components/shared/glide/GlideDataGrid', async () => {
  const React = await import('react')
  return {
    GlideDataGrid: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockGlideDataGrid(props)
      React.useImperativeHandle(ref, () => ({
        selectCell: mockSelectCell,
        scrollToCell: mockScrollToCell,
        scrollToOffset: mockScrollToOffset,
        element: null,
      }))
      return React.createElement('div', { 'data-testid': props['data-testid'] }, 'glide')
    }),
  }
})

const rows = [{ id: 1, name: 'alpha', info: 'SELECT 1' }]
const columns = [
  {
    key: 'name',
    displayName: 'Name',
    dataType: 'VARCHAR',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
]

const foreignKey = {
  columnName: 'name',
  referencedDatabase: 'app',
  referencedTable: 'authors',
  referencedColumn: 'id',
  constraintName: 'fk_name_author',
}

beforeEach(() => {
  mockGlideDataGrid.mockClear()
  mockSelectCell.mockClear()
  mockScrollToCell.mockClear()
  mockScrollToOffset.mockClear()
})

function mockCanvasContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    fillText: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('CanvasBaseGridView', () => {
  it('renders rows and columns through GlideDataGrid', () => {
    render(
      <CanvasBaseGridView rows={rows} columns={columns} editState={null} testId="canvas-grid" />
    )
    expect(screen.getByTestId('canvas-grid')).toBeInTheDocument()
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      rows: unknown[]
      columns: Array<{ title: string }>
    }
    expect(props.rows).toBe(rows)
    expect(props.columns.map((column) => column.title)).toEqual(['Name'])
  })

  it('only renders the info column when explicitly enabled', () => {
    render(
      <CanvasBaseGridView rows={rows} columns={columns} editState={null} showInfoColumn={true} />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as { columns: Array<{ title: string }> }
    expect(props.columns.map((column) => column.title)).toEqual(['Name', 'Info'])
  })

  it('header click triggers sort callback', () => {
    const onSortChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onSortChange={onSortChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onHeaderClicked: (index: number) => void
    }
    props.onHeaderClicked(0)
    expect(onSortChange).toHaveBeenCalledWith('name', 'ASC')
  })

  it('adapts column resize callbacks to column keys', () => {
    const onColumnResize = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onColumnResize={onColumnResize}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onColumnResize: (columnIndex: number, width: number) => void
    }
    props.onColumnResize(0, 222)
    expect(onColumnResize).toHaveBeenCalledWith('name', 222)
  })

  it('uses auto-size config to compute initial column width', () => {
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        autoSizeConfig={{ enabled: true, computeWidth: () => 321 }}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as { columns: Array<{ width: number }> }
    expect(props.columns[0].width).toBe(321)
  })

  it('header click cycles sorted columns from ascending to descending to clear', () => {
    const onSortChange = vi.fn()
    const { rerender } = render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        sortColumn="name"
        sortDirection="ASC"
        onSortChange={onSortChange}
      />
    )
    let props = mockGlideDataGrid.mock.lastCall?.[0] as { onHeaderClicked: (index: number) => void }
    props.onHeaderClicked(0)
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'DESC')

    rerender(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        sortColumn="name"
        sortDirection="DESC"
        onSortChange={onSortChange}
      />
    )
    props = mockGlideDataGrid.mock.lastCall?.[0] as { onHeaderClicked: (index: number) => void }
    props.onHeaderClicked(0)
    expect(onSortChange).toHaveBeenLastCalledWith(null, null)
  })

  it('row click triggers selection callback', async () => {
    const onCellSelectionChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onCellSelectionChange={onCellSelectionChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellClicked: (cell: readonly [number, number], event: unknown) => void
    }
    act(() => props.onCellClicked([0, 0], {}))
    await waitFor(() =>
      expect(onCellSelectionChange).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'grid-pointer',
      })
    )
  })

  it('context menu callback fires through context menu bridge', () => {
    const onRowClick = vi.fn()
    render(
      <CanvasBaseGridView rows={rows} columns={columns} editState={null} onRowClick={onRowClick} />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellContextMenu: (cell: readonly [number, number], event: unknown) => void
    }
    act(() => props.onCellContextMenu([0, 0], {}))
    expect(onRowClick).toHaveBeenCalledWith(rows[0], 'name')
  })

  it('info-cell click triggers virtual popover callback', () => {
    const onInfoCellClick = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onInfoCellClick={onInfoCellClick}
        showInfoColumn={true}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellClicked: (
        cell: readonly [number, number],
        event: { bounds: { x: number; y: number; width: number; height: number } }
      ) => void
    }
    act(() => props.onCellClicked([1, 0], { bounds: { x: 1, y: 2, width: 3, height: 4 } }))
    expect(onInfoCellClick).toHaveBeenCalledWith(rows[0], expect.any(DOMRect))
  })

  it('passes row marker configuration', () => {
    render(
      <CanvasBaseGridView rows={rows} columns={columns} editState={null} rowMarkers="checkbox" />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as { rowMarkers: string }
    expect(props.rowMarkers).toBe('checkbox')
  })

  it('row click selects row and notifies selection callback', async () => {
    const onSelectedRowChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onSelectedRowChange={onSelectedRowChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellClicked: (cell: readonly [number, number], event: unknown) => void
      selection: { rows: { hasIndex: (index: number) => boolean } }
    }
    act(() => props.onCellClicked([0, 0], {}))
    await waitFor(() => expect(onSelectedRowChange).toHaveBeenCalledWith(rows[0], 0))
  })

  it('double-click triggers row double-click callback', () => {
    const onRowDoubleClicked = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onRowDoubleClicked={onRowDoubleClicked}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellDoubleClicked: (cell: readonly [number, number]) => void
    }
    act(() => props.onCellDoubleClicked([0, 0]))
    expect(onRowDoubleClicked).toHaveBeenCalledWith(rows[0])
  })

  it('passes highlighted column through cell content building', () => {
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        highlightColumnKey="name"
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => {
        kind: GridCellKind
        displayData?: string
      }
      drawCell: (
        args: {
          row: number
          col: number
          ctx: CanvasRenderingContext2D
          rect: { x: number; y: number; width: number; height: number }
          theme: {
            bgSearchResult: string
            bgBubbleSelected: string
            accentColor: string
            linkColor: string
          }
        },
        drawContent: () => void
      ) => void
    }
    expect(props.getCellContent([0, 0])).toMatchObject({
      kind: GridCellKind.Text,
      displayData: 'alpha',
    })
    const ctx = mockCanvasContext()
    props.drawCell(
      {
        row: 0,
        col: 0,
        ctx,
        rect: { x: 1, y: 2, width: 3, height: 4 },
        theme: {
          bgSearchResult: 'highlight',
          bgBubbleSelected: 'selected',
          accentColor: 'accent',
          linkColor: 'link',
        },
      },
      vi.fn()
    )
    expect(ctx.fillRect).toHaveBeenCalledWith(1, 2, 3, 4)
  })

  it('draws headers for known and unknown columns', () => {
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        sortColumn="name"
        sortDirection="ASC"
        highlightColumnKey="name"
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      drawHeader: (
        args: {
          columnIndex: number
          column: { title: string }
          ctx: CanvasRenderingContext2D
          rect: { x: number; y: number; width: number; height: number }
          theme: {
            bgSearchResult: string
            textHeaderSelected: string
            textHeader: string
            headerFontStyle: string
            fontFamily: string
            cellHorizontalPadding: number
          }
        },
        drawContent: () => void
      ) => void
    }
    const ctx = mockCanvasContext()
    const theme = {
      bgSearchResult: 'highlight',
      textHeaderSelected: 'selected-text',
      textHeader: 'text',
      headerFontStyle: '12px',
      fontFamily: 'sans-serif',
      cellHorizontalPadding: 8,
    }
    const fallbackDraw = vi.fn()

    props.drawHeader(
      {
        columnIndex: 0,
        column: { title: 'Name' },
        ctx,
        rect: { x: 0, y: 0, width: 100, height: 30 },
        theme,
      },
      fallbackDraw
    )
    expect(ctx.fillText).toHaveBeenCalledWith('Name', 8, 19)
    expect(fallbackDraw).not.toHaveBeenCalled()

    props.drawHeader(
      {
        columnIndex: 99,
        column: { title: 'Missing' },
        ctx,
        rect: { x: 0, y: 0, width: 100, height: 30 },
        theme,
      },
      fallbackDraw
    )
    expect(fallbackDraw).toHaveBeenCalled()
  })

  it('Enter key on selected row calls row double-click callback', () => {
    const onRowDoubleClicked = vi.fn()
    const { rerender } = render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        selectedRowIndex={0}
        onRowDoubleClicked={onRowDoubleClicked}
      />
    )
    rerender(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        selectedRowIndex={0}
        onRowDoubleClicked={onRowDoubleClicked}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: { key: string; preventDefault: () => void }) => void
    }
    const preventDefault = vi.fn()
    props.onKeyDown({ key: 'Enter', preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(onRowDoubleClicked).toHaveBeenCalledWith(rows[0])
  })

  it('handles edits, paste, scrolling, FK actions, and marker selection', async () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    const onCellClipboardEdit = vi.fn()
    const onScrollPositionChange = vi.fn()
    const onFkCellAction = vi.fn()
    const onRowMarkersChange = vi.fn()
    const fkColumns = [{ ...columns[0], foreignKey }]
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={fkColumns}
        editState={null}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
        onCellClipboardEdit={onCellClipboardEdit}
        onScrollPositionChange={onScrollPositionChange}
        onFkCellAction={onFkCellAction}
        onRowMarkersChange={onRowMarkersChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellEdited: (
        cell: readonly [number, number],
        value: { kind: GridCellKind; data: string; copyData?: string }
      ) => void
      onDelete: (selection: {
        current?: { range: { x: number; y: number; width: number; height: number }; rangeStack: [] }
        rows: Iterable<number>
        columns: Iterable<number>
      }) => boolean
      onPaste: (
        target: readonly [number, number],
        values: readonly (readonly string[])[]
      ) => boolean
      onVisibleRegionChanged: (range: unknown, tx: number, ty: number) => void
      onCellClicked: (
        cell: readonly [number, number],
        event: {
          bounds?: { x: number; y: number; width: number; height: number }
          localEventX?: number
        }
      ) => void
      onSelectionChange: (selection: { rows: Iterable<number> }) => void
    }

    props.onCellEdited([0, 0], { kind: GridCellKind.Text, data: '', copyData: 'NULL' })
    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', null)
    expect(onRowsChange).toHaveBeenCalledWith([{ ...rows[0], name: null }], {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })

    expect(
      props.onDelete({
        current: { range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] },
        rows: [],
        columns: [],
      })
    ).toBe(false)
    expect(onCellValueChange).toHaveBeenLastCalledWith(0, 'name', '')

    expect(props.onPaste([0, 0], [['pasted']])).toBe(true)
    expect(onCellClipboardEdit).toHaveBeenCalledWith({
      rowIdx: 0,
      rowData: rows[0],
      columnKey: 'name',
      action: 'paste',
      text: 'pasted',
    })
    expect(props.onPaste([5, 0], [['ignored']])).toBe(false)

    props.onVisibleRegionChanged({}, 11, 22)
    expect(onScrollPositionChange).toHaveBeenCalledWith(22, 11)

    act(() =>
      props.onCellClicked([0, 0], {
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        localEventX: 90,
      })
    )
    await waitFor(() =>
      expect(onFkCellAction).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'grid-pointer',
      })
    )

    props.onSelectionChange({ rows: [0] })
    expect(onRowMarkersChange).toHaveBeenCalledWith(rows)
  })

  it('copies, cuts, pastes, and dismisses the grid clipboard context menu', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const readText = vi.fn().mockResolvedValue('pasted')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText },
    })
    const onCellValueChange = vi.fn()
    const onCellClipboardEdit = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
        onCellValueChange={onCellValueChange}
        onCellClipboardEdit={onCellClipboardEdit}
        testId="clipboard-grid"
      />
    )

    fireEvent.contextMenu(screen.getByTestId('clipboard-grid'))
    expect(screen.getByTestId('clipboard-grid-clipboard-menu')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('alpha')

    fireEvent.contextMenu(screen.getByTestId('clipboard-grid'))
    await user.click(screen.getByRole('menuitem', { name: 'Cut' }))
    expect(writeText).toHaveBeenLastCalledWith('alpha')
    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', '')

    fireEvent.contextMenu(screen.getByTestId('clipboard-grid'))
    await user.click(screen.getByRole('menuitem', { name: 'Paste' }))
    expect(readText).toHaveBeenCalled()
    expect(onCellClipboardEdit).toHaveBeenCalledWith({
      rowIdx: 0,
      rowData: rows[0],
      columnKey: 'name',
      action: 'paste',
      text: 'pasted',
    })

    fireEvent.contextMenu(screen.getByTestId('clipboard-grid'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('clipboard-grid-clipboard-menu')).not.toBeInTheDocument()
  })

  it('cuts selection with Ctrl+X keyboard shortcut', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const onCellValueChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
        onCellValueChange={onCellValueChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: {
        key: string
        ctrlKey: boolean
        metaKey?: boolean
        preventDefault: () => void
      }) => void
    }
    const preventDefault = vi.fn()
    await act(async () => props.onKeyDown({ key: 'x', ctrlKey: true, preventDefault }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('alpha'))
    expect(preventDefault).toHaveBeenCalled()
    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', '')
  })

  it('provides editors from the cell editor metadata rather than selected state', () => {
    const editableColumns = [
      { ...columns[0], editable: true, editorType: 'enum' as const, enumValues: ['alpha', 'beta'] },
    ]
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={editableColumns}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        selectedCellPosition={{ rowIdx: 0, idx: 99 }}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => unknown
      provideEditor: (cell: unknown) => unknown
    }
    const cell = props.getCellContent([0, 0])
    const editorConfig = props.provideEditor(cell)
    expect(editorConfig).toMatchObject({ editor: expect.any(Function) })
    expect(editorConfig).not.toHaveProperty('disablePadding')
    expect(editorConfig).not.toHaveProperty('disableStyling')
  })

  it('guards cell clicks and restores focus when navigation is denied', async () => {
    const onCellClickGuard = vi.fn().mockResolvedValue({
      proceed: false,
      restoreFocus: true,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: true,
    })
    const onSelectedCellChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
        onCellClickGuard={onCellClickGuard}
        onSelectedCellChange={onSelectedCellChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellClicked: (cell: readonly [number, number], event: unknown) => void
    }

    act(() => props.onCellClicked([0, 0], {}))
    await waitFor(() => expect(onCellClickGuard).toHaveBeenCalled())
    expect(onSelectedCellChange).not.toHaveBeenCalled()
  })

  it('supports keyboard navigation and FK action shortcut', async () => {
    const onSelectedRowChange = vi.fn()
    const onFkCellAction = vi.fn()
    const fkColumns = [{ ...columns[0], foreignKey }]
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={fkColumns}
        editState={null}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
        onSelectedRowChange={onSelectedRowChange}
        onFkCellAction={onFkCellAction}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: { key: string; preventDefault: () => void; cancel?: () => void }) => void
    }
    const preventDefault = vi.fn()
    const cancel = vi.fn()
    act(() => props.onKeyDown({ key: 'ArrowDown', preventDefault, cancel }))
    expect(onSelectedRowChange).toHaveBeenCalledWith(rows[0], 0)
    act(() => props.onKeyDown({ key: 'ArrowUp', preventDefault, cancel }))
    expect(onSelectedRowChange).toHaveBeenCalledWith(rows[0], 0)
    props.onKeyDown({ key: 'F4', preventDefault, cancel })
    await waitFor(() =>
      expect(onFkCellAction).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'keyboard',
      })
    )
    expect(cancel).toHaveBeenCalled()
  })

  it('restores persisted scroll and does not replay the same offset after user scrolling', async () => {
    vi.useFakeTimers()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        initialScrollPosition={{ top: 7, left: 3 }}
      />
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(mockScrollToOffset).toHaveBeenCalledTimes(1)
    expect(mockScrollToOffset).toHaveBeenCalledWith({ left: 3, top: 7 })

    const firstProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      onVisibleRegionChanged: (range: unknown, tx: number, ty: number) => void
    }

    act(() => firstProps.onVisibleRegionChanged({}, 11, 22))

    expect(mockScrollToOffset).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('reapplies a new persisted scroll offset when tab state changes', async () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        initialScrollPosition={{ top: 7, left: 3 }}
      />
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    const firstProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      onVisibleRegionChanged: (range: unknown, tx: number, ty: number) => void
    }
    act(() => firstProps.onVisibleRegionChanged({}, 3, 7))

    rerender(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        initialScrollPosition={{ top: 14, left: 9 }}
      />
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(mockScrollToOffset).toHaveBeenCalledTimes(2)
    expect(mockScrollToOffset).toHaveBeenLastCalledWith({ left: 9, top: 14 })
    vi.useRealTimers()
  })

  it('uses the click guard during keyboard row navigation when requested', async () => {
    const onCellClickGuard = vi.fn(async () => ({
      proceed: true,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: true,
    }))
    const onCellSelectionChange = vi.fn()

    render(
      <CanvasBaseGridView
        rows={[...rows, { id: 2, name: 'beta', info: 'SELECT 2' }]}
        columns={[{ ...columns[0], editable: true }]}
        editState={null}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
        editableColumnKeys={new Set(['name'])}
        runCellClickGuardOnKeyboardSelection={true}
        onCellClickGuard={onCellClickGuard}
        onCellSelectionChange={onCellSelectionChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: { key: string; preventDefault: () => void; cancel?: () => void }) => void
    }

    const preventDefault = vi.fn()
    const cancel = vi.fn()
    act(() => props.onKeyDown({ key: 'ArrowDown', preventDefault, cancel }))

    await waitFor(() =>
      expect(onCellClickGuard).toHaveBeenCalledWith({
        rowIdx: 1,
        columnKey: 'name',
        rowData: { id: 2, name: 'beta', info: 'SELECT 2' },
        source: 'keyboard',
      })
    )
    expect(onCellSelectionChange).toHaveBeenCalledWith({
      rowIdx: 0,
      columnKey: 'name',
      rowData: rows[0],
      source: 'keyboard',
    })
    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 0 },
      { shouldFocusCell: true, enableEditor: true }
    )
    expect(cancel).toHaveBeenCalled()
  })

  it('uses the internal grid selection for F4 when the parent selected cell prop has not updated yet', async () => {
    const onFkCellAction = vi.fn()
    const fkColumns = [{ ...columns[0], foreignKey }]

    render(
      <CanvasBaseGridView rows={rows} columns={fkColumns} editState={null} onFkCellAction={onFkCellAction} />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: { key: string; preventDefault: () => void }) => void
      onSelectionChange: (selection: {
        rows: Iterable<number>
        current?: { cell: readonly [number, number]; range: unknown; rangeStack: [] }
      }) => void
    }

    act(() =>
      props.onSelectionChange({
        rows: [],
        current: {
          cell: [0, 0],
          range: { x: 0, y: 0, width: 1, height: 1 },
          rangeStack: [],
        },
      })
    )

    const updatedProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: { key: string; preventDefault: () => void }) => void
    }

    const preventDefault = vi.fn()
    act(() => updatedProps.onKeyDown({ key: 'F4', preventDefault }))

    await waitFor(() =>
      expect(onFkCellAction).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'keyboard',
      })
    )
    expect(preventDefault).toHaveBeenCalled()
  })

  it('supports document-level F4 handling when grid selection exists', async () => {
    const onFkCellAction = vi.fn()
    const fkColumns = [{ ...columns[0], foreignKey }]

    render(
      <CanvasBaseGridView rows={rows} columns={fkColumns} editState={null} onFkCellAction={onFkCellAction} />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onSelectionChange: (selection: {
        rows: Iterable<number>
        current?: { cell: readonly [number, number]; range: unknown; rangeStack: [] }
      }) => void
    }

    act(() =>
      props.onSelectionChange({
        rows: [],
        current: {
          cell: [0, 0],
          range: { x: 0, y: 0, width: 1, height: 1 },
          rangeStack: [],
        },
      })
    )

    const event = new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true })
    document.dispatchEvent(event)

    await waitFor(() =>
      expect(onFkCellAction).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'keyboard',
      })
    )
  })

  it('falls back to the last clicked FK cell for F4 before async selection settles', async () => {
    const onFkCellAction = vi.fn()
    const onCellClickGuard = vi.fn(
      () => new Promise<never>(() => {
        // Intentionally unresolved to simulate async guard delay.
      })
    )
    const fkColumns = [{ ...columns[0], foreignKey }]

    render(
      <CanvasBaseGridView
        rows={rows}
        columns={fkColumns}
        editState={null}
        onFkCellAction={onFkCellAction}
        onCellClickGuard={onCellClickGuard}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellClicked: (cell: readonly [number, number], event: unknown) => void
    }

    act(() => props.onCellClicked([0, 0], {}))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true }))

    await waitFor(() =>
      expect(onFkCellAction).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'keyboard',
      })
    )
  })

  it('opens FK lookup from the ellipsis without invoking the regular click guard', async () => {
    const onCellClickGuard = vi.fn()
    const onFkCellAction = vi.fn().mockResolvedValue(undefined)
    const fkColumns = [{ ...columns[0], foreignKey }]

    render(
      <CanvasBaseGridView
        rows={rows}
        columns={fkColumns}
        editState={null}
        onCellClickGuard={onCellClickGuard}
        onFkCellAction={onFkCellAction}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellClicked: (
        cell: readonly [number, number],
        event: {
          bounds?: { x: number; y: number; width: number; height: number }
          localEventX?: number
        }
      ) => void
    }

    act(() =>
      props.onCellClicked([0, 0], {
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        localEventX: 90,
      })
    )

    await waitFor(() =>
      expect(onFkCellAction).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'grid-pointer',
      })
    )
    expect(onCellClickGuard).not.toHaveBeenCalled()
  })
})
