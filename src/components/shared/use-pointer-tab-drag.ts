import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { computeHorizontalTabReorderTarget, type TabDropIndicator } from './use-tab-reorder'

const POINTER_DRAG_THRESHOLD_PX = 4
const PRIMARY_POINTER_BUTTON = 0
const TAB_DRAG_IGNORE_SELECTOR =
  'button,input,textarea,select,[contenteditable="true"],[data-tab-drag-ignore="true"]'

export interface TabDropTarget {
  tabId: string
  indicator: TabDropIndicator
}

export interface PointerTabDragOptions {
  tabIds: string[]
  tabTestIdPrefix: string
  onReorder: (tabId: string, insertIndex: number) => void
}

export interface PointerTabDrag {
  draggingTabId: string | null
  dropIndicatorFor: (tabId: string) => TabDropIndicator | undefined
  startPointerDrag: (tabId: string, event: PointerEvent<HTMLElement>) => void
  isSelectSuppressed: () => boolean
}

interface PointerDragSession {
  tabId: string
  dragging: boolean
  startX: number
  startY: number
  insertIndex: number | null
}

interface HoveredTab {
  tabId: string
  rect: DOMRect
}

interface PointerPosition {
  clientX: number
  clientY: number
}

export function isDragHandleBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return target.closest(TAB_DRAG_IGNORE_SELECTOR) !== null
}

function isPointerInsideRect(pointer: PointerPosition, rect: DOMRect): boolean {
  const isInsideHorizontally = pointer.clientX >= rect.left && pointer.clientX <= rect.right
  const isInsideVertically = pointer.clientY >= rect.top && pointer.clientY <= rect.bottom
  return isInsideHorizontally && isInsideVertically
}

function hasPassedDragThreshold(session: PointerDragSession, pointer: PointerPosition): boolean {
  const deltaX = pointer.clientX - session.startX
  const deltaY = pointer.clientY - session.startY
  return Math.hypot(deltaX, deltaY) >= POINTER_DRAG_THRESHOLD_PX
}

function shouldIgnorePointerDown(event: PointerEvent<HTMLElement>): boolean {
  const isSecondaryButton = event.button !== PRIMARY_POINTER_BUTTON
  return isSecondaryButton || isDragHandleBlocked(event.target)
}

export function usePointerTabDrag({
  tabIds,
  tabTestIdPrefix,
  onReorder,
}: PointerTabDragOptions): PointerTabDrag {
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TabDropTarget | null>(null)
  const sessionRef = useRef<PointerDragSession | null>(null)
  const removePointerListenersRef = useRef<(() => void) | null>(null)
  const suppressNextSelectRef = useRef(false)

  useEffect(() => {
    return () => {
      removePointerListenersRef.current?.()
    }
  }, [])

  const clearPointerDrag = () => {
    removePointerListenersRef.current?.()
    removePointerListenersRef.current = null
    sessionRef.current = null
    setDraggingTabId(null)
    setDropTarget(null)
  }

  const suppressNextSelect = () => {
    suppressNextSelectRef.current = true
    window.setTimeout(() => {
      suppressNextSelectRef.current = false
    }, 0)
  }

  const finishPointerDrag = (shouldCommit: boolean) => {
    const session = sessionRef.current
    const wasDragging = Boolean(session?.dragging)
    const insertIndex = session?.insertIndex ?? null
    const shouldReorder = shouldCommit && wasDragging && insertIndex !== null
    if (shouldReorder && session) {
      onReorder(session.tabId, insertIndex)
    }
    clearPointerDrag()
    if (wasDragging) {
      suppressNextSelect()
    }
  }

  const findHoveredTab = (pointer: PointerPosition): HoveredTab | null => {
    for (const tabId of tabIds) {
      const element = document.querySelector<HTMLElement>(
        `[data-testid="${tabTestIdPrefix}${tabId}"]`
      )
      const rect = element?.getBoundingClientRect()
      const isPointerOverTab = rect !== undefined && isPointerInsideRect(pointer, rect)
      if (isPointerOverTab) {
        return { tabId: tabId, rect: rect }
      }
    }
    return null
  }

  const clearDropTarget = (session: PointerDragSession) => {
    session.insertIndex = null
    setDropTarget(null)
  }

  const updateDropTarget = (session: PointerDragSession, pointer: PointerPosition) => {
    const hoveredTab = findHoveredTab(pointer)
    if (!hoveredTab) {
      clearDropTarget(session)
      return
    }
    const target = computeHorizontalTabReorderTarget({
      draggingIndex: tabIds.indexOf(session.tabId),
      targetIndex: tabIds.indexOf(hoveredTab.tabId),
      pointerClientX: pointer.clientX,
      targetRect: hoveredTab.rect,
    })
    if (!target) {
      clearDropTarget(session)
      return
    }
    session.insertIndex = target.insertIndex
    setDropTarget({ tabId: hoveredTab.tabId, indicator: target.indicator })
  }

  const activateDragPastThreshold = (
    session: PointerDragSession,
    pointer: PointerPosition
  ): boolean => {
    if (session.dragging) {
      return true
    }
    if (!hasPassedDragThreshold(session, pointer)) {
      return false
    }
    session.dragging = true
    setDraggingTabId(session.tabId)
    return true
  }

  const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
    const session = sessionRef.current
    if (!session) {
      return
    }
    if (!activateDragPastThreshold(session, moveEvent)) {
      return
    }
    updateDropTarget(session, moveEvent)
  }

  const startPointerDrag = (tabId: string, event: PointerEvent<HTMLElement>) => {
    if (shouldIgnorePointerDown(event)) {
      return
    }
    event.preventDefault()
    clearPointerDrag()
    sessionRef.current = {
      tabId: tabId,
      dragging: false,
      startX: event.clientX,
      startY: event.clientY,
      insertIndex: null,
    }

    const handlePointerUp = () => finishPointerDrag(true)
    const handlePointerCancel = () => finishPointerDrag(false)

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    removePointerListenersRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }

  const dropIndicatorFor = (tabId: string): TabDropIndicator | undefined => {
    if (dropTarget?.tabId !== tabId) {
      return undefined
    }
    return dropTarget.indicator
  }

  const isSelectSuppressed = () => suppressNextSelectRef.current

  return {
    draggingTabId: draggingTabId,
    dropIndicatorFor: dropIndicatorFor,
    startPointerDrag: startPointerDrag,
    isSelectSuppressed: isSelectSuppressed,
  }
}
