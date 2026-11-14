import { useCallback, type RefObject } from 'react'
import type { GridCell, Item } from '@glideapps/glide-data-grid'
import { getGlideEditor } from '../glide-editors'
import type { GridCellPosition, GridColumn, GridHandle } from '../glide-grid-types'
import type { EditorSessionBaseline, GridRow } from './canvas-grid-types'
import { buildEditorSessionBaseline, editorColumnKey } from './grid-cell-editing'
import type { GridEditorRefs, GridViewModel } from './grid-view-model'

interface ListEditorRequest {
  gridRef: RefObject<GridHandle | null>
  cell: GridCellPosition
}

const ESCAPE_KEY_CODE = 27
const DATA_GRID_CANVAS_SELECTOR = 'canvas[data-testid="data-grid-canvas"]'

function finishEditorSession(editorRefs: GridEditorRefs): void {
  editorRefs.isEditingCellRef.current = false
  editorRefs.editorSessionBaselineRef.current = null
  editorRefs.pendingTypingActivationRef.current = null
}

function startEditorSession(
  editorRefs: GridEditorRefs,
  baseline: EditorSessionBaseline | null
): void {
  editorRefs.editorSessionBaselineRef.current = baseline
  editorRefs.isEditingCellRef.current = true
}

function dispatchEscapeToGridCanvas(gridRef: RefObject<GridHandle | null>): void {
  const canvas = gridRef.current?.element?.querySelector(DATA_GRID_CANVAS_SELECTOR)
  canvas?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      keyCode: ESCAPE_KEY_CODE,
      which: ESCAPE_KEY_CODE,
      bubbles: true,
    })
  )
}

function openListEditorOnce(editorRefs: GridEditorRefs, request: ListEditorRequest): void {
  if (editorRefs.listEditorOpeningRef.current) return
  editorRefs.listEditorOpeningRef.current = true
  request.gridRef.current?.selectCell(request.cell, { shouldFocusCell: true, enableEditor: true })
  requestAnimationFrame(() => {
    editorRefs.listEditorOpeningRef.current = false
  })
}

function findEditorColumn(
  gridColumns: GridColumn<GridRow>[],
  cell: GridCell
): GridColumn<GridRow> | undefined {
  const columnKey = editorColumnKey(cell)
  if (!columnKey) return undefined
  return gridColumns.find((candidate) => candidate.key === columnKey)
}

export function useGridEditorSession(model: GridViewModel) {
  const { gridRef, gridColumns, source } = model
  const { editableColumnKeys, editState } = model.props
  const editorRefs = model.refs.editor

  const openListEditor = useCallback(
    (cell: GridCellPosition): void =>
      openListEditorOnce(editorRefs, { gridRef: gridRef, cell: cell }),
    [editorRefs, gridRef]
  )

  const provideEditor = useCallback(
    (cell: GridCell) => {
      const column = findEditorColumn(gridColumns, cell)
      if (!column) return undefined
      const isEditableColumn = editableColumnKeys?.has(column.key) === true
      if (!isEditableColumn) return undefined
      return getGlideEditor(column as GridColumn<unknown>, column.editorType ?? 'text') ?? undefined
    },
    [editableColumnKeys, gridColumns]
  )

  const handleFinishedEditing = useCallback(() => finishEditorSession(editorRefs), [editorRefs])

  const cancelActiveEditor = useCallback(() => {
    if (!editorRefs.isEditingCellRef.current) return
    // Glide overlays do not auto-close when commitOnOutsideClick is disabled, so close before scrolling.
    dispatchEscapeToGridCanvas(gridRef)
    handleFinishedEditing()
  }, [editorRefs, gridRef, handleFinishedEditing])

  const handleCellActivatedForEditing = useCallback(
    ([columnIndex, rowIndex]: Item) => {
      const baseline = buildEditorSessionBaseline({
        row: source.getRow(rowIndex),
        column: gridColumns[columnIndex],
        rowIndex: rowIndex,
        editState: editState,
      })
      startEditorSession(editorRefs, baseline)
    },
    [editState, editorRefs, gridColumns, source]
  )

  return {
    openListEditor,
    provideEditor,
    handleFinishedEditing,
    cancelActiveEditor,
    handleCellActivatedForEditing,
  }
}
