import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function focusWrapTarget(
  isBackward: boolean,
  firstElement: HTMLElement,
  lastElement: HTMLElement
): HTMLElement | null {
  if (isBackward) return document.activeElement === firstElement ? lastElement : null
  return document.activeElement === lastElement ? firstElement : null
}

function isEnabledElementWithin(
  container: HTMLElement,
  candidate: HTMLElement | null | undefined
): candidate is HTMLElement {
  if (!candidate) return false
  if (!container.contains(candidate)) return false
  return !candidate.hasAttribute('disabled')
}

export function useFocusTrap(
  dialogRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  initialFocusRef?: React.RefObject<HTMLElement | null>
) {
  const previousFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement

    const dialog = dialogRef.current
    if (dialog) {
      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      requestAnimationFrame(() => {
        const preferredFocus = initialFocusRef?.current
        if (isEnabledElementWithin(dialog, preferredFocus)) {
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

      const previousFocus = previousFocusRef.current
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus()
      }
    }
  }, [initialFocusRef, isOpen, dialogRef])
}
