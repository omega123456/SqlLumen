import { forwardRef } from 'react'
import { CanvasBaseGridView } from './glide/CanvasBaseGridView'
import type { GridHandle } from './glide/glide-grid-types'
import type { BaseGridViewProps } from '../../types/shared-data-view'

export const BaseGridView = forwardRef<GridHandle, BaseGridViewProps>((props, ref) => (
  <CanvasBaseGridView {...props} ref={ref} />
))

export type { GridHandle as DataGridHandle }
