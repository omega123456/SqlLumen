import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Traps focus within the referenced element when `isOpen` is true.
 * On open: saves the previously-focused element and focuses the first focusable child.
 * On Tab/Shift+Tab: cycles focus within the element.
 * On close: restores focus to the previously-focused element.
 */
function focusWrapTarget(
  isBackward: boolean,
  firstElement: HTMLElement,
  lastElement: HTMLElement
): HTMLElement | null {
  if (isBackward) return document.activeElement === firstElement ? lastElement : null
  return document.activeElement === lastElement ? firstElement : null
}

export function useFocusTrap(
  dialogRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  initialFocusRef?: React.RefObject<HTMLElement | null>
) {
  const previousFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!isOpen) return

    // Save the currently focused element to restore on close
    previousFocusRef.current = document.activeElement

    // Focus the first focusable element inside the dialog
    const dialog = dialogRef.current
    if (dialog) {
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      // Use requestAnimationFrame to ensure the dialog is rendered before focusing
      requestAnimationFrame(() => {
        const preferredFocus = initialFocusRef?.current
        if (
          preferredFocus &&
          dialog.contains(preferredFocus) &&
          !preferredFocus.hasAttribute('disabled')
        ) {
          preferredFocus.focus()
          return
        }

        firstFocusable?.focus()
      })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return

      const currentDialog = dialogRef.current
      if (!currentDialog) return

      const focusableElements = Array.from(
        currentDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      )
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      const wrapTarget = focusWrapTarget(event.shiftKey, firstElement, lastElement)
      if (!wrapTarget) return
      event.preventDefault()
      wrapTarget.focus()
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)

      // Restore focus to the previously focused element
      const previousFocus = previousFocusRef.current
      if (previousFocus && previousFocus instanceof HTMLElement) {
        previousFocus.focus()
      }
    }
  }, [initialFocusRef, isOpen, dialogRef])
}
