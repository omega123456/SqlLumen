import { describe, expect, it } from 'vitest'
import { computeHorizontalTabReorderTarget } from '../../../components/shared/use-tab-reorder'

describe('computeHorizontalTabReorderTarget', () => {
  it('returns before target when pointer is on left half', () => {
    const target = computeHorizontalTabReorderTarget({
      draggingIndex: 3,
      targetIndex: 1,
      pointerClientX: 120,
      targetRect: { left: 100, width: 80 } as DOMRect,
    })

    expect(target).toEqual({
      targetIndex: 1,
      indicator: 'before',
      insertIndex: 1,
    })
  })

  it('returns after target when pointer is on right half', () => {
    const target = computeHorizontalTabReorderTarget({
      draggingIndex: 0,
      targetIndex: 1,
      pointerClientX: 170,
      targetRect: { left: 100, width: 80 } as DOMRect,
    })

    expect(target).toEqual({
      targetIndex: 1,
      indicator: 'after',
      insertIndex: 2,
    })
  })

  it('returns null for a no-op before placement', () => {
    const target = computeHorizontalTabReorderTarget({
      draggingIndex: 1,
      targetIndex: 1,
      pointerClientX: 120,
      targetRect: { left: 100, width: 80 } as DOMRect,
    })

    expect(target).toBeNull()
  })

  it('returns null for a no-op after placement', () => {
    const target = computeHorizontalTabReorderTarget({
      draggingIndex: 2,
      targetIndex: 1,
      pointerClientX: 179,
      targetRect: { left: 100, width: 80 } as DOMRect,
    })

    expect(target).toBeNull()
  })

  it('returns null for a no-op before placement onto the immediate right neighbor', () => {
    const target = computeHorizontalTabReorderTarget({
      draggingIndex: 1,
      targetIndex: 2,
      pointerClientX: 120,
      targetRect: { left: 100, width: 80 } as DOMRect,
    })

    expect(target).toBeNull()
  })
})
