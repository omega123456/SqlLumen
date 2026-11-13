import { useEffect, useRef, type RefObject } from 'react'
import { isTargetOutside } from '../../lib/input-events'

export interface DismissOnOutsideClick {
  ref: RefObject<HTMLElement | null>
  active: boolean
  onDismiss: () => void
  options?: { closeOnEscape?: boolean }
}

/**
 * Dismiss a popover / context-menu when the user clicks outside or (optionally) presses Escape.
 *
 * Uses `mousedown` (not `click`) so the element disappears before the click completes,
 * preventing stale-click issues.
 *
 * The `onDismiss` callback is stored in a ref so callers don't need to memoize it.
 */
export function useDismissOnOutsideClick({
  ref,
  active,
  onDismiss,
  options,
}: DismissOnOutsideClick): void {
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!active) return

    const handleMouseDown = (event: MouseEvent) => {
      if (isTargetOutside(ref.current, event.target)) {
        onDismissRef.current()
      }
    }

    const handleKeyDown = options?.closeOnEscape
      ? (event: KeyboardEvent) => {
          if (event.key === 'Escape') onDismissRef.current()
        }
      : undefined

    document.addEventListener('mousedown', handleMouseDown)
    if (handleKeyDown) document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      if (handleKeyDown) document.removeEventListener('keydown', handleKeyDown)
    }
  }, [active, ref, options?.closeOnEscape])
}
