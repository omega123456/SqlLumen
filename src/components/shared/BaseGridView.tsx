import { forwardRef } from 'react'
import { CanvasBaseGridView } from './glide/CanvasBaseGridView'
import type { GridHandle } from './glide/glide-grid-types'
import type { BaseGridViewProps } from '../../types/shared-data-view'

/**
 * Canonical shared grid entry point for query results and table data browsing.
 *
 * The implementation is backed by Glide Data Grid via CanvasBaseGridView. This
 * compatibility export keeps older imports working while all grid surfaces use
 * the same canvas-backed adapter.
 */
export const BaseGridView = forwardRef<GridHandle, BaseGridViewProps>((props, ref) => (
  <CanvasBaseGridView {...props} ref={ref} />
))

export type { GridHandle as DataGridHandle }
