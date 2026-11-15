import { forwardRef } from 'react'
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

function CanvasBaseGridViewInner(props: CanvasBaseGridViewProps, ref: React.Ref<GridHandle>) {
  const { gridRef, handleContextMenu, gridProps, clipboardMenu } = useCanvasGridView(props, ref)
  return (
    <div
      onContextMenu={handleContextMenu}
      className="relative h-full min-h-0 w-full flex-1 border-t border-light-stroke-divider dark:border-dark-stroke-divider"
    >
      <GlideDataGrid ref={gridRef} {...gridProps} />
      {clipboardMenu && <GridClipboardMenu {...clipboardMenu} />}
    </div>
  )
}

export const CanvasBaseGridView = forwardRef(CanvasBaseGridViewInner)
