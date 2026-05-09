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

/**
 * Computes where a dragged tab should be inserted in a horizontal tab list.
 */
export function computeHorizontalTabReorderTarget(
  args: ComputeHorizontalTabReorderTargetArgs
): HorizontalTabReorderTarget | null {
  const { draggingIndex, targetIndex, pointerClientX, targetRect } = args
  if (draggingIndex < 0 || targetIndex < 0) {
    return null
  }

  const midpoint = targetRect.left + targetRect.width / 2
  const indicator: TabDropIndicator = pointerClientX < midpoint ? 'before' : 'after'
  const insertIndex = indicator === 'before' ? targetIndex : targetIndex + 1

  if (
    (indicator === 'before' && draggingIndex === targetIndex) ||
    (indicator === 'before' && draggingIndex + 1 === targetIndex) ||
    (indicator === 'after' && draggingIndex === targetIndex + 1)
  ) {
    return null
  }

  return {
    targetIndex,
    indicator,
    insertIndex,
  }
}
