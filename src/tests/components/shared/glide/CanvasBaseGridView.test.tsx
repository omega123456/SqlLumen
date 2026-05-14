import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GridCellKind } from '@glideapps/glide-data-grid'
import { CanvasBaseGridView } from '../../../../components/shared/glide/CanvasBaseGridView'

const mockGlideDataGrid = vi.fn()
const mockSelectCell = vi.fn()
const mockScrollToCell = vi.fn()

vi.mock('../../../../components/shared/glide/GlideDataGrid', async () => {
  const React = await import('react')
  return {
    GlideDataGrid: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockGlideDataGrid(props)
      React.useImperativeHandle(ref, () => ({
        selectCell: mockSelectCell,
        scrollToCell: mockScrollToCell,
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
    const onScrollCellChange = vi.fn()
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
        onScrollCellChange={onScrollCellChange}
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
      onVisibleRegionChanged: (
        range: { x: number; y: number; width: number; height: number },
        tx: number,
        ty: number
      ) => void
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

    props.onVisibleRegionChanged({ x: 3, y: 4, width: 10, height: 5 }, 11, 22)
    expect(onScrollCellChange).toHaveBeenCalledWith(4, 3)

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

  it('persists visible scroll cells from range coordinates instead of pixel transforms', () => {
    const onScrollCellChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onScrollCellChange={onScrollCellChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onVisibleRegionChanged: (
        range: { x: number; y: number; width: number; height: number },
        tx: number,
        ty: number
      ) => void
    }

    props.onVisibleRegionChanged({ x: 2, y: 7, width: 4, height: 3 }, 128, 512)

    expect(onScrollCellChange).toHaveBeenCalledWith(7, 2)
  })

  it('keeps no-op editor commits out of the value change path while preserving cleanup', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()

    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[{ ...columns[0], editable: true }]}
        editState={{
          rowKey: '1',
          currentValues: { name: 'alpha' },
          originalValues: { name: 'alpha' },
        }}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
      onCellEdited: (
        cell: readonly [number, number],
        value: { kind: GridCellKind; data: string; copyData?: string }
      ) => void
    }

    props.onCellActivated([0, 0])
    props.onCellEdited([0, 0], { kind: GridCellKind.Text, data: 'alpha', copyData: 'alpha' })

    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(onRowsChange).toHaveBeenCalledWith(rows, {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
  })

  it('captures the editor baseline before live row previews mutate the rendered row', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    const { rerender } = render(
      <CanvasBaseGridView
        rows={rows}
        columns={[{ ...columns[0], editable: true }]}
        editState={{
          rowKey: '1',
          currentValues: { name: 'alpha' },
          originalValues: { name: 'alpha' },
        }}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )

    const initialProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
    }
    initialProps.onCellActivated([0, 0])

    rerender(
      <CanvasBaseGridView
        rows={[{ id: 1, name: 'preview', info: 'SELECT 1' }]}
        columns={[{ ...columns[0], editable: true }]}
        editState={{
          rowKey: '1',
          currentValues: { name: 'alpha' },
          originalValues: { name: 'alpha' },
        }}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )

    const updatedProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellEdited: (
        cell: readonly [number, number],
        value: { kind: GridCellKind; data: string; copyData?: string }
      ) => void
    }
    updatedProps.onCellEdited([0, 0], { kind: GridCellKind.Text, data: 'alpha', copyData: 'alpha' })

    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(onRowsChange).toHaveBeenCalledWith([{ id: 1, name: 'preview', info: 'SELECT 1' }], {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
  })

  it('propagates genuine editor commits through the value and row change paths', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()

    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[{ ...columns[0], editable: true }]}
        editState={{
          rowKey: '1',
          currentValues: { name: 'alpha' },
          originalValues: { name: 'alpha' },
        }}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
      onCellEdited: (
        cell: readonly [number, number],
        value: { kind: GridCellKind; data: string; copyData?: string }
      ) => void
    }

    props.onCellActivated([0, 0])
    props.onCellEdited([0, 0], { kind: GridCellKind.Text, data: 'beta', copyData: 'beta' })

    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', 'beta')
    expect(onRowsChange).toHaveBeenCalledWith([{ ...rows[0], name: 'beta' }], {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
  })

  it('leaves an already dirty cell dirty when reopened and closed without further changes', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    const dirtyRows = [{ id: 1, name: 'dirty', info: 'SELECT 1' }]

    render(
      <CanvasBaseGridView
        rows={dirtyRows}
        columns={[{ ...columns[0], editable: true }]}
        editState={{
          rowKey: '1',
          currentValues: { name: 'dirty' },
          originalValues: { name: 'alpha' },
        }}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
      onCellEdited: (
        cell: readonly [number, number],
        value: { kind: GridCellKind; data: string; copyData?: string }
      ) => void
    }

    props.onCellActivated([0, 0])
    props.onCellEdited([0, 0], { kind: GridCellKind.Text, data: 'dirty', copyData: 'dirty' })

    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(onRowsChange).toHaveBeenCalledWith(dirtyRows, {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
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
    expect(editorConfig).toMatchObject({
      editor: expect.any(Function),
      disablePadding: true,
      disableStyling: true,
    })
  })

  it('keeps enum editors with foreign key markers on the styled overlay path', () => {
    const editableColumns = [
      {
        ...columns[0],
        editable: true,
        editorType: 'enum' as const,
        enumValues: ['alpha', 'beta'],
        foreignKey: {
          columnName: 'name',
          referencedDatabase: 'app',
          referencedTable: 'items',
          referencedColumn: 'id',
          constraintName: 'fk_items_name',
        },
      },
    ]
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={editableColumns}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
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

  it('keeps editable NULL cells in the editable path while preserving NULL styling', () => {
    const nullableRows = [{ id: 1, name: null, info: 'SELECT 1' }]
    render(
      <CanvasBaseGridView
        rows={nullableRows}
        columns={[{ ...columns[0], editable: true, isNullable: true }]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => {
        kind: GridCellKind
        displayData?: string
        data?: string
        copyData?: string
        readonly?: boolean
        allowOverlay?: boolean
        themeOverride?: unknown
        glideEditorData?: { row: unknown; columnKey: string; isNullable: boolean }
      }
      provideEditor: (cell: unknown) => unknown
    }
    const cell = props.getCellContent([0, 0])

    expect(cell).toMatchObject({
      kind: GridCellKind.Text,
      displayData: 'NULL',
      data: '',
      copyData: 'NULL',
      readonly: false,
      allowOverlay: true,
      glideEditorData: { row: nullableRows[0], columnKey: 'name', isNullable: true },
    })
    expect(cell.themeOverride).toBeDefined()
    expect(props.provideEditor(cell)).toMatchObject({ editor: expect.any(Function) })
  })

  it('keeps read-only and binary NULL cells non-editable', () => {
    const nullableRows = [{ id: 1, name: null, info: 'SELECT 1' }]
    const { rerender } = render(
      <CanvasBaseGridView
        rows={nullableRows}
        columns={[{ ...columns[0], editable: false, isNullable: true }]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
      />
    )

    let props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => {
        displayData?: string
        readonly?: boolean
        allowOverlay?: boolean
        glideEditorData?: unknown
      }
      provideEditor: (cell: unknown) => unknown
    }
    let cell = props.getCellContent([0, 0])
    expect(cell).toMatchObject({ displayData: 'NULL', readonly: true, allowOverlay: false })
    expect(cell.glideEditorData).toBeUndefined()
    expect(props.provideEditor(cell)).toBeUndefined()

    rerender(
      <CanvasBaseGridView
        rows={nullableRows}
        columns={[{ ...columns[0], editable: true, isNullable: true, isBinary: true }]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
      />
    )
    props = mockGlideDataGrid.mock.lastCall?.[0] as typeof props
    cell = props.getCellContent([0, 0])
    expect(cell).toMatchObject({ displayData: 'NULL', readonly: true, allowOverlay: false })
    expect(cell.glideEditorData).toBeUndefined()
    expect(props.provideEditor(cell)).toBeUndefined()
  })

  it('keeps unchanged NULL edits out of the dirty path while preserving cleanup', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    const nullableRows = [{ id: 1, name: null, info: 'SELECT 1' }]

    render(
      <CanvasBaseGridView
        rows={nullableRows}
        columns={[{ ...columns[0], editable: true, isNullable: true }]}
        editState={{ rowKey: '1', currentValues: { name: null }, originalValues: { name: null } }}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
      onCellEdited: (
        cell: readonly [number, number],
        value: { kind: GridCellKind; data: string; copyData?: string }
      ) => void
    }

    props.onCellActivated([0, 0])
    props.onCellEdited([0, 0], { kind: GridCellKind.Text, data: '', copyData: 'NULL' })

    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(onRowsChange).toHaveBeenCalledWith(nullableRows, {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
  })

  it('keeps numeric no-op editor commits out of the dirty path after string normalization', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    const numericRows = [{ id: 1, name: 1, info: 'SELECT 1' }]

    render(
      <CanvasBaseGridView
        rows={numericRows}
        columns={[{ ...columns[0], editable: true, dataType: 'INT' }]}
        editState={{ rowKey: '1', currentValues: { name: 1 }, originalValues: { name: 1 } }}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
      onCellEdited: (
        cell: readonly [number, number],
        value: { kind: GridCellKind; data: string; copyData?: string }
      ) => void
    }

    props.onCellActivated([0, 0])
    props.onCellEdited([0, 0], { kind: GridCellKind.Text, data: '1', copyData: '1' })

    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(onRowsChange).toHaveBeenCalledWith(numericRows, {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
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

  it('typing into a selected editable cell seeds the first typed character before opening the editor', async () => {
    const onCellClickGuard = vi.fn().mockResolvedValue({
      proceed: true,
      targetRowIdx: 0,
      targetColIdx: 0,
      enableEditor: true,
    })
    const onCellValueChange = vi.fn()

    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[{ ...columns[0], editable: true }]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
        onCellClickGuard={onCellClickGuard}
        onCellValueChange={onCellValueChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: {
        key: string
        preventDefault: () => void
        cancel?: () => void
        altKey?: boolean
        ctrlKey?: boolean
        metaKey?: boolean
      }) => void
    }

    const preventDefault = vi.fn()
    const cancel = vi.fn()
    act(() =>
      props.onKeyDown({
        key: 'x',
        preventDefault,
        cancel,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      })
    )

    await waitFor(() =>
      expect(onCellClickGuard).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'keyboard-typing',
      })
    )
    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 0 },
      { shouldFocusCell: true, enableEditor: true }
    )
    expect(preventDefault).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
  })

  it('restores persisted scroll cell and does not replay the same cell after user scrolling', async () => {
    vi.useFakeTimers()
    const manyRows = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `row-${index + 1}`,
      info: 'SELECT 1',
    }))
    render(
      <CanvasBaseGridView
        rows={manyRows}
        columns={columns}
        editState={null}
        initialScrollCell={{ scrollRow: 7, scrollCol: 0 }}
      />
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(mockScrollToCell).toHaveBeenCalledTimes(1)
    expect(mockScrollToCell).toHaveBeenCalledWith({ rowIdx: 7, idx: 0 })

    const firstProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      onVisibleRegionChanged: (
        range: { x: number; y: number; width: number; height: number },
        tx: number,
        ty: number
      ) => void
    }

    act(() => firstProps.onVisibleRegionChanged({ x: 0, y: 7, width: 10, height: 5 }, 11, 22))

    expect(mockScrollToCell).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('reapplies a new persisted scroll cell when tab state changes', async () => {
    vi.useFakeTimers()
    const manyRows = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `row-${index + 1}`,
      info: 'SELECT 1',
    }))
    const { rerender } = render(
      <CanvasBaseGridView
        rows={manyRows}
        columns={columns}
        editState={null}
        initialScrollCell={{ scrollRow: 7, scrollCol: 0 }}
      />
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    const firstProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      onVisibleRegionChanged: (
        range: { x: number; y: number; width: number; height: number },
        tx: number,
        ty: number
      ) => void
    }
    act(() => firstProps.onVisibleRegionChanged({ x: 0, y: 7, width: 10, height: 5 }, 3, 7))

    rerender(
      <CanvasBaseGridView
        rows={manyRows}
        columns={columns}
        editState={null}
        initialScrollCell={{ scrollRow: 14, scrollCol: 0 }}
      />
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(mockScrollToCell).toHaveBeenCalledTimes(2)
    expect(mockScrollToCell).toHaveBeenLastCalledWith({ rowIdx: 14, idx: 0 })
    vi.useRealTimers()
  })

  it('reapplies the same persisted scroll cell after remounting the grid', async () => {
    vi.useFakeTimers()
    const wideColumns = [
      ...columns,
      {
        key: 'second',
        displayName: 'Second',
        dataType: 'VARCHAR',
        editable: false,
        isBinary: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
      },
      {
        key: 'third',
        displayName: 'Third',
        dataType: 'VARCHAR',
        editable: false,
        isBinary: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
      },
    ]
    const manyRows = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `row-${index + 1}`,
      second: `second-${index + 1}`,
      third: `third-${index + 1}`,
      info: 'SELECT 1',
    }))

    try {
      const { unmount } = render(
        <CanvasBaseGridView
          rows={manyRows}
          columns={wideColumns}
          editState={null}
          initialScrollCell={{ scrollRow: 7, scrollCol: 2 }}
        />
      )

      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      expect(mockScrollToCell).toHaveBeenCalledTimes(1)
      expect(mockScrollToCell).toHaveBeenLastCalledWith({ rowIdx: 7, idx: 2 })

      const firstProps = mockGlideDataGrid.mock.lastCall?.[0] as {
        onVisibleRegionChanged: (
          range: { x: number; y: number; width: number; height: number },
          tx: number,
          ty: number
        ) => void
      }

      act(() => firstProps.onVisibleRegionChanged({ x: 2, y: 7, width: 10, height: 5 }, 0, 0))
      unmount()

      render(
        <CanvasBaseGridView
          rows={manyRows}
          columns={wideColumns}
          editState={null}
          initialScrollCell={{ scrollRow: 7, scrollCol: 2 }}
        />
      )

      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      expect(mockScrollToCell).toHaveBeenCalledTimes(2)
      expect(mockScrollToCell).toHaveBeenLastCalledWith({ rowIdx: 7, idx: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores pre-restore visible-region resets before persisted scroll is replayed', async () => {
    vi.useFakeTimers()
    const manyRows = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `row-${index + 1}`,
      info: 'SELECT 1',
    }))
    const onScrollCellChange = vi.fn()

    try {
      render(
        <CanvasBaseGridView
          rows={manyRows}
          columns={columns}
          editState={null}
          initialScrollCell={{ scrollRow: 7, scrollCol: 0 }}
          onScrollCellChange={onScrollCellChange}
        />
      )

      const firstProps = mockGlideDataGrid.mock.lastCall?.[0] as {
        onVisibleRegionChanged: (
          range: { x: number; y: number; width: number; height: number },
          tx: number,
          ty: number
        ) => void
      }

      act(() => firstProps.onVisibleRegionChanged({ x: 0, y: 0, width: 10, height: 5 }, 0, 0))
      expect(onScrollCellChange).not.toHaveBeenCalled()

      await act(async () => {
        vi.runOnlyPendingTimers()
        await Promise.resolve()
      })

      expect(mockScrollToCell).toHaveBeenCalledWith({ rowIdx: 7, idx: 0 })

      act(() => firstProps.onVisibleRegionChanged({ x: 0, y: 7, width: 10, height: 5 }, 0, 0))
      expect(onScrollCellChange).not.toHaveBeenCalled()

      await act(async () => {
        vi.runOnlyPendingTimers()
        await Promise.resolve()
      })

      act(() => firstProps.onVisibleRegionChanged({ x: 3, y: 9, width: 10, height: 5 }, 0, 0))
      expect(onScrollCellChange).toHaveBeenCalledWith(9, 3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not replay restore when the parent echoes a user-persisted scroll cell back as props', async () => {
    vi.useFakeTimers()
    const wideColumns = [
      ...columns,
      {
        key: 'second',
        displayName: 'Second',
        dataType: 'VARCHAR',
        editable: false,
        isBinary: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
      },
      {
        key: 'third',
        displayName: 'Third',
        dataType: 'VARCHAR',
        editable: false,
        isBinary: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
      },
      {
        key: 'fourth',
        displayName: 'Fourth',
        dataType: 'VARCHAR',
        editable: false,
        isBinary: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
      },
      {
        key: 'fifth',
        displayName: 'Fifth',
        dataType: 'VARCHAR',
        editable: false,
        isBinary: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
      },
    ]
    const manyRows = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `row-${index + 1}`,
      second: `second-${index + 1}`,
      third: `third-${index + 1}`,
      fourth: `fourth-${index + 1}`,
      fifth: `fifth-${index + 1}`,
      info: 'SELECT 1',
    }))
    const onScrollCellChange = vi.fn()

    try {
      const { rerender } = render(
        <CanvasBaseGridView
          rows={manyRows}
          columns={wideColumns}
          editState={null}
          initialScrollCell={{ scrollRow: 7, scrollCol: 0 }}
          onScrollCellChange={onScrollCellChange}
        />
      )

      await act(async () => {
        vi.runOnlyPendingTimers()
        await Promise.resolve()
      })

      const props = mockGlideDataGrid.mock.lastCall?.[0] as {
        onVisibleRegionChanged: (
          range: { x: number; y: number; width: number; height: number },
          tx: number,
          ty: number
        ) => void
      }

      act(() => props.onVisibleRegionChanged({ x: 0, y: 7, width: 10, height: 5 }, 0, 0))

      await act(async () => {
        vi.runOnlyPendingTimers()
        await Promise.resolve()
      })

      act(() => props.onVisibleRegionChanged({ x: 4, y: 11, width: 10, height: 5 }, 0, 0))
      expect(onScrollCellChange).toHaveBeenCalledWith(11, 4)

      rerender(
        <CanvasBaseGridView
          rows={manyRows}
          columns={wideColumns}
          editState={null}
          initialScrollCell={{ scrollRow: 11, scrollCol: 4 }}
          onScrollCellChange={onScrollCellChange}
        />
      )

      await act(async () => {
        vi.runOnlyPendingTimers()
        await Promise.resolve()
      })

      expect(mockScrollToCell).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
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
      <CanvasBaseGridView
        rows={rows}
        columns={fkColumns}
        editState={null}
        onFkCellAction={onFkCellAction}
      />
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
      <CanvasBaseGridView
        rows={rows}
        columns={fkColumns}
        editState={null}
        onFkCellAction={onFkCellAction}
      />
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
      () =>
        new Promise<never>(() => {
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
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true })
    )

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
