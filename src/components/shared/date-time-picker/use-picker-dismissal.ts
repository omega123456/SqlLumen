import { useEffect, type RefObject } from 'react'
import { subscribeToTabDeactivated } from '../../../lib/workspace-tab-activity-events'
import { useDismissOnOutsideClick } from '../../../hooks/use-dismiss-on-outside-click'
import { focusInitialPickerControl } from './date-time-picker-model'

const INITIAL_FOCUS_DELAY_MS = 50

export interface PickerDismissalInputs {
  onCancel: () => void
  workspaceTabId?: string
}

function useDismissOnTabDeactivated(workspaceTabId: string | undefined, onCancel: () => void) {
  useEffect(() => {
    if (!workspaceTabId) return
    return subscribeToTabDeactivated(workspaceTabId, onCancel)
  }, [onCancel, workspaceTabId])
}

function useInitialPickerFocus(popupRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const initialFocusTimer = setTimeout(
      () => focusInitialPickerControl(popupRef.current),
      INITIAL_FOCUS_DELAY_MS
    )
    return () => clearTimeout(initialFocusTimer)
  }, [popupRef])
}

function useCancelOnEscape(onCancel: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])
}

export function usePickerDismissal(
  { onCancel, workspaceTabId }: PickerDismissalInputs,
  popupRef: RefObject<HTMLDivElement | null>
) {
  useDismissOnOutsideClick({ ref: popupRef, active: true, onDismiss: onCancel })
  useDismissOnTabDeactivated(workspaceTabId, onCancel)
  useInitialPickerFocus(popupRef)
  useCancelOnEscape(onCancel)
}
