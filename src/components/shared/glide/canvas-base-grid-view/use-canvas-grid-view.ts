import { useRef } from 'react'
import type { GridHandle } from '../glide-grid-types'
import { resolveGridBehaviourFlags, type CanvasBaseGridViewProps } from './canvas-grid-types'
import { currentSelectionCell } from './grid-selection-helpers'
import { useGridSessionRefs, type GridSelectionModel, type GridViewModel } from './grid-view-model'
import { useGridCellClicks } from './use-grid-cell-clicks'
import { useGridCellContent, useGridRowClasses } from './use-grid-cell-content'
import { useGridCellEditCommit } from './use-grid-cell-edit-commit'
import { useGridClear } from './use-grid-clear'
import { useGridColumns } from './use-grid-columns'
import { useGridContextMenu } from './use-grid-context-menu'
import { useGridCopy } from './use-grid-copy'
import { useGridEditorSession } from './use-grid-editor-session'
import { useGridKeyDown } from './use-grid-key-down'
import { useGridKeyboardSelection } from './use-grid-keyboard-selection'
import { useGridPainting } from './use-grid-painting'
import { useGridPaste } from './use-grid-paste'
import { useGridPointerSelection } from './use-grid-pointer-selection'
import { useGridRowActionRunner } from './use-grid-row-action-runner'
import { useGridRowData } from './use-grid-row-data'
import { useGridRowMarkers } from './use-grid-row-markers'
import { useGridImperativeHandle, useGridScrollRestore } from './use-grid-scroll-restore'
import { useGridSelectionState } from './use-grid-selection-state'
import { useGridTypingEditor } from './use-grid-typing-editor'
import { useGridVisibleRegion } from './use-grid-visible-region'
import { buildClipboardMenuProps, buildGlideGridProps } from './glide-grid-props'

function useGridViewModel(props: CanvasBaseGridViewProps) {
  const flags = resolveGridBehaviourFlags(props)
  const gridRef = useRef<GridHandle | null>(null)
  const refs = useGridSessionRefs()
  const { source, isWindowed, rowCount, autoSizeSampleRows } = useGridRowData(props)
  const columns = useGridColumns({ props, flags, autoSizeSampleRows })
  const model: GridViewModel = {
    props: props,
    flags: flags,
    gridRef: gridRef,
    refs: refs,
    source: source,
    isWindowed: isWindowed,
    rowCount: rowCount,
    gridColumns: columns.gridColumns,
  }
  return { model, columns }
}

export type GridEditingParts = ReturnType<typeof useGridEditingAndClipboard>

function useGridEditingAndClipboard(model: GridViewModel, selection: GridSelectionModel) {
  const rowClasses = useGridRowClasses(model.props.getRowClass)
  const { activeSelectedRowIndex, activeGridSelection } = selection
  const content = useGridCellContent({ model, rowClasses, activeSelectedRowIndex })
  const editorSession = useGridEditorSession(model)
  const handleCellEdited = useGridCellEditCommit(model)
  const runRowAction = useGridRowActionRunner(model)
  const { buildCellForRow } = content
  const clear = useGridClear({ model, handleCellEdited, runRowAction })
  const { clearCellsWithRows } = clear
  const copy = useGridCopy({
    model: model,
    activeGridSelection: activeGridSelection,
    operations: { buildCellForRow, runRowAction, clearCellsWithRows },
  })
  const paste = useGridPaste({
    model: model,
    activeSelectionCell: currentSelectionCell(activeGridSelection),
    operations: { buildCellForRow, handleCellEdited, runRowAction },
  })
  const painting = useGridPainting({ model, rowClasses, activeSelectedRowIndex })
  return { content, editorSession, handleCellEdited, clear, copy, paste, painting }
}

export function useCanvasGridView(props: CanvasBaseGridViewProps, ref: React.Ref<GridHandle>) {
  const { model, columns } = useGridViewModel(props)
  const selection = useGridSelectionState({
    props: props,
    gridRef: model.gridRef,
    source: model.source,
    previousMarkedRangesKeyRef: model.refs.selection.previousMarkedRangesKeyRef,
  })
  useGridImperativeHandle(ref, model)
  useGridScrollRestore(model)
  const editing = useGridEditingAndClipboard(model, selection)
  const { openListEditor, cancelActiveEditor } = editing.editorSession
  const handleVisibleRegionChanged = useGridVisibleRegion(model, cancelActiveEditor)
  const pointer = useGridPointerSelection({ model, selection, openListEditor })
  const clicks = useGridCellClicks(model, pointer)
  const keyboardSelection = useGridKeyboardSelection({ model, selection })
  const handleTypingActivation = useGridTypingEditor({ model, selection })
  const handleKeyDown = useGridKeyDown({
    model: model,
    selection: selection,
    actions: { ...keyboardSelection, ...editing.copy, handleTypingActivation, openListEditor },
  })
  const handleSelectionChange = useGridRowMarkers({ model, selection })
  const contextMenu = useGridContextMenu({
    isActive: model.flags.isActive,
    cancelActiveEditor: cancelActiveEditor,
  })
  return {
    gridRef: model.gridRef,
    handleContextMenu: contextMenu.handleContextMenu,
    gridProps: buildGlideGridProps({
      model,
      columns,
      selection,
      editing,
      clicks,
      handleVisibleRegionChanged,
      handleKeyDown,
      handleSelectionChange,
    }),
    clipboardMenu: buildClipboardMenuProps({
      contextMenu: contextMenu,
      editing: editing,
      testId: props.testId,
    }),
  }
}
