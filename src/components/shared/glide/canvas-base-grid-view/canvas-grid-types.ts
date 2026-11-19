import type { GridKeyEventArgs } from '@glideapps/glide-data-grid'
import type { BaseGridViewProps } from '../../../../types/shared-data-view'
import type { GridColumn } from '../glide-grid-types'
import type { GridRowSource, RowRange } from '../grid-row-source'

export type GridRow = Record<string, unknown>
export type GlideKeyDownEvent = GridKeyEventArgs
export type GlideDropdownOption = string | { value: string; label: string }
export type ScrollCell = { scrollRow: number; scrollCol: number }
export type RowLookup = (index: number) => GridRow | undefined

export interface EditorSessionBaseline {
  rowIndex: number
  columnKey: string
  value: unknown
}

export interface PendingTypingActivation {
  rowIndex: number
  columnKey: string
  value: string
  cancelRestoreValue: unknown
}

export type EnumGridColumn = GridColumn<GridRow> & { enumValues: string[]; editorType: 'enum' }
export type SetGridColumn = GridColumn<GridRow> & { setValues: string[]; editorType: 'set' }

export interface ClipboardMenuPosition {
  x: number
  y: number
  portalRoot: HTMLElement
}

export interface CanvasBaseGridViewProps extends BaseGridViewProps {
  rowMarkers?: 'none' | 'checkbox' | 'number' | 'both'
  onRowMarkersChange?: (selectedRows: GridRow[]) => void
  onInfoCellClick?: (row: GridRow, anchorRect: DOMRect) => void
  onSelectedRowChange?: (row: GridRow | null, rowIndex: number | null) => void
  onRowDoubleClicked?: (row: GridRow) => void
  resetSelectionKey?: number
  rowSource?: GridRowSource<GridRow>
  initialCheckedRanges?: readonly RowRange[]
  onRowMarkerRangesChange?: (ranges: RowRange[]) => void
  rowActions?: GridRowActions
}

export type GridRowActionVerb = 'Copying' | 'Cutting' | 'Clearing' | 'Pasting'

export interface GridRowActions {
  begin: (
    verb: GridRowActionVerb,
    total: number,
    onCancel?: () => void
  ) => { update: (done: number) => void; finish: () => boolean }
  onExpired: () => void
}

export interface GridBehaviourFlags {
  rowMarkers: NonNullable<CanvasBaseGridViewProps['rowMarkers']>
  showInfoColumn: boolean
  isActive: boolean
  runCellClickGuardOnKeyboardSelection: boolean
}

export function resolveGridBehaviourFlags(props: CanvasBaseGridViewProps): GridBehaviourFlags {
  return {
    rowMarkers: props.rowMarkers ?? 'none',
    showInfoColumn: props.showInfoColumn ?? false,
    isActive: props.isActive ?? true,
    runCellClickGuardOnKeyboardSelection: props.runCellClickGuardOnKeyboardSelection ?? false,
  }
}
