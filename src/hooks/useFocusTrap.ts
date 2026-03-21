import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Traps focus within the referenced element when `isOpen` is true.
 * On open: saves the previously-focused element and focuses the first focusable child.
 * On Tab/Shift+Tab: cycles focus within the element.
 * On close: restores focus to the previously-focused element.
 */
export function useFocusTrap(dialogRef: React.RefObject<HTMLElement | null>, isOpen: boolean) {
  const previousFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!isOpen) return

    // Save the currently focused element to restore on close
    previousFocusRef.current = document.activeElement

    // Focus the first focusable element inside the dialog
    const dialog = dialogRef.current
    if (dialog) {
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (firstFocusable) {
        // Use requestAnimationFrame to ensure the dialog is rendered before focusing
        requestAnimationFrame(() => {
          firstFocusable.focus()
        })
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const currentDialog = dialogRef.current
      if (!currentDialog) return

      const focusableElements = Array.from(
        currentDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      )
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: cycle backwards
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab: cycle forwards
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)

      // Restore focus to the previously focused element
      const prevFocus = previousFocusRef.current
      if (prevFocus && prevFocus instanceof HTMLElement) {
        prevFocus.focus()
      }
    }
  }, [isOpen, dialogRef])
}
