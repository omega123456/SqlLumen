import { useCallback, useEffect, useRef, useState } from 'react'
import { useContextMenuPlacement } from '../../../../hooks/use-context-menu-placement'
import { getContextMenuPortalRoot } from '../../../../lib/context-menu-utils'
import { elementOf } from '../../../../lib/input-events'
import type { ClipboardMenuPosition } from './canvas-grid-types'

interface GridContextMenuInput {
  isActive: boolean
  cancelActiveEditor: () => void
}

function useCloseMenuOnOutsideInteraction(
  menu: ClipboardMenuPosition | null,
  closeContextMenu: () => void
): void {
  useEffect(() => {
    if (!menu) return
    const onPointerDown = (): void => closeContextMenu()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeContextMenu, menu])
}

export function useGridContextMenu(input: GridContextMenuInput) {
  const { isActive, cancelActiveEditor } = input
  const [contextMenu, setContextMenu] = useState<ClipboardMenuPosition | null>(null)
  const clipboardMenuRef = useRef<HTMLDivElement>(null)

  const handleContextMenu = useCallback<React.MouseEventHandler<HTMLDivElement>>((event) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      portalRoot: getContextMenuPortalRoot(elementOf(event.target)),
    })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useContextMenuPlacement(clipboardMenuRef, contextMenu)

  useEffect(() => {
    if (isActive) return
    queueMicrotask(closeContextMenu)
    cancelActiveEditor()
  }, [cancelActiveEditor, closeContextMenu, isActive])

  useCloseMenuOnOutsideInteraction(contextMenu, closeContextMenu)

  return { contextMenu, clipboardMenuRef, handleContextMenu, closeContextMenu }
}
