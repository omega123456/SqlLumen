import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { FLYOUT_MIN_WIDTH, INITIAL_PANEL_LAYOUT, measurePanelLayout } from './dropdown-layout'
import type { DropdownPanelLayout } from './dropdown-layout'
import {
  applyTriggerLabel,
  assignForwardedRef,
  resolveSelectedLabel,
  selectedOptionsOf,
} from './dropdown-labels'
import type { DropdownElementRefs } from './DropdownChrome'
import type { DropdownProps } from './dropdown-types'

export interface DropdownRefs {
  elements: DropdownElementRefs
  forwardedRef: Ref<HTMLButtonElement> | undefined
  openRef: RefObject<boolean>
}

export interface DropdownAttachers {
  trigger: (node: HTMLButtonElement | null) => void
  panel: (node: HTMLUListElement | null) => void
}

export interface DropdownController {
  listboxId: string
  attach: DropdownAttachers
  closeListbox: () => void
  updatePlacement: () => void
  isWithinDropdownTarget: (target: EventTarget | null) => boolean
  handleTriggerBlur: (event: ReactFocusEvent<HTMLButtonElement>, open: boolean) => void
  panelLayout: DropdownPanelLayout
  selectedLabel: ReactNode
}

export function useDropdownElements(): DropdownElementRefs {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  return { rootRef: rootRef, triggerRef: triggerRef, panelRef: panelRef }
}

function useCloseListbox(elements: DropdownElementRefs, openRef: RefObject<boolean>) {
  const { panelRef, triggerRef } = elements
  return useCallback(() => {
    if (!openRef.current) {
      return
    }

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    ;(panelRef.current ?? triggerRef.current)?.dispatchEvent(event)
  }, [openRef, panelRef, triggerRef])
}

function usePanelLayout(elements: DropdownElementRefs, minPanelWidth: number) {
  const { panelRef, triggerRef } = elements
  const [panelLayout, setPanelLayout] = useState<DropdownPanelLayout>(INITIAL_PANEL_LAYOUT)

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger) return
    if (!panel) return
    setPanelLayout(
      measurePanelLayout({ trigger: trigger, panel: panel, minPanelWidth: minPanelWidth })
    )
  }, [minPanelWidth, panelRef, triggerRef])

  const setPanelRef = useCallback(
    (node: HTMLUListElement | null) => {
      panelRef.current = node
      if (node) {
        updatePlacement()
      }
    },
    [panelRef, updatePlacement]
  )

  return { panelLayout: panelLayout, updatePlacement: updatePlacement, setPanelRef: setPanelRef }
}

function useSelectedLabel<TValue extends string>(props: DropdownProps<TValue>): ReactNode {
  const selectedOptions = useMemo(() => selectedOptionsOf(props), [props])
  return useMemo(() => resolveSelectedLabel(props, selectedOptions), [props, selectedOptions])
}

function useTriggerElement<TValue extends string>(
  props: DropdownProps<TValue>,
  elements: DropdownElementRefs,
  forwardedRef: Ref<HTMLButtonElement> | undefined
) {
  const { triggerRef } = elements
  const { ariaLabel, labelledBy } = props

  useLayoutEffect(() => {
    const trigger = triggerRef.current
    if (!trigger) {
      return
    }

    applyTriggerLabel(trigger, labelledBy, ariaLabel)
  }, [ariaLabel, labelledBy, triggerRef])

  return useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node
      assignForwardedRef(forwardedRef, node)
    },
    [forwardedRef, triggerRef]
  )
}

export function useDropdownController<TValue extends string>(
  props: DropdownProps<TValue>,
  refs: DropdownRefs
): DropdownController {
  const { elements, forwardedRef, openRef } = refs
  const { focusListOnOpen = true, minPanelWidth = FLYOUT_MIN_WIDTH, onTriggerBlur } = props
  const listboxId = useId()
  const closeListbox = useCloseListbox(elements, openRef)
  const placement = usePanelLayout(elements, minPanelWidth)
  const setTriggerRef = useTriggerElement(props, elements, forwardedRef)
  const selectedLabel = useSelectedLabel(props)

  const isWithinDropdownTarget = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (elements.rootRef.current?.contains(target) === true ||
      elements.panelRef.current?.contains(target) === true)

  const handleTriggerBlur = (event: ReactFocusEvent<HTMLButtonElement>, open: boolean) => {
    onTriggerBlur?.(event)
    const isListboxKeptOpen = event.defaultPrevented || !open || focusListOnOpen
    if (isListboxKeptOpen) return
    if (isWithinDropdownTarget(event.relatedTarget)) return
    closeListbox()
  }

  return {
    listboxId: listboxId,
    attach: { trigger: setTriggerRef, panel: placement.setPanelRef },
    closeListbox: closeListbox,
    updatePlacement: placement.updatePlacement,
    isWithinDropdownTarget: isWithinDropdownTarget,
    handleTriggerBlur: handleTriggerBlur,
    panelLayout: placement.panelLayout,
    selectedLabel: selectedLabel,
  }
}
