import { useEffect, useMemo } from 'react'

const ESTIMATED_POPUP_HEIGHT_PX = 380
const POPUP_WIDTH_PX = 300
const ANCHOR_GAP_PX = 4
const VIEWPORT_EDGE_MARGIN_PX = 8
const MINIMUM_LEFT_PX = 4

export interface PopupPosition {
  top: number
  left: number
  flipUp: boolean
}

export interface AnchorBounds {
  top: number
  bottom: number
  left: number
}

export interface ViewportSize {
  width: number
  height: number
}

const UNANCHORED_POPUP_POSITION: PopupPosition = { top: 0, left: 0, flipUp: false }

function shouldFlipAbove(anchor: AnchorBounds, viewport: ViewportSize): boolean {
  const spaceBelow = viewport.height - anchor.bottom
  const fitsBelow = spaceBelow >= ESTIMATED_POPUP_HEIGHT_PX
  const fitsAbove = anchor.top > ESTIMATED_POPUP_HEIGHT_PX
  return !fitsBelow && fitsAbove
}

function popupTop(anchor: AnchorBounds, flipUp: boolean): number {
  if (flipUp) return anchor.top - ESTIMATED_POPUP_HEIGHT_PX - ANCHOR_GAP_PX
  return anchor.bottom + ANCHOR_GAP_PX
}

function popupLeft(anchor: AnchorBounds, viewport: ViewportSize): number {
  const overflowsViewport = anchor.left + POPUP_WIDTH_PX > viewport.width
  const left = overflowsViewport
    ? viewport.width - POPUP_WIDTH_PX - VIEWPORT_EDGE_MARGIN_PX
    : anchor.left
  return Math.max(left, MINIMUM_LEFT_PX)
}

export function computePopupPosition(anchor: AnchorBounds, viewport: ViewportSize): PopupPosition {
  const flipUp = shouldFlipAbove(anchor, viewport)
  return { top: popupTop(anchor, flipUp), left: popupLeft(anchor, viewport), flipUp: flipUp }
}

function measurePopupPosition(anchorElement: HTMLElement): PopupPosition {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  return computePopupPosition(anchorElement.getBoundingClientRect(), viewport)
}

export function useDateTimePickerPosition(
  anchorElement: HTMLElement | null,
  onAnchorMissing: () => void
): PopupPosition {
  useEffect(() => {
    if (anchorElement) return
    onAnchorMissing()
  }, [anchorElement, onAnchorMissing])

  return useMemo(() => {
    if (!anchorElement) return UNANCHORED_POPUP_POSITION
    return measurePopupPosition(anchorElement)
  }, [anchorElement])
}
