import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
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

interface PointerDragContext {
  options: PointerTabDragOptions
  sessionRef: RefObject<PointerDragSession | null>
  removePointerListenersRef: RefObject<(() => void) | null>
  suppressNextSelectRef: RefObject<boolean>
  setDraggingTabId: Dispatch<SetStateAction<string | null>>
  setDropTarget: Dispatch<SetStateAction<TabDropTarget | null>>
}

function clearPointerDrag(context: PointerDragContext): void {
  context.removePointerListenersRef.current?.()
  context.removePointerListenersRef.current = null
  context.sessionRef.current = null
  context.setDraggingTabId(null)
  context.setDropTarget(null)
}

function suppressNextSelect(context: PointerDragContext): void {
  context.suppressNextSelectRef.current = true
  window.setTimeout(() => {
    context.suppressNextSelectRef.current = false
  }, 0)
}

function finishPointerDrag(context: PointerDragContext, shouldCommit: boolean): void {
  const session = context.sessionRef.current
  const wasDragging = Boolean(session?.dragging)
  const insertIndex = session?.insertIndex ?? null
  const shouldReorder = shouldCommit && wasDragging && insertIndex !== null
  if (shouldReorder && session) {
    context.options.onReorder(session.tabId, insertIndex)
  }
  clearPointerDrag(context)
  if (wasDragging) {
    suppressNextSelect(context)
  }
}

function findHoveredTab(
  options: PointerTabDragOptions,
  pointer: PointerPosition
): HoveredTab | null {
  for (const tabId of options.tabIds) {
    const element = document.querySelector<HTMLElement>(
      `[data-testid="${options.tabTestIdPrefix}${tabId}"]`
    )
    const rect = element?.getBoundingClientRect()
    const isPointerOverTab = rect !== undefined && isPointerInsideRect(pointer, rect)
    if (isPointerOverTab) {
      return { tabId: tabId, rect: rect }
    }
  }
  return null
}

function clearDropTarget(context: PointerDragContext, session: PointerDragSession): void {
  session.insertIndex = null
  context.setDropTarget(null)
}

function updateDropTarget(
  context: PointerDragContext,
  session: PointerDragSession,
  pointer: PointerPosition
): void {
  const { tabIds } = context.options
  const hoveredTab = findHoveredTab(context.options, pointer)
  if (!hoveredTab) {
    clearDropTarget(context, session)
    return
  }
  const target = computeHorizontalTabReorderTarget({
    draggingIndex: tabIds.indexOf(session.tabId),
    targetIndex: tabIds.indexOf(hoveredTab.tabId),
    pointerClientX: pointer.clientX,
    targetRect: hoveredTab.rect,
  })
  if (!target) {
    clearDropTarget(context, session)
    return
  }
  session.insertIndex = target.insertIndex
  context.setDropTarget({ tabId: hoveredTab.tabId, indicator: target.indicator })
}

function activateDragPastThreshold(
  context: PointerDragContext,
  session: PointerDragSession,
  pointer: PointerPosition
): boolean {
  if (session.dragging) {
    return true
  }
  if (!hasPassedDragThreshold(session, pointer)) {
    return false
  }
  session.dragging = true
  context.setDraggingTabId(session.tabId)
  return true
}

function handlePointerMove(context: PointerDragContext, moveEvent: globalThis.PointerEvent): void {
  const session = context.sessionRef.current
  if (!session) {
    return
  }
  if (!activateDragPastThreshold(context, session, moveEvent)) {
    return
  }
  updateDropTarget(context, session, moveEvent)
}

function listenForPointerDrag(context: PointerDragContext): void {
  const handleMove = (moveEvent: globalThis.PointerEvent) => handlePointerMove(context, moveEvent)
  const handlePointerUp = () => finishPointerDrag(context, true)
  const handlePointerCancel = () => finishPointerDrag(context, false)

  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerCancel)
  context.removePointerListenersRef.current = () => {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerCancel)
  }
}

function startPointerDrag(
  context: PointerDragContext,
  tabId: string,
  event: PointerEvent<HTMLElement>
): void {
  if (shouldIgnorePointerDown(event)) {
    return
  }
  event.preventDefault()
  clearPointerDrag(context)
  context.sessionRef.current = {
    tabId: tabId,
    dragging: false,
    startX: event.clientX,
    startY: event.clientY,
    insertIndex: null,
  }
  listenForPointerDrag(context)
}

function removePointerListeners(removePointerListenersRef: RefObject<(() => void) | null>): void {
  removePointerListenersRef.current?.()
}

export function usePointerTabDrag(options: PointerTabDragOptions): PointerTabDrag {
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TabDropTarget | null>(null)
  const sessionRef = useRef<PointerDragSession | null>(null)
  const removePointerListenersRef = useRef<(() => void) | null>(null)
  const suppressNextSelectRef = useRef(false)

  useEffect(() => {
    return () => removePointerListeners(removePointerListenersRef)
  }, [])

  const context: PointerDragContext = {
    options: options,
    sessionRef: sessionRef,
    removePointerListenersRef: removePointerListenersRef,
    suppressNextSelectRef: suppressNextSelectRef,
    setDraggingTabId: setDraggingTabId,
    setDropTarget: setDropTarget,
  }

  const dropIndicatorFor = (tabId: string): TabDropIndicator | undefined => {
    if (dropTarget?.tabId !== tabId) {
      return undefined
    }
    return dropTarget.indicator
  }

  return {
    draggingTabId: draggingTabId,
    dropIndicatorFor: dropIndicatorFor,
    startPointerDrag: (tabId, event) => startPointerDrag(context, tabId, event),
    isSelectSuppressed: () => suppressNextSelectRef.current,
  }
}
