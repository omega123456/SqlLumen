import type { DataViewState } from '../../../../stores/data-view/data-view-types'
import type { ViewMode } from '../../../../types/shared-data-view'

export type DataViewActivity = 'idle' | 'restoring' | 'sorting' | 'loading'

export interface DataViewPanelAttributes {
  role?: string
  id?: string
  'aria-labelledby'?: string
}

type PanelLayout = 'contained' | 'plain'

const PANEL_CLASSES: Record<PanelLayout, string> = {
  plain: 'relative flex min-h-0 flex-1 flex-col overflow-hidden',
  contained:
    'relative flex min-h-0 flex-1 flex-col overflow-hidden contain-layout contain-paint contain-style isolate',
}

export function hasViewFailure(view: DataViewState): boolean {
  return view.spec.error !== null || view.window.failedRange !== null
}

export function activityOf(view: DataViewState, isReloading: boolean): DataViewActivity {
  const isRestoringRows = view.residency.rows.status === 'restoring'
  if (isRestoringRows) return 'restoring'
  const isApplyingSort = view.spec.applying === 'sort'
  if (isApplyingSort) return 'sorting'
  if (isReloading) return 'loading'
  return 'idle'
}

export function panelClassNameFor(mode: ViewMode, columnCount: number): string {
  const isGridWithColumns = mode === 'grid' && columnCount > 0
  if (isGridWithColumns) return PANEL_CLASSES.contained
  return PANEL_CLASSES.plain
}
