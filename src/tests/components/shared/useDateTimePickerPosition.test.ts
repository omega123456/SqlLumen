import { describe, expect, it } from 'vitest'
import { computePopupPosition } from '../../../components/shared/useDateTimePickerPosition'

const VIEWPORT = { width: 1200, height: 800 }
const ANCHOR_GAP_PX = 4
const POPUP_HEIGHT_PX = 380
const MINIMUM_LEFT_PX = 4

describe('computePopupPosition', () => {
  it('flips above the anchor when only the space above fits the popup', () => {
    const anchor = { top: 700, bottom: 730, left: 200 }
    expect(computePopupPosition(anchor, VIEWPORT)).toEqual({
      top: anchor.top - POPUP_HEIGHT_PX - ANCHOR_GAP_PX,
      left: anchor.left,
      flipUp: true,
    })
  })

  it('never positions the popup left of the minimum inset', () => {
    const narrowViewport = { width: 200, height: 800 }
    const anchor = { top: 100, bottom: 130, left: 50 }
    expect(computePopupPosition(anchor, narrowViewport).left).toBe(MINIMUM_LEFT_PX)
  })
})
