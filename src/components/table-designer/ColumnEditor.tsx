import { useState } from 'react'
import type { TableDesignerColumnDef } from '../../types/schema'
import { useTableDesignerStore, type DesignerFieldEdit } from '../../stores/table-designer-store'
import styles from './ColumnEditor.module.css'
import {
  clampSelection,
  getSelectionAfterDelete,
  getSelectionAfterReorder,
  selectionMoves,
  type ActiveCell,
  type TraversalDirection,
} from './column-editor-model'
import { ColumnRow, type ColumnRowController } from './ColumnEditorRow'
import { useColumnRowDrag, type RowMove } from './useColumnRowDrag'
import {
  ColumnEditorHead,
  ColumnEditorToolbar,
  GhostAddRow,
} from './column-editor/ColumnEditorChrome'
import { dragRowHeightStyle, rowKeyFor } from './column-editor/column-editor-dom'
import { editableKeyDownHandler } from './column-editor/editable-key-handlers'
import { useColumnCellFocus } from './column-editor/use-column-cell-focus'
import { useDefaultCellControls } from './column-editor/use-default-cell-controls'
import { useEditStartValues } from './column-editor/use-edit-start-values'

interface ColumnEditorProps {
  tabId: string
}

function useColumnEditorStore(tabId: string) {
  return {
    tabState: useTableDesignerStore((state) => state.tabs[tabId]),
    addColumn: useTableDesignerStore((state) => state.addColumn),
    deleteColumn: useTableDesignerStore((state) => state.deleteColumn),
    reorderColumn: useTableDesignerStore((state) => state.reorderColumn),
    updateColumn: useTableDesignerStore((state) => state.updateColumn),
  }
}

function useColumnEditor(tabId: string) {
  const store = useColumnEditorStore(tabId)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const columns = store.tabState?.currentSchema.columns ?? []
  const columnCount = columns.length
  const effectiveSelectedIndex = clampSelection(selectedIndex, columnCount)
  const editStart = useEditStartValues()
  const cellFocus = useColumnCellFocus(columnCount)
  const defaults = useDefaultCellControls(editStart)
  const rowDrag = useColumnRowDrag({
    columnCount: columnCount,
    onSelect: setSelectedIndex,
    onReorder: ({ from, to }: RowMove) => {
      store.reorderColumn(tabId, from, to)
      setSelectedIndex((current) => getSelectionAfterReorder(current, from, to))
    },
  })
  return {
    store,
    columns,
    columnCount,
    effectiveSelectedIndex,
    setSelectedIndex,
    activeCell,
    setActiveCell,
    editStart,
    cellFocus,
    defaults,
    rowDrag,
  }
}

type ColumnEditorState = ReturnType<typeof useColumnEditor>

function useRowController(tabId: string, editor: ColumnEditorState): ColumnRowController {
  const { store, activeCell, editStart, cellFocus, defaults, setSelectedIndex } = editor
  return {
    tabId: tabId,
    tabState: store.tabState,
    updateColumn: (edit: DesignerFieldEdit<TableDesignerColumnDef>) =>
      store.updateColumn(tabId, edit),
    activateCell: (cell: ActiveCell) => {
      setSelectedIndex(cell.rowIndex)
      editor.setActiveCell(cell)
    },
    focusCellLater: cellFocus.setPendingFocusCell,
    rememberEditStart: editStart.rememberEditStart,
    forgetEditStart: editStart.forgetEditStart,
    handleEditableKeyDown: editableKeyDownHandler({
      tabId: tabId,
      columnCount: editor.columnCount,
      store: store,
      editStart: editStart,
      cellFocus: cellFocus,
    }),
    isActiveCell: (cell: ActiveCell) =>
      activeCell?.rowIndex === cell.rowIndex && activeCell?.cellKey === cell.cellKey,
    deleteColumn: (columnIndex: number) => {
      defaults.clearDefaultCellBlurTimers()
      store.deleteColumn(tabId, columnIndex)
      defaults.setDefaultModeOverrideIndex((current) => (current === columnIndex ? null : current))
      setSelectedIndex((current) => getSelectionAfterDelete(current, columnIndex))
    },
    defaultCell: defaults.defaultCell,
  }
}

function useColumnEditorView(tabId: string) {
  const editor = useColumnEditor(tabId)
  const controller = useRowController(tabId, editor)
  const { store, columnCount, effectiveSelectedIndex, setSelectedIndex } = editor

  const handleAddColumn = () => {
    store.addColumn(tabId)
    setSelectedIndex(columnCount)
  }

  const handleMoveSelected = (direction: TraversalDirection) => {
    if (effectiveSelectedIndex === null) return
    const nextIndex = effectiveSelectedIndex + direction
    store.reorderColumn(tabId, effectiveSelectedIndex, nextIndex)
    setSelectedIndex(nextIndex)
  }

  const handleDeleteSelected = () => {
    if (effectiveSelectedIndex === null) return
    controller.deleteColumn(effectiveSelectedIndex)
  }

  return {
    containerRef: editor.cellFocus.containerRef,
    tabState: store.tabState,
    columns: editor.columns,
    moves: selectionMoves(effectiveSelectedIndex, columnCount),
    effectiveSelectedIndex: effectiveSelectedIndex,
    rowDrag: editor.rowDrag,
    controller: controller,
    handleAddColumn: handleAddColumn,
    handleMoveSelected: handleMoveSelected,
    handleDeleteSelected: handleDeleteSelected,
  }
}

export function ColumnEditor({ tabId }: ColumnEditorProps) {
  const {
    containerRef,
    tabState,
    columns,
    moves,
    effectiveSelectedIndex,
    rowDrag,
    controller,
    handleAddColumn,
    handleMoveSelected,
    handleDeleteSelected,
  } = useColumnEditorView(tabId)
  if (!tabState) {
    return null
  }

  return (
    <div className={styles.container} data-testid="column-editor" ref={containerRef}>
      <ColumnEditorToolbar
        moves={moves}
        onAdd={handleAddColumn}
        onMove={handleMoveSelected}
        onDeleteSelected={handleDeleteSelected}
      />

      <div className={styles.gridCard}>
        <div className={styles.tableScroller} data-testid="column-editor-scroller">
          <table className={styles.table}>
            <ColumnEditorHead />
            <tbody
              className={`${styles.tableBody} ${rowDrag.drag ? styles.dragging : ''}`}
              style={dragRowHeightStyle(rowDrag.drag)}
            >
              {columns.map((column, columnIndex) => (
                <ColumnRow
                  key={rowKeyFor(column, columnIndex)}
                  row={{
                    column: column,
                    columnIndex: columnIndex,
                    isSelected: effectiveSelectedIndex === columnIndex,
                  }}
                  controller={controller}
                  rowDrag={rowDrag}
                />
              ))}
              <GhostAddRow onAdd={handleAddColumn} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
