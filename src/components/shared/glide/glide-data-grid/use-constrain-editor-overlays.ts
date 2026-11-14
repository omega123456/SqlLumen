import { useEffect } from 'react'
import { isPositiveFiniteNumber } from '../../../../lib/value-checks'

const GLIDE_OVERLAY_WIDTH_PROPERTY = '--d19meir1-2'
const GLIDE_OVERLAY_SELECTOR = '.gdg-d19meir1'
const EDITOR_ROOT_SELECTOR = '[data-sqllumen-glide-editor-root="true"]'
const EDITOR_OVERLAY_CLASS = 'sqllumen-glide-editor-overlay'
const PORTAL_ELEMENT_ID = 'portal'

function getTargetEditorWidth(element: HTMLElement): number | null {
  const explicitWidth = Number.parseFloat(element.dataset.sqllumenEditorWidth ?? '')
  if (isPositiveFiniteNumber(explicitWidth)) {
    return explicitWidth
  }

  const computed = getComputedStyle(element)
  const minWidth = Number.parseFloat(computed.minWidth)
  if (isPositiveFiniteNumber(minWidth)) {
    return minWidth
  }

  const fallbackWidth = Number.parseFloat(computed.width)
  return isPositiveFiniteNumber(fallbackWidth) ? fallbackWidth : null
}

function applyOverlayWidth(overlayStyle: CSSStyleDeclaration, constrainedWidth: string): void {
  const currentOverlayWidth = overlayStyle.getPropertyValue(GLIDE_OVERLAY_WIDTH_PROPERTY)
  if (currentOverlayWidth !== constrainedWidth) {
    overlayStyle.setProperty(GLIDE_OVERLAY_WIDTH_PROPERTY, constrainedWidth)
  }
  if (overlayStyle.width !== constrainedWidth) overlayStyle.width = constrainedWidth
  if (overlayStyle.maxWidth !== constrainedWidth) overlayStyle.maxWidth = constrainedWidth
  if (overlayStyle.overflow !== 'hidden') overlayStyle.overflow = 'hidden'
}

function constrainGlideEditorOverlay(element: HTMLElement): void {
  const editorRoot = element.querySelector<HTMLElement>(EDITOR_ROOT_SELECTOR)
  if (!editorRoot) return

  element.classList.add(EDITOR_OVERLAY_CLASS)

  const targetWidth = getTargetEditorWidth(editorRoot)

  if (targetWidth === null) return

  applyOverlayWidth(element.style, `${Math.max(1, Math.floor(targetWidth))}px`)
}

function observePortalOverlays(portal: HTMLElement): () => void {
  let animationFrameId: number | null = null
  const constrainOverlays = () => {
    animationFrameId = null
    portal
      .querySelectorAll<HTMLElement>(GLIDE_OVERLAY_SELECTOR)
      .forEach((element) => constrainGlideEditorOverlay(element))
  }
  const scheduleConstrainOverlays = () => {
    if (animationFrameId !== null) return
    animationFrameId = requestAnimationFrame(constrainOverlays)
  }

  scheduleConstrainOverlays()
  const observer = new MutationObserver(scheduleConstrainOverlays)
  observer.observe(portal, {
    attributes: true,
    attributeFilter: ['class', 'style'],
    childList: true,
    subtree: true,
  })

  return () => {
    observer.disconnect()
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  }
}

export function useConstrainEditorOverlays(): void {
  useEffect(() => {
    const portal = document.getElementById(PORTAL_ELEMENT_ID)
    if (!portal) return
    return observePortalOverlays(portal)
  }, [])
}
