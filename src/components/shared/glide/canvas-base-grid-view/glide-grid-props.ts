import type { GridSelection, Rectangle } from '@glideapps/glide-data-grid'
import type { GridRow } from './canvas-grid-types'
import { CUSTOM_RENDERERS } from './grid-list-cells'
import type { GridSelectionModel, GridViewModel } from './grid-view-model'
import type { GridEditingParts } from './use-canvas-grid-view'
import type { useGridCellClicks } from './use-grid-cell-clicks'
import type { useGridColumns } from './use-grid-columns'
import type { useGridContextMenu } from './use-grid-context-menu'
import type { GlideKeyDownEvent } from './canvas-grid-types'

interface GlideGridPropsParts {
  model: GridViewModel
  columns: ReturnType<typeof useGridColumns>
  selection: GridSelectionModel
  editing: GridEditingParts
  clicks: ReturnType<typeof useGridCellClicks>
  handleVisibleRegionChanged: (range: Rectangle) => void
  handleKeyDown: (event: GlideKeyDownEvent) => void
  handleSelectionChange: (selection: GridSelection) => void
}

interface ClipboardMenuParts {
  contextMenu: ReturnType<typeof useGridContextMenu>
  editing: GridEditingParts
  testId: string | undefined
}

const EMPTY_GRID_ROWS: GridRow[] = []

/** Windowed grids route Copy and Cut through the app's own async path (D21). */
const WINDOWED_KEYBINDINGS = { copy: false, cut: false } as const

function gridAriaLabel(testId: string | undefined): string {
  return testId ? `${testId} data grid` : 'Data grid'
}

function rowSourceGridProps(parts: GlideGridPropsParts) {
  const { isWindowed, rowCount, props } = parts.model
  if (!isWindowed) return { rows: props.rows }
  return {
    rows: EMPTY_GRID_ROWS,
    rowCount: rowCount,
    getCellsForSelection: parts.editing.content.getCellsForSelection,
    keybindings: WINDOWED_KEYBINDINGS,
  }
}

export function buildGlideGridProps(parts: GlideGridPropsParts) {
  const { model, columns, editing, clicks } = parts
  return {
    columns: columns.glideColumns,
    ...rowSourceGridProps(parts),
    getCellContent: editing.content.getCellContent,
    customRenderers: CUSTOM_RENDERERS,
    onColumnResize: columns.handleColumnResize,
    onHeaderClicked: clicks.handleHeaderClicked,
    onCellClicked: clicks.handleCellClicked,
    onCellEdited: editing.handleCellEdited,
    onDelete: editing.clear.clearSelection,
    provideEditor: editing.editorSession.provideEditor,
    onPaste: editing.paste.handlePaste,
    onCellDoubleClicked: clicks.handleCellDoubleClicked,
    onCellActivated: editing.editorSession.handleCellActivatedForEditing,
    onFinishedEditing: editing.editorSession.handleFinishedEditing,
    onCellContextMenu: clicks.handleCellClicked,
    onVisibleRegionChanged: parts.handleVisibleRegionChanged,
    selection: parts.selection.activeGridSelection,
    onSelectionChange: parts.handleSelectionChange,
    rowMarkers: model.flags.rowMarkers,
    drawCell: editing.painting.drawCell,
    drawHeader: editing.painting.drawHeader,
    onKeyDown: parts.handleKeyDown,
    'aria-label': gridAriaLabel(model.props.testId),
    'data-testid': model.props.testId,
  }
}

function closingAfter(action: () => Promise<void>, closeContextMenu: () => void): () => void {
  return () => {
    void action()
    closeContextMenu()
  }
}

export function buildClipboardMenuProps(parts: ClipboardMenuParts) {
  const { contextMenu, clipboardMenuRef, closeContextMenu } = parts.contextMenu
  const { copySelectionToClipboard, cutSelectionToClipboard } = parts.editing.copy
  const { pasteClipboardAtSelection } = parts.editing.paste
  if (!contextMenu) return null
  return {
    menu: contextMenu,
    menuRef: clipboardMenuRef,
    testId: parts.testId,
    onCopy: closingAfter(copySelectionToClipboard, closeContextMenu),
    onCut: closingAfter(cutSelectionToClipboard, closeContextMenu),
    onPaste: closingAfter(pasteClipboardAtSelection, closeContextMenu),
  }
}
