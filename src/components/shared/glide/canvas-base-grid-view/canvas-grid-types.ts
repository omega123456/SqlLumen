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
  /**
   * Monotonic signal used by callers to force the grid to clear its internal
   * row-marker (checkbox) selection. Whenever this value changes, the grid
   * resets `gridSelection.rows` to empty. This lets stores that own the
   * checked-row state (e.g. after a bulk delete) push a reset down to the grid
   * so stale visual checkmarks no longer point at shifted rows.
   */
  resetSelectionKey?: number
  /**
   * Row source. When given (windowed mode), rows are read through it instead of
   * `rows`: missing rows render as skeleton cells, the visible range is
   * reported to it, and Copy/Cut/Clear/Paste fetch unloaded rows first.
   */
  rowSource?: GridRowSource<GridRow>
  /** Windowed mode: checked rows as half-open view-position ranges (D17). */
  onRowMarkerRangesChange?: (ranges: RowRange[]) => void
  /** Windowed mode: progress and expiry hooks for actions that fetch unloaded rows. */
  rowActions?: GridRowActions
}

/** Verbs of grid actions that may need to fetch unloaded rows first (wireframe 8). */
export type GridRowActionVerb = 'Copying' | 'Cutting' | 'Clearing' | 'Pasting'

/** Progress hooks a windowed grid uses for actions over unloaded rows. */
export interface GridRowActions {
  /**
   * Start tracking an action over `total` rows. `onCancel` is given when the
   * fetch spans more than one 2,000-row chunk. `finish()` returns true when the
   * progress became visible (the 1 s threshold), which gates the success toast.
   */
  begin: (
    verb: GridRowActionVerb,
    total: number,
    onCancel?: () => void
  ) => { update: (done: number) => void; finish: () => boolean }
  /** The cached result expired: route to the "Results expired" block (no toast). */
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
