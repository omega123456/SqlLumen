import { useLayoutEffect, type RefObject } from 'react'
import { positionContextMenuInPortal } from '../lib/context-menu-utils'

export interface ContextMenuAnchor {
  x: number
  y: number
  portalRoot: HTMLElement
}

export function useContextMenuPlacement(
  menuRef: RefObject<HTMLElement | null>,
  anchor: ContextMenuAnchor | null
) {
  const anchorX = anchor?.x
  const anchorY = anchor?.y
  const portalRoot = anchor?.portalRoot

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    if (anchorX === undefined) return
    if (anchorY === undefined) return
    if (!portalRoot) return
    const rect = menu.getBoundingClientRect()
    const position = positionContextMenuInPortal({
      portalRoot: portalRoot,
      clientX: anchorX,
      clientY: anchorY,
      menuWidth: rect.width,
      menuHeight: rect.height,
    })
    menu.style.left = `${position.x}px`
    menu.style.top = `${position.y}px`
  }, [anchorX, anchorY, menuRef, portalRoot])
}
