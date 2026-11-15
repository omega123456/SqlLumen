import { forwardRef, useCallback, useMemo, useRef, useState } from 'react'
import type {
  DataEditorRef,
  GridColumn as GlideGridColumn,
  GridSelection,
} from '@glideapps/glide-data-grid'
import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { useElementSize } from '../../../hooks/use-element-size'
import type { GridHandle } from './glide-grid-types'
import { GlideDataEditor } from './glide-data-grid/GlideDataEditor'
import { rowMarkerSettings, type GlideDataGridProps } from './glide-data-grid/glide-data-grid-types'
import { useCompositingLayerRefresh } from './glide-data-grid/use-compositing-layer-refresh'
import { useConstrainEditorOverlays } from './glide-data-grid/use-constrain-editor-overlays'
import { useGlideGridHandle } from './glide-data-grid/use-glide-grid-handle'

export type {
  GetCellsForSelection,
  GlideDataGridProps,
  GlideRowMarkerKind,
} from './glide-data-grid/glide-data-grid-types'

const DEFAULT_COLUMN_WIDTH = 120
const GLIDE_HOST_CLASS =
  'h-full min-h-0 w-full min-w-0 bg-light-surface-container-lowest text-light-on-surface dark:bg-dark-surface-container-lowest dark:text-dark-on-surface'
const DEFAULT_GRID_ARIA_LABEL = 'Data grid'

function getColumnWidth(column: GlideGridColumn): number {
  if (!('width' in column)) return DEFAULT_COLUMN_WIDTH
  return typeof column.width === 'number' ? column.width : DEFAULT_COLUMN_WIDTH
}

function gridAriaLabel(ariaLabel: string | undefined, testId: string | undefined): string {
  return ariaLabel ?? testId ?? DEFAULT_GRID_ARIA_LABEL
}

function placeholderTestId(testId: string | undefined): string | undefined {
  if (!testId) return undefined
  return `${testId}-placeholder`
}

function useGlideSelection<TRow>(props: GlideDataGridProps<TRow>) {
  const { selection, onSelectionChange } = props
  const [internalSelection, setInternalSelection] = useState<GridSelection | undefined>(undefined)
  const handleSelectionChange = useCallback(
    (nextSelection: GridSelection) => {
      if (selection === undefined) setInternalSelection(nextSelection)
      onSelectionChange?.(nextSelection)
    },
    [onSelectionChange, selection]
  )
  return {
    activeSelection: selection ?? internalSelection,
    handleSelectionChange: handleSelectionChange,
  }
}

function GlideDataGridInner<TRow>(props: GlideDataGridProps<TRow>, ref: React.Ref<GridHandle>) {
  const { columns, rowMarkers = 'none', 'aria-label': ariaLabel, 'data-testid': testId } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<DataEditorRef | null>(null)
  const size = useElementSize(hostRef)
  const hasSize = size.width > 0 && size.height > 0
  useCompositingLayerRefresh({ hostRef, hasSize, size })
  useConstrainEditorOverlays()
  const { activeSelection, handleSelectionChange } = useGlideSelection(props)
  useGlideGridHandle(ref, { hostRef, editorRef, handleSelectionChange })
  const serializedColumnWidths = useMemo(
    () => JSON.stringify(columns.map(getColumnWidth)),
    [columns]
  )
  const markerSettings = rowMarkerSettings(rowMarkers)

  return (
    <div
      ref={hostRef}
      className={joinClassNames([GLIDE_HOST_CLASS, FOCUS_RING, props.className])}
      data-sqllumen-glide-host=""
      data-testid={testId}
      data-glide-column-width={serializedColumnWidths}
      data-row-marker-width={String(markerSettings.width)}
      role="grid"
      aria-label={gridAriaLabel(ariaLabel, testId)}
      tabIndex={0}
    >
      {hasSize ? (
        <GlideDataEditor
          gridProps={props}
          editorRef={editorRef}
          size={size}
          activeSelection={activeSelection}
          onSelectionChange={handleSelectionChange}
          markerSettings={markerSettings}
        />
      ) : (
        <div data-testid={placeholderTestId(testId)} />
      )}
    </div>
  )
}

export const GlideDataGrid = forwardRef(GlideDataGridInner) as <TRow>(
  props: GlideDataGridProps<TRow> & { ref?: React.Ref<GridHandle> }
) => React.ReactElement | null
