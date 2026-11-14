import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { isTargetInside } from '../../../lib/input-events'
import { subscribeToTabDeactivated } from '../../../lib/workspace-tab-activity-events'
import { getScrollParents } from './dropdown-layout'

export interface DropdownElementRefs {
  rootRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
  panelRef: RefObject<HTMLUListElement | null>
}

export type DropdownChromeProps = {
  open: boolean
  optionCount: number
  elements: DropdownElementRefs
  workspaceTabId?: string
  focusListOnOpen: boolean
  onOpenChange?: (open: boolean) => void
  closeListbox: () => void
  updatePlacement: () => void
}

function useOpenChangeNotifier(open: boolean, onOpenChange?: (open: boolean) => void) {
  const previousOpenRef = useRef(open)
  useEffect(() => {
    if (previousOpenRef.current === open) return
    previousOpenRef.current = open
    onOpenChange?.(open)
  }, [open, onOpenChange])
}

function useCloseOnOutsideMouseDown({
  open,
  elements,
  closeListbox,
}: Pick<DropdownChromeProps, 'open' | 'elements' | 'closeListbox'>) {
  const { rootRef, panelRef } = elements
  useEffect(() => {
    if (!open) {
      return
    }

    const handleMouseDown = (event: MouseEvent) => {
      const isInsideDropdown =
        isTargetInside(rootRef.current, event.target) ||
        isTargetInside(panelRef.current, event.target)
      if (isInsideDropdown) {
        return
      }

      closeListbox()
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [closeListbox, open, panelRef, rootRef])
}

function useCloseOnTabDeactivated(workspaceTabId: string | undefined, closeListbox: () => void) {
  useEffect(() => {
    if (!workspaceTabId) {
      return
    }

    return subscribeToTabDeactivated(workspaceTabId, closeListbox)
  }, [closeListbox, workspaceTabId])
}

function useFocusListOnOpen({
  open,
  focusListOnOpen,
  elements,
}: Pick<DropdownChromeProps, 'open' | 'focusListOnOpen' | 'elements'>) {
  const { panelRef } = elements
  useLayoutEffect(() => {
    if (!open) return
    if (!focusListOnOpen) return

    queueMicrotask(() => {
      panelRef.current?.focus()
    })
  }, [focusListOnOpen, open, panelRef])
}

function usePlacementTracking({
  open,
  optionCount,
  elements,
  updatePlacement,
}: Pick<DropdownChromeProps, 'open' | 'optionCount' | 'elements' | 'updatePlacement'>) {
  const { triggerRef, panelRef } = elements
  const scrollParentsRef = useRef<Set<EventTarget> | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger) return
    if (!panel) return

    updatePlacement()

    if (!scrollParentsRef.current) {
      scrollParentsRef.current = new Set<EventTarget>(getScrollParents(trigger))
    }
    const scrollParents = scrollParentsRef.current

    scrollParents.forEach((target) => {
      target.addEventListener('scroll', updatePlacement, { passive: true })
    })
    window.addEventListener('resize', updatePlacement)

    return () => {
      scrollParents.forEach((target) => {
        target.removeEventListener('scroll', updatePlacement)
      })
      window.removeEventListener('resize', updatePlacement)
    }
  }, [open, optionCount, panelRef, triggerRef, updatePlacement])
}

export function DropdownChrome(props: DropdownChromeProps) {
  useOpenChangeNotifier(props.open, props.onOpenChange)
  useCloseOnOutsideMouseDown(props)
  useCloseOnTabDeactivated(props.workspaceTabId, props.closeListbox)
  useFocusListOnOpen(props)
  usePlacementTracking(props)
  return null
}
