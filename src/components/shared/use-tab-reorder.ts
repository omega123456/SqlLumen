import { HALF_DIVISOR } from '../../lib/units'

export type TabDropIndicator = 'before' | 'after'

export interface HorizontalTabReorderTarget {
  targetIndex: number
  indicator: TabDropIndicator
  insertIndex: number
}

export interface ComputeHorizontalTabReorderTargetArgs {
  draggingIndex: number
  targetIndex: number
  pointerClientX: number
  targetRect: Pick<DOMRect, 'left' | 'width'>
}

function isNoOpDrop(
  indicator: TabDropIndicator,
  draggingIndex: number,
  targetIndex: number
): boolean {
  if (indicator === 'after') return draggingIndex === targetIndex + 1
  return draggingIndex === targetIndex || draggingIndex + 1 === targetIndex
}

/**
 * Computes where a dragged tab should be inserted in a horizontal tab list.
 */
export function computeHorizontalTabReorderTarget(
  args: ComputeHorizontalTabReorderTargetArgs
): HorizontalTabReorderTarget | null {
  const { draggingIndex, targetIndex, pointerClientX, targetRect } = args
  if (draggingIndex < 0) return null
  if (targetIndex < 0) return null

  const midpoint = targetRect.left + targetRect.width / HALF_DIVISOR
  const indicator: TabDropIndicator = pointerClientX < midpoint ? 'before' : 'after'
  const insertIndex = indicator === 'before' ? targetIndex : targetIndex + 1

  if (isNoOpDrop(indicator, draggingIndex, targetIndex)) {
    return null
  }

  return {
    targetIndex,
    indicator,
    insertIndex,
  }
}
