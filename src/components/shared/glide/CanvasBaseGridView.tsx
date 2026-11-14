import { forwardRef, type CSSProperties } from 'react'
import { GlideDataGrid } from './GlideDataGrid'
import type { GridHandle } from './glide-grid-types'
import type { CanvasBaseGridViewProps } from './canvas-base-grid-view/canvas-grid-types'
import { GridClipboardMenu } from './canvas-base-grid-view/GridClipboardMenu'
import { useCanvasGridView } from './canvas-base-grid-view/use-canvas-grid-view'

export type {
  CanvasBaseGridViewProps,
  GridRowActions,
  GridRowActionVerb,
} from './canvas-base-grid-view/canvas-grid-types'

const GRID_WELL_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  flex: 1,
  minHeight: 0,
  boxSizing: 'border-box',
  borderTop: '1px solid var(--stroke-divider)',
}

function CanvasBaseGridViewInner(props: CanvasBaseGridViewProps, ref: React.Ref<GridHandle>) {
  const { gridRef, handleContextMenu, gridProps, clipboardMenu } = useCanvasGridView(props, ref)
  return (
    <div onContextMenu={handleContextMenu} style={GRID_WELL_STYLE}>
      <GlideDataGrid ref={gridRef} {...gridProps} />
      {clipboardMenu && <GridClipboardMenu {...clipboardMenu} />}
    </div>
  )
}

export const CanvasBaseGridView = forwardRef(CanvasBaseGridViewInner)
