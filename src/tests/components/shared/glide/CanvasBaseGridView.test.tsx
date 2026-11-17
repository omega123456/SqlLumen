import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { CompactSelection, GridCellKind, type GridSelection } from '@glideapps/glide-data-grid'
import {
  CanvasBaseGridView,
  type GridRowActions,
} from '../../../../components/shared/glide/CanvasBaseGridView'
import * as GlideDataGridModule from '../../../../components/shared/glide/GlideDataGrid'
import type { GridHandle } from '../../../../components/shared/glide/glide-grid-types'
import { expectToast } from '../../../ipc-mock'
import type { GridRowSource, RowRange } from '../../../../components/shared/glide/grid-row-source'
import { useToastStore } from '../../../../stores/toast-store'

// GlideDataGrid is a forwardRef object — vi.spyOn can't intercept it.
// Use Object.defineProperty to replace it per-test (same pattern as ResultGridView.test.tsx).

const originalGlideDataGrid = GlideDataGridModule.GlideDataGrid

const mockGlideDataGrid = vi.fn()

const mockSelectCell = vi.fn()

const mockScrollToCell = vi.fn()

type TestEditorProps = {
  target: { x: number; y: number; width: number; height: number }
  value: unknown
  onChange: (value: unknown) => void
  onFinishedEditing: () => void
}

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

  const mockFn = mockGlideDataGrid
  Object.defineProperty(GlideDataGridModule, 'GlideDataGrid', {
    value: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      mockFn(props)
      React.useImperativeHandle(ref, () => ({
        selectCell: mockSelectCell,
        scrollToCell: mockScrollToCell,
        element: null,
      }))
      return React.createElement(
        'div',
        { 'data-testid': props['data-testid'] as string | undefined },
        'glide'
      )
    }),
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  Object.defineProperty(GlideDataGridModule, 'GlideDataGrid', {
    value: originalGlideDataGrid,
    writable: true,
    configurable: true,
  })
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
    rect: vi.fn(),
    clip: vi.fn(),
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

  it('keeps columns resizable when no consumer resize callback is supplied', () => {
    render(<CanvasBaseGridView rows={rows} columns={columns} editState={null} />)
    const initialProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      columns: Array<{ width: number }>
      onColumnResize: (columnIndex: number, width: number) => void
    }

    expect(initialProps.columns[0].width).not.toBe(222)

    act(() => initialProps.onColumnResize(0, 222))

    const updatedProps = mockGlideDataGrid.mock.lastCall?.[0] as {
      columns: Array<{ width: number }>
    }
    expect(updatedProps.columns[0].width).toBe(222)
  })

  it('provides the multiline Glide editor for editable long-text columns', () => {
    render(
      <CanvasBaseGridView
        rows={[{ id: 1, notes: 'hello world' }]}
        columns={[
          {
            key: 'notes',
            displayName: 'Notes',
            dataType: 'LONGTEXT',
            editable: true,
            isBinary: false,
            isNullable: true,
            isPrimaryKey: false,
            isUniqueKey: false,
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['notes'])}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => unknown
      provideEditor: (cell: unknown) => { editor?: ComponentType<TestEditorProps> } | undefined
    }

    const editorConfig = props.provideEditor(props.getCellContent([0, 0]))
    const Editor = editorConfig?.editor

    expect(Editor).toBeDefined()
    if (!Editor) throw new Error('Expected textarea editor')

    render(
      <Editor
        target={{ x: 0, y: 0, width: 120, height: 32 }}
        value={props.getCellContent([0, 0])}
        onChange={vi.fn()}
        onFinishedEditing={vi.fn()}
      />
    )

    expect(screen.getByTestId('glide-textarea-editor')).toBeInTheDocument()
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

  it('header click cycles sorted columns from unsorted to ascending to descending to clear', () => {
    const onSortChange = vi.fn()
    const { rerender } = render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onSortChange={onSortChange}
      />
    )
    let props = mockGlideDataGrid.mock.lastCall?.[0] as { onHeaderClicked: (index: number) => void }
    props.onHeaderClicked(0)
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'ASC')

    rerender(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        sortColumn="name"
        sortDirection="ASC"
        onSortChange={onSortChange}
      />
    )
    props = mockGlideDataGrid.mock.lastCall?.[0] as { onHeaderClicked: (index: number) => void }
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

  it('row click selects the row and notifies the cell and row selection callbacks', async () => {
    const onCellSelectionChange = vi.fn()
    const onSelectedRowChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onCellSelectionChange={onCellSelectionChange}
        onSelectedRowChange={onSelectedRowChange}
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
    expect(onSelectedRowChange).toHaveBeenCalledWith(rows[0], 0)
  })

  it('context menu callback fires through context menu bridge', async () => {
    const onRowClick = vi.fn()
    render(
      <CanvasBaseGridView rows={rows} columns={columns} editState={null} onRowClick={onRowClick} />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellContextMenu: (cell: readonly [number, number], event: unknown) => void
    }
    act(() => props.onCellContextMenu([0, 0], {}))
    await waitFor(() => {
      expect(onRowClick).toHaveBeenCalledWith(rows[0], 'name')
    })
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

  it('clicking the info affordance opens the popover without selecting the row', () => {
    const onInfoCellClick = vi.fn()
    const onRowClick = vi.fn()
    const onCellSelectionChange = vi.fn()
    const onSelectedRowChange = vi.fn()

    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onInfoCellClick={onInfoCellClick}
        onRowClick={onRowClick}
        onCellSelectionChange={onCellSelectionChange}
        onSelectedRowChange={onSelectedRowChange}
        showInfoColumn={true}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellClicked: (
        cell: readonly [number, number],
        event: {
          bounds: { x: number; y: number; width: number; height: number }
          localEventX?: number
        }
      ) => void
    }

    act(() =>
      props.onCellClicked([1, 0], {
        bounds: { x: 1, y: 2, width: 120, height: 32 },
        localEventX: 110,
      })
    )

    expect(onInfoCellClick).toHaveBeenCalledWith(rows[0], expect.any(DOMRect))
    expect(onRowClick).not.toHaveBeenCalled()
    expect(onCellSelectionChange).not.toHaveBeenCalled()
    expect(onSelectedRowChange).not.toHaveBeenCalled()
  })

  it('passes row marker configuration', () => {
    render(
      <CanvasBaseGridView rows={rows} columns={columns} editState={null} rowMarkers="checkbox" />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as { rowMarkers: string }
    expect(props.rowMarkers).toBe('checkbox')
  })

  it('renders prefix checkbox columns as boolean cells and reports edits', () => {
    const onCellValueChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={[{ ...rows[0], __selected: true }]}
        columns={columns}
        editState={null}
        onCellValueChange={onCellValueChange}
        prefixColumns={[
          {
            key: '__selected',
            name: '',
            width: 34,
            resizable: false,
            sortable: false,
            cellKind: 'checkbox',
          },
        ]}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => unknown
      onCellEdited: (cell: readonly [number, number], value: unknown) => void
    }

    expect(props.getCellContent([0, 0])).toEqual(
      expect.objectContaining({
        kind: GridCellKind.Boolean,
        data: true,
        allowOverlay: false,
        readonly: false,
      })
    )

    act(() =>
      props.onCellEdited([0, 0], {
        kind: GridCellKind.Boolean,
        data: false,
        allowOverlay: false,
        readonly: false,
      })
    )

    expect(onCellValueChange).toHaveBeenCalledWith(0, '__selected', false)
  })

  it('clips info-cell text before drawing the info affordance', () => {
    render(
      <CanvasBaseGridView rows={rows} columns={columns} editState={null} showInfoColumn={true} />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      drawCell: (
        args: {
          row: number
          col: number
          ctx: CanvasRenderingContext2D
          rect: { x: number; y: number; width: number; height: number }
          theme: { linkColor: string; bgBubbleSelected: string; accentColor: string }
        },
        drawContent: () => void
      ) => void
    }
    const ctx = mockCanvasContext()
    const drawContent = vi.fn()

    props.drawCell(
      {
        row: 0,
        col: 1,
        ctx,
        rect: { x: 10, y: 20, width: 100, height: 24 },
        theme: { linkColor: 'link', bgBubbleSelected: 'selected', accentColor: 'accent' },
      },
      drawContent
    )

    expect(ctx.save).toHaveBeenCalled()
    expect(ctx.rect).toHaveBeenCalledWith(10, 20, 72, 24)
    expect(ctx.clip).toHaveBeenCalled()
    expect(drawContent).toHaveBeenCalled()
  })

  it('double-click triggers row double-click callback', () => {
    const onRowDoubleClicked = vi.fn()
    const onRowClick = vi.fn()
    const onCellSelectionChange = vi.fn()
    const onSelectedRowChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        onRowDoubleClicked={onRowDoubleClicked}
        onRowClick={onRowClick}
        onCellSelectionChange={onCellSelectionChange}
        onSelectedRowChange={onSelectedRowChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellDoubleClicked: (cell: readonly [number, number]) => void
    }
    act(() => props.onCellDoubleClicked([0, 0]))
    expect(onRowDoubleClicked).toHaveBeenCalledWith(rows[0])
    expect(onRowClick).not.toHaveBeenCalled()
    expect(onCellSelectionChange).not.toHaveBeenCalled()
    expect(onSelectedRowChange).not.toHaveBeenCalled()
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
          preventDefault?: () => void
        }
      ) => void
      onSelectionChange: (selection: { rows: Iterable<number> }) => void
    }

    act(() => {
      props.onCellEdited([0, 0], { kind: GridCellKind.Text, data: '', copyData: 'NULL' })
    })
    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', null)
    expect(onRowsChange).toHaveBeenCalledWith([{ ...rows[0], name: null }], {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })

    let deleteResult = false
    act(() => {
      deleteResult = props.onDelete({
        current: { range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] },
        rows: [],
        columns: [],
      })
    })
    expect(deleteResult).toBe(false)
    expect(onCellValueChange).toHaveBeenLastCalledWith(0, 'name', '')

    // The only column is read-only here: a paste has no target cell.
    let pasteAccepted = true
    await act(async () => {
      pasteAccepted = props.onPaste([0, 0], [['pasted']])
    })
    expect(pasteAccepted).toBe(false)
    expect(onCellClipboardEdit).not.toHaveBeenCalled()
    let pasteIgnored = true
    act(() => {
      pasteIgnored = props.onPaste([5, 0], [['ignored']])
    })
    expect(pasteIgnored).toBe(false)

    act(() => {
      props.onVisibleRegionChanged({ x: 3, y: 4, width: 10, height: 5 }, 11, 22)
    })
    expect(onScrollCellChange).toHaveBeenCalledWith(4, 3)

    const preventDefault = vi.fn()
    act(() =>
      props.onCellClicked([0, 0], {
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        localEventX: 90,
        preventDefault,
      })
    )
    // Suppresses Glide's second-click activation so the overlay editor stays closed.
    expect(preventDefault).toHaveBeenCalled()
    await waitFor(() =>
      expect(onFkCellAction).toHaveBeenCalledWith({
        rowIdx: 0,
        columnKey: 'name',
        rowData: rows[0],
        source: 'grid-pointer',
      })
    )

    act(() => {
      props.onSelectionChange({ rows: [0] })
    })
    expect(onRowMarkersChange).toHaveBeenCalledWith(rows)
  })

  it('does not mirror active row clicks into row-marker selection', async () => {
    const onSelectedRowChange = vi.fn()
    const onRowMarkersChange = vi.fn()

    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        rowMarkers="checkbox"
        onSelectedRowChange={onSelectedRowChange}
        onRowMarkersChange={onRowMarkersChange}
      />
    )

    let props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellClicked: (cell: readonly [number, number], event: unknown) => void
      selection?: { rows: { length: number } }
    }

    act(() => props.onCellClicked([0, 0], {}))

    await waitFor(() => expect(onSelectedRowChange).toHaveBeenCalledWith(rows[0], 0))

    props = mockGlideDataGrid.mock.lastCall?.[0] as typeof props
    expect(props.selection?.rows.length ?? 0).toBe(0)
    expect(onRowMarkersChange).not.toHaveBeenCalled()
  })

  it('clears row-marker checkmarks when resetSelectionKey changes', () => {
    const onRowMarkersChange = vi.fn()
    const multiRow = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]
    const { rerender } = render(
      <CanvasBaseGridView
        rows={multiRow}
        columns={columns}
        editState={null}
        rowMarkers="checkbox"
        onRowMarkersChange={onRowMarkersChange}
        resetSelectionKey={0}
      />
    )

    const captureProps = () =>
      mockGlideDataGrid.mock.lastCall?.[0] as {
        onSelectionChange: (selection: GridSelection) => void
        selection?: GridSelection
      }

    // Simulate the user checking both row markers via the grid.
    act(() => {
      captureProps().onSelectionChange({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty().add(0).add(1),
      } as GridSelection)
    })
    expect(captureProps().selection?.rows.length ?? 0).toBe(2)

    // Bumping resetSelectionKey (what a caller does after a bulk delete clears
    // the store's checked set) must clear the grid's visual checkmarks.
    rerender(
      <CanvasBaseGridView
        rows={multiRow}
        columns={columns}
        editState={null}
        rowMarkers="checkbox"
        onRowMarkersChange={onRowMarkersChange}
        resetSelectionKey={1}
      />
    )
    expect(captureProps().selection?.rows.length ?? 0).toBe(0)
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
    const onCellClipboardEdit = vi.fn(async () => true)
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[{ ...columns[0], editable: true }]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
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
    await waitFor(() =>
      expect(onCellClipboardEdit).toHaveBeenCalledWith({
        rowIdx: 0,
        rowData: rows[0],
        columnKey: 'name',
        action: 'paste',
        text: 'pasted',
      })
    )

    fireEvent.contextMenu(screen.getByTestId('clipboard-grid'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('clipboard-grid-clipboard-menu')).not.toBeInTheDocument()
  })

  it('pastes only the first line of a multi-line block in array mode and warns', async () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    const onCellClipboardEdit = vi.fn(async () => true)
    const twoColumns = [
      { ...columns[0], editable: true },
      { ...columns[0], key: 'note', displayName: 'Note', editable: true },
    ]
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={twoColumns}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name', 'note'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
        onCellClipboardEdit={onCellClipboardEdit}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onPaste: (
        target: readonly [number, number],
        values: readonly (readonly string[])[]
      ) => boolean
    }
    let accepted = true
    await act(async () => {
      accepted = props.onPaste(
        [0, 0],
        [
          ['n1', 'm1'],
          ['n2', 'm2'],
        ]
      )
    })
    // Glide's own block paste is never used.
    expect(accepted).toBe(false)
    expect(onCellClipboardEdit).toHaveBeenCalledTimes(1)
    expect(onCellClipboardEdit).toHaveBeenCalledWith(
      expect.objectContaining({ rowIdx: 0, columnKey: 'name', text: 'n1' })
    )
    expect(onCellValueChange.mock.calls).toEqual([[0, 'note', 'm1']])
    expect(onRowsChange).toHaveBeenCalledWith(expect.any(Array), {
      indexes: [0],
      column: expect.objectContaining({ key: 'note' }),
    })
    await expectToast('warning', 'Pasted one row')
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

  it('produces enum cells as official dropdown custom cells', () => {
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
      customRenderers: unknown[]
      provideEditor: (cell: unknown) => unknown
    }
    const cell = props.getCellContent([0, 0])
    expect(props.customRenderers).toHaveLength(2)
    expect(cell).toMatchObject({
      kind: GridCellKind.Custom,
      readonly: false,
      copyData: 'alpha',
      data: { kind: 'dropdown-cell', value: 'alpha', allowedValues: ['alpha', 'beta'] },
    })
    expect(props.provideEditor(cell)).toBeUndefined()
  })

  it('does not set enum dropdown activation override for read-only enum cells', () => {
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: false,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set<string>()}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => { activationBehaviorOverride?: unknown }
    }
    const cell = props.getCellContent([0, 0])
    expect(cell.activationBehaviorOverride).toBeUndefined()
  })

  it('uses a labeled NULL option for nullable enum dropdown cells', () => {
    const nullableRows = [{ id: 1, name: null, info: 'SELECT 1' }]
    render(
      <CanvasBaseGridView
        rows={nullableRows}
        columns={[
          {
            ...columns[0],
            editable: true,
            isNullable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => {
        copyData?: string
        data?: {
          value?: string | null
          allowedValues?: Array<string | { value: string; label: string }>
        }
      }
    }
    const cell = props.getCellContent([0, 0])
    const nullOption = cell.data?.allowedValues?.[0]
    expect(nullOption).toEqual({ value: expect.any(String), label: 'NULL' })
    expect(cell.data?.value).toBe(typeof nullOption === 'object' ? nullOption.value : undefined)
    expect(cell.copyData).toBe('NULL')
  })

  it('derives a nullable enum sentinel that does not collide with enum values', () => {
    const enumValues = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index))
    render(
      <CanvasBaseGridView
        rows={[{ id: 1, name: null, info: 'SELECT 1' }]}
        columns={[
          {
            ...columns[0],
            editable: true,
            isNullable: true,
            editorType: 'enum' as const,
            enumValues,
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => {
        data?: { allowedValues?: Array<string | { value: string; label: string }> }
      }
    }
    const cell = props.getCellContent([0, 0])
    const nullOption = cell.data?.allowedValues?.[0]
    expect(nullOption).toEqual({ value: '\0NULL0', label: 'NULL' })
  })

  it('suppresses FK editor behavior for enum cells even when FK metadata exists', () => {
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
    expect(cell).toMatchObject({ kind: GridCellKind.Custom, data: { kind: 'dropdown-cell' } })
    expect(props.provideEditor(cell)).toBeUndefined()
  })

  it('suppresses FK draw, right-edge click, and F4 behavior for enum columns with FK metadata', async () => {
    const onFkCellAction = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
            foreignKey,
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
        onFkCellAction={onFkCellAction}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      drawCell: (
        args: {
          row: number
          col: number
          ctx: CanvasRenderingContext2D
          rect: { x: number; y: number; width: number; height: number }
          theme: { linkColor: string; bgBubbleSelected: string; accentColor: string }
        },
        drawContent: () => void
      ) => void
      onCellClicked: (
        cell: readonly [number, number],
        event: {
          bounds?: { x: number; y: number; width: number; height: number }
          localEventX?: number
        }
      ) => void
      onKeyDown: (event: { key: string; preventDefault: () => void; cancel?: () => void }) => void
    }
    const ctx = mockCanvasContext()
    props.drawCell(
      {
        row: 0,
        col: 0,
        ctx,
        rect: { x: 0, y: 0, width: 100, height: 24 },
        theme: { linkColor: 'link', bgBubbleSelected: 'selected', accentColor: 'accent' },
      },
      vi.fn()
    )
    expect(ctx.arc).not.toHaveBeenCalled()

    act(() =>
      props.onCellClicked([0, 0], {
        bounds: { x: 0, y: 0, width: 100, height: 24 },
        localEventX: 95,
      })
    )
    props.onKeyDown({ key: 'F4', preventDefault: vi.fn(), cancel: vi.fn() })

    await Promise.resolve()
    expect(onFkCellAction).not.toHaveBeenCalled()
  })

  it('lets Glide open an editable enum dropdown when Glide activates the enum cell', async () => {
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellActivated: (cell: readonly [number, number]) => void
    }
    act(() => props.onCellActivated([0, 0]))

    await Promise.resolve()
    expect(mockSelectCell).not.toHaveBeenCalled()
  })

  it('opens an editable enum dropdown when Enter is pressed on the selected enum cell', () => {
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: { key: string; preventDefault: () => void; cancel?: () => void }) => void
    }
    const preventDefault = vi.fn()
    const cancel = vi.fn()
    props.onKeyDown({ key: 'Enter', preventDefault, cancel })

    expect(preventDefault).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 0 },
      { shouldFocusCell: true, enableEditor: true }
    )
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

  it('commits dropdown enum edits through value and row change callbacks', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellEdited: (cell: readonly [number, number], value: unknown) => void
    }
    props.onCellEdited([0, 0], {
      kind: GridCellKind.Custom,
      data: { kind: 'dropdown-cell', value: 'beta', allowedValues: ['alpha', 'beta'] },
      copyData: 'beta',
      allowOverlay: true,
      readonly: false,
    })
    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', 'beta')
    expect(onRowsChange).toHaveBeenCalledWith([{ ...rows[0], name: 'beta' }], {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
  })

  it('commits nullable enum NULL dropdown selections as null', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            isNullable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellValueChange={onCellValueChange}
        onRowsChange={onRowsChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      getCellContent: (cell: readonly [number, number]) => {
        data?: { allowedValues?: Array<{ value: string; label: string } | string> }
      }
      onCellEdited: (cell: readonly [number, number], value: unknown) => void
    }
    const renderedCell = props.getCellContent([0, 0])
    const nullOption = renderedCell.data?.allowedValues?.[0]
    const nullSentinel = typeof nullOption === 'object' ? nullOption.value : ''

    props.onCellEdited([0, 0], {
      kind: GridCellKind.Custom,
      data: {
        kind: 'dropdown-cell',
        value: nullSentinel,
        allowedValues: renderedCell.data?.allowedValues,
      },
      copyData: 'NULL',
      allowOverlay: true,
      readonly: false,
    })

    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', null)
    expect(onRowsChange).toHaveBeenCalledWith([{ ...rows[0], name: null }], {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
  })

  it('uses enum delete fallbacks for nullable and non-nullable enum columns', () => {
    const onCellValueChange = vi.fn()
    const { rerender } = render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            isNullable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        onCellValueChange={onCellValueChange}
      />
    )
    let props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onDelete: (selection: {
        current: { range: { x: number; y: number; width: number; height: number }; rangeStack: [] }
        rows: []
        columns: []
      }) => boolean
    }
    props.onDelete({
      current: { range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] },
      rows: [],
      columns: [],
    })
    expect(onCellValueChange).toHaveBeenLastCalledWith(0, 'name', null)

    rerender(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            isNullable: false,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        onCellValueChange={onCellValueChange}
      />
    )
    props = mockGlideDataGrid.mock.lastCall?.[0] as typeof props
    props.onDelete({
      current: { range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] },
      rows: [],
      columns: [],
    })
    expect(onCellValueChange).toHaveBeenLastCalledWith(0, 'name', 'alpha')
  })

  it('suppresses paste edits for enum cells', () => {
    const onCellClipboardEdit = vi.fn()
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        onCellClipboardEdit={onCellClipboardEdit}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onPaste: (
        target: readonly [number, number],
        values: readonly (readonly string[])[]
      ) => boolean
    }

    expect(props.onPaste([0, 0], [['beta']])).toBe(false)
    expect(onCellClipboardEdit).not.toHaveBeenCalled()
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

  it('keeps unchanged multi-select commits out of the dirty path', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    const multiSelectRows = [{ id: 1, name: 'alpha,beta', info: 'SELECT 1' }]

    render(
      <CanvasBaseGridView
        rows={multiSelectRows}
        columns={[
          {
            ...columns[0],
            editable: true,
            editorType: 'set' as const,
            setValues: ['alpha', 'beta', 'gamma'],
          },
        ]}
        editState={{
          rowKey: '1',
          currentValues: { name: 'alpha,beta' },
          originalValues: { name: 'alpha,beta' },
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
        value: {
          kind: GridCellKind
          data: { kind: 'multi-select-cell'; values: string[] }
        }
      ) => void
    }

    props.onCellActivated([0, 0])
    props.onCellEdited([0, 0], {
      kind: GridCellKind.Custom,
      data: { kind: 'multi-select-cell', values: ['alpha', 'beta'] },
    })

    expect(onCellValueChange).not.toHaveBeenCalled()
    expect(onRowsChange).toHaveBeenCalledWith(multiSelectRows, {
      indexes: [0],
      column: expect.objectContaining({ key: 'name' }),
    })
  })

  it('propagates changed multi-select commits through the dirty path', () => {
    const onCellValueChange = vi.fn()
    const onRowsChange = vi.fn()
    const multiSelectRows = [{ id: 1, name: 'alpha', info: 'SELECT 1' }]

    render(
      <CanvasBaseGridView
        rows={multiSelectRows}
        columns={[
          {
            ...columns[0],
            editable: true,
            editorType: 'set' as const,
            setValues: ['alpha', 'beta', 'gamma'],
          },
        ]}
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
        value: {
          kind: GridCellKind
          data: { kind: 'multi-select-cell'; values: string[] }
        }
      ) => void
    }

    props.onCellActivated([0, 0])
    props.onCellEdited([0, 0], {
      kind: GridCellKind.Custom,
      data: { kind: 'multi-select-cell', values: ['alpha', 'beta'] },
    })

    expect(onCellValueChange).toHaveBeenCalledWith(0, 'name', 'alpha,beta')
    expect(onRowsChange).toHaveBeenCalledWith([{ ...multiSelectRows[0], name: 'alpha,beta' }], {
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

  it('ArrowLeft and ArrowRight move selection between columns', () => {
    const onSelectedCellChange = vi.fn()
    const multiColumns = [
      {
        key: 'id',
        displayName: 'ID',
        dataType: 'INT',
        editable: false,
        isBinary: false,
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
      },
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
      {
        key: 'email',
        displayName: 'Email',
        dataType: 'VARCHAR',
        editable: false,
        isBinary: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
      },
    ]
    const multiRows = [{ id: 1, name: 'alpha', email: 'a@b.com' }]

    render(
      <CanvasBaseGridView
        rows={multiRows}
        columns={multiColumns}
        editState={null}
        selectedCellPosition={{ rowIdx: 0, idx: 1 }}
        onSelectedCellChange={onSelectedCellChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: { key: string; preventDefault: () => void; cancel?: () => void }) => void
    }
    const preventDefault = vi.fn()
    const cancel = vi.fn()

    // ArrowRight from column 1 should move to column 2
    act(() => props.onKeyDown({ key: 'ArrowRight', preventDefault, cancel }))
    expect(onSelectedCellChange).toHaveBeenCalledWith({ rowIdx: 0, idx: 2 })
    expect(preventDefault).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()

    onSelectedCellChange.mockClear()
    preventDefault.mockClear()
    cancel.mockClear()

    // ArrowLeft from column 1 should move to column 0
    act(() => props.onKeyDown({ key: 'ArrowLeft', preventDefault, cancel }))
    expect(onSelectedCellChange).toHaveBeenCalledWith({ rowIdx: 0, idx: 0 })
    expect(preventDefault).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
  })

  it('ArrowLeft at first column and ArrowRight at last column clamp to boundaries', () => {
    const onSelectedCellChange = vi.fn()

    // Start at column 0, pressing ArrowLeft should stay at column 0
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={columns}
        editState={null}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
        onSelectedCellChange={onSelectedCellChange}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onKeyDown: (event: { key: string; preventDefault: () => void; cancel?: () => void }) => void
    }
    const preventDefault = vi.fn()
    const cancel = vi.fn()

    // With only one column, ArrowRight at column 0 should clamp to column 0
    act(() => props.onKeyDown({ key: 'ArrowRight', preventDefault, cancel }))
    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 0 },
      { shouldFocusCell: true, enableEditor: false }
    )

    mockSelectCell.mockClear()

    // ArrowLeft at column 0 should clamp to column 0
    act(() => props.onKeyDown({ key: 'ArrowLeft', preventDefault, cancel }))
    expect(mockSelectCell).toHaveBeenCalledWith(
      { rowIdx: 0, idx: 0 },
      { shouldFocusCell: true, enableEditor: false }
    )
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

  it('cancels typing activation on a selected enum cell without opening the editor', () => {
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: true,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
        selectedCellPosition={{ rowIdx: 0, idx: 0 }}
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

    expect(preventDefault).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
    expect(mockSelectCell).not.toHaveBeenCalledWith(
      { rowIdx: 0, idx: 0 },
      expect.objectContaining({ enableEditor: true })
    )
  })

  it('does not select or open read-only enum cells on double-click', () => {
    render(
      <CanvasBaseGridView
        rows={rows}
        columns={[
          {
            ...columns[0],
            editable: false,
            editorType: 'enum' as const,
            enumValues: ['alpha', 'beta'],
          },
        ]}
        editState={null}
        isEditMode={true}
        editableColumnKeys={new Set(['name'])}
      />
    )

    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onCellDoubleClicked: (cell: readonly [number, number]) => void
    }

    act(() => props.onCellDoubleClicked([0, 0]))

    expect(mockSelectCell).not.toHaveBeenCalled()
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

  it('does not overwrite explicit navigation with a pending scroll restore', async () => {
    vi.useFakeTimers()
    const gridRef = React.createRef<GridHandle>()

    try {
      render(
        <CanvasBaseGridView
          ref={gridRef}
          rows={rows}
          columns={[...columns, { ...columns[0], key: 'right', displayName: 'Right' }]}
          editState={null}
          initialScrollCell={{ scrollRow: 0, scrollCol: 1 }}
        />
      )

      act(() => gridRef.current?.scrollToCell({ idx: 0 }, 'horizontal'))

      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      expect(mockScrollToCell).toHaveBeenCalledTimes(1)
      expect(mockScrollToCell).toHaveBeenCalledWith({ idx: 0 }, 'horizontal')
    } finally {
      vi.useRealTimers()
    }
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

  it('retries scroll restoration when initial rAF fires before DataEditor is ready', async () => {
    vi.useFakeTimers()
    const manyRows = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      name: `row-${index + 1}`,
      info: 'SELECT 1',
    }))
    const onScrollCellChange = vi.fn()

    try {
      // Simulate the scrollToCell call being a no-op on the first rAF
      // (DataEditor not mounted yet due to ResizeObserver timing).
      mockScrollToCell.mockImplementationOnce(() => {
        // no-op: DataEditor is not ready
      })

      render(
        <CanvasBaseGridView
          rows={manyRows}
          columns={columns}
          editState={null}
          initialScrollCell={{ scrollRow: 7, scrollCol: 0 }}
          onScrollCellChange={onScrollCellChange}
        />
      )

      // Run the first rAF (scrollToCell is a no-op) and the second rAF
      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      // scrollToCell was called but was a no-op
      expect(mockScrollToCell).toHaveBeenCalledWith({ rowIdx: 7, idx: 0 })

      // Now simulate the DataEditor becoming ready — it fires onVisibleRegionChanged
      // at position (0,0) since it just rendered fresh
      const props = mockGlideDataGrid.mock.lastCall?.[0] as {
        onVisibleRegionChanged: (
          range: { x: number; y: number; width: number; height: number },
          tx: number,
          ty: number
        ) => void
      }

      act(() => props.onVisibleRegionChanged({ x: 0, y: 0, width: 10, height: 5 }, 0, 0))

      // The (0,0) position must NOT be persisted to the store
      expect(onScrollCellChange).not.toHaveBeenCalled()

      // The retry rAF should now fire and scroll to the correct position
      await act(async () => {
        vi.runAllTimers()
        await Promise.resolve()
      })

      expect(mockScrollToCell).toHaveBeenCalledTimes(2)
      expect(mockScrollToCell).toHaveBeenLastCalledWith({ rowIdx: 7, idx: 0 })

      // Simulate the grid reaching the target position
      act(() => props.onVisibleRegionChanged({ x: 0, y: 7, width: 10, height: 5 }, 0, 0))

      // The target position should still not be persisted (it was a restore, not user scroll)
      expect(onScrollCellChange).not.toHaveBeenCalled()

      // Now a user-initiated scroll should be persisted normally
      act(() => props.onVisibleRegionChanged({ x: 2, y: 10, width: 10, height: 5 }, 0, 0))
      expect(onScrollCellChange).toHaveBeenCalledWith(10, 2)
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
    act(() => {
      document.dispatchEvent(event)
    })

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

    act(() => {
      props.onCellClicked([0, 0], {})
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true })
      )
    })

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
          preventDefault: () => void
        }
      ) => void
    }

    act(() =>
      props.onCellClicked([0, 0], {
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        localEventX: 90,
        preventDefault: vi.fn(),
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

  it('clearing a range copies only the changed rows', () => {
    const onRowsChange = vi.fn()
    const threeRows = [
      { id: 1, name: 'alpha', info: 'SELECT 1' },
      { id: 2, name: 'beta', info: 'SELECT 2' },
      { id: 3, name: 'gamma', info: 'SELECT 3' },
    ]
    render(
      <CanvasBaseGridView
        rows={threeRows}
        columns={columns}
        editState={null}
        onCellValueChange={vi.fn()}
        onRowsChange={onRowsChange}
      />
    )
    const props = mockGlideDataGrid.mock.lastCall?.[0] as {
      onDelete: (selection: {
        current?: { range: { x: number; y: number; width: number; height: number }; rangeStack: [] }
        rows: Iterable<number>
        columns: Iterable<number>
      }) => boolean
    }

    act(() => {
      props.onDelete({
        current: { range: { x: 0, y: 1, width: 1, height: 1 }, rangeStack: [] },
        rows: [],
        columns: [],
      })
    })

    const [nextRows, data] = onRowsChange.mock.lastCall as [
      Array<Record<string, unknown>>,
      { indexes: number[] },
    ]
    expect(data.indexes).toEqual([1])
    expect(nextRows).toEqual([threeRows[0], { ...threeRows[1], name: '' }, threeRows[2]])
    expect(nextRows[0]).toBe(threeRows[0])
    expect(nextRows[2]).toBe(threeRows[2])
    expect(nextRows[1]).not.toBe(threeRows[1])
    expect(threeRows[1].name).toBe('beta')
  })
})

describe('windowed rendering and actions over unloaded rows', () => {
  /**
   * CanvasBaseGridView in windowed mode (a row source backed by a page cache):
   * loading cells and the skeleton draw, visible-range reporting and repaint,
   * Glide's copy keybinding off, a never-fetching getCellsForSelection, and the
   * fetch-first Copy / Cut / Clear / Paste paths (D21, wireframe 8).
   */

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
    getCellsForSelection?: (rect: {
      x: number
      y: number
      width: number
      height: number
    }) => unknown
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
    return {
      key,
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      cancel: vi.fn(),
      ...extra,
    }
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
      const cells = gridProps().getCellsForSelection?.({
        x: 0,
        y: 0,
        width: 1,
        height: 3,
      }) as Array<Array<{ kind: string }>>
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

    it('draws a flat skeleton bar for unloaded rows instead of the cell content', () => {
      document.documentElement.style.setProperty(
        '--color-light-fill-neutral-selected',
        'rgb(1, 2, 3)'
      )
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
      await expectToast(
        'error',
        "Couldn't load all selected rows. No cells were cleared. Try again."
      )
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
})
