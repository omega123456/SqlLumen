import type { CSSProperties } from 'react'
import type { DropdownFixedLayout, DropdownPlacement } from './dropdown-types'

export const MAX_DROPDOWN_HEIGHT = 320
const VIEWPORT_MARGIN = 8
const FLYOUT_GAP = 4
export const FLYOUT_MIN_WIDTH = 140

type HorizontalPanelBounds = { left: number; width: number }

interface FixedPanelLayoutRequest {
  triggerRect: DOMRect
  dialogRect: DOMRect | null
  horizontal: HorizontalPanelBounds
  placement: DropdownPlacement
}

export interface DropdownPanelLayout {
  placement: DropdownPlacement
  maxHeight: number
  layout: DropdownFixedLayout
  portalContainer: HTMLElement | null
  isPortalInDialog: boolean
}

export const INITIAL_PANEL_LAYOUT: DropdownPanelLayout = {
  placement: 'bottom',
  maxHeight: MAX_DROPDOWN_HEIGHT,
  layout: { left: 0, width: 0, top: null, bottom: null },
  portalContainer: null,
  isPortalInDialog: false,
}

export function getScrollParents(node: HTMLElement | null): (HTMLElement | Window)[] {
  const list: (HTMLElement | Window)[] = [window]
  let current = node?.parentElement ?? null

  while (current) {
    const style = window.getComputedStyle(current)
    const { overflow, overflowX, overflowY } = style
    if (/(auto|scroll|overlay)/.test(overflow + overflowX + overflowY)) {
      list.push(current)
    }
    current = current.parentElement
  }

  return list
}

function unwrappedLabelWidth(panel: HTMLElement): number {
  const assignedWidth = panel.style.width
  panel.style.width = 'min-content'
  const labelWidth = Math.ceil(panel.getBoundingClientRect().width)
  panel.style.width = assignedWidth
  return labelWidth
}

interface HorizontalPanelRequest {
  triggerRect: DOMRect
  minPanelWidth: number
  labelWidth: number
}

function horizontalPanelBounds(request: HorizontalPanelRequest): HorizontalPanelBounds {
  const { triggerRect, minPanelWidth, labelWidth } = request
  const viewportWidth = window.innerWidth
  let left = triggerRect.left
  let width = Math.max(triggerRect.width, minPanelWidth, labelWidth)
  if (left < VIEWPORT_MARGIN) {
    width -= VIEWPORT_MARGIN - left
    left = VIEWPORT_MARGIN
  }
  if (left + width > viewportWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - width)
    width = Math.min(width, viewportWidth - VIEWPORT_MARGIN - VIEWPORT_MARGIN)
  }
  return { left: left, width: width }
}

function verticalPanelPlacement(
  triggerRect: DOMRect,
  panel: HTMLElement
): { placement: DropdownPlacement; maxHeight: number } {
  const desiredHeight = Math.min(panel.scrollHeight || MAX_DROPDOWN_HEIGHT, MAX_DROPDOWN_HEIGHT)
  const availableBelow = Math.max(
    0,
    window.innerHeight - VIEWPORT_MARGIN - FLYOUT_GAP - triggerRect.bottom
  )
  const availableAbove = Math.max(0, triggerRect.top - VIEWPORT_MARGIN - FLYOUT_GAP)
  const opensAbove = availableBelow < desiredHeight && availableAbove > availableBelow
  const availableSpace = opensAbove ? availableAbove : availableBelow
  return {
    placement: opensAbove ? 'top' : 'bottom',
    maxHeight: Math.max(0, Math.min(MAX_DROPDOWN_HEIGHT, Math.floor(availableSpace))),
  }
}

function fixedPanelLayout(request: FixedPanelLayoutRequest): DropdownFixedLayout {
  const { triggerRect, dialogRect, horizontal } = request
  const left = horizontal.left - (dialogRect?.left ?? 0)
  if (request.placement === 'bottom') {
    const top = triggerRect.bottom + FLYOUT_GAP - (dialogRect?.top ?? 0)
    return { left: left, width: horizontal.width, top: top, bottom: null }
  }
  const containerBottom = dialogRect?.bottom ?? window.innerHeight
  const bottom = containerBottom - triggerRect.top + FLYOUT_GAP
  return { left: left, width: horizontal.width, top: null, bottom: bottom }
}

function closestDialogElement(trigger: HTMLElement): HTMLElement | null {
  const closestDialog = trigger.closest('dialog')
  return closestDialog instanceof HTMLElement ? closestDialog : null
}

export interface PanelLayoutRequest {
  trigger: HTMLElement
  panel: HTMLElement
  minPanelWidth: number
}

export function measurePanelLayout(request: PanelLayoutRequest): DropdownPanelLayout {
  const dialog = closestDialogElement(request.trigger)
  const triggerRect = request.trigger.getBoundingClientRect()
  const horizontal = horizontalPanelBounds({
    triggerRect: triggerRect,
    minPanelWidth: request.minPanelWidth,
    labelWidth: unwrappedLabelWidth(request.panel),
  })
  const vertical = verticalPanelPlacement(triggerRect, request.panel)
  return {
    placement: vertical.placement,
    maxHeight: vertical.maxHeight,
    layout: fixedPanelLayout({
      triggerRect: triggerRect,
      dialogRect: dialog?.getBoundingClientRect() ?? null,
      horizontal: horizontal,
      placement: vertical.placement,
    }),
    portalContainer: dialog ?? document.body,
    isPortalInDialog: dialog !== null,
  }
}

export function buildListboxStyle(panelLayout: DropdownPanelLayout): CSSProperties {
  const { layout, placement } = panelLayout
  const verticalAnchor =
    placement === 'bottom'
      ? { top: `${layout.top}px`, bottom: 'auto' }
      : { bottom: `${layout.bottom}px`, top: 'auto' }
  return {
    maxHeight: `${panelLayout.maxHeight}px`,
    left: `${layout.left}px`,
    width: `${layout.width}px`,
    ...verticalAnchor,
  }
}
