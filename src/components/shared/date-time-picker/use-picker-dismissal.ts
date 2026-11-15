import { useEffect, useEffectEvent, type RefObject } from 'react'
import { subscribeToTabDeactivated } from '../../../lib/workspace-tab-activity-events'
import { useDismissOnOutsideClick } from '../../connection-dialog/useDismissOnOutsideClick'
import { focusInitialPickerControl } from './date-time-picker-model'

const INITIAL_FOCUS_DELAY_MS = 50

export interface PickerDismissalInputs {
  disabled: boolean
  onCancel: () => void
  workspaceTabId?: string
}

function useDismissOnTabDeactivated(workspaceTabId: string | undefined, onCancel: () => void) {
  useEffect(() => {
    if (!workspaceTabId) return
    return subscribeToTabDeactivated(workspaceTabId, onCancel)
  }, [onCancel, workspaceTabId])
}

function useInitialPickerFocus(disabled: boolean, popupRef: RefObject<HTMLDivElement | null>) {
  const scheduleInitialFocus = useEffectEvent((): ReturnType<typeof setTimeout> | undefined => {
    if (disabled) return undefined
    return setTimeout(() => focusInitialPickerControl(popupRef.current), INITIAL_FOCUS_DELAY_MS)
  })
  useEffect(() => {
    const initialFocusTimer = scheduleInitialFocus()
    return () => clearTimeout(initialFocusTimer)
  }, [])
}

function useCancelOnEscape(disabled: boolean, onCancel: () => void) {
  useEffect(() => {
    if (disabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [disabled, onCancel])
}

export function usePickerDismissal(
  { disabled, onCancel, workspaceTabId }: PickerDismissalInputs,
  popupRef: RefObject<HTMLDivElement | null>
) {
  useDismissOnOutsideClick({ ref: popupRef, active: !disabled, onDismiss: onCancel })
  useDismissOnTabDeactivated(workspaceTabId, onCancel)
  useInitialPickerFocus(disabled, popupRef)
  useCancelOnEscape(disabled, onCancel)
}
