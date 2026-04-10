import { useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import styles from './DialogShell.module.css'

export interface DialogShellProps {
  isOpen: boolean
  onClose: () => void
  maxWidth?: number
  /** When true, the panel uses the full width up to maxWidth (vs shrinking to content with fit-content). */
  fillMaxWidth?: boolean
  /** data-testid applied to the backdrop wrapper; inner surface gets `${testId}-panel` for scoped screenshots */
  testId?: string
  /** aria-label for the dialog */
  ariaLabel?: string
  /** When true, skip focus trap (used with VITE_PLAYWRIGHT for deterministic screenshots). */
  disableFocusManagement?: boolean
  /** When true, ignore backdrop clicks and Escape key dismissal. */
  nonDismissible?: boolean
  /** Optional class name for the dialog panel element. */
  panelClassName?: string
  children: React.ReactNode
}

/**
 * Shared modal shell for all dialog components.
 * Handles portal rendering, backdrop click-to-dismiss, Escape key, and focus trapping.
 */
export function DialogShell({
  isOpen,
  onClose,
  maxWidth = 420,
  fillMaxWidth = false,
  testId,
  ariaLabel,
  disableFocusManagement = false,
  nonDismissible = false,
  panelClassName,
  children,
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, isOpen && !disableFocusManagement)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !nonDismissible) {
        onClose()
      }
    },
    [nonDismissible, onClose]
  )

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const widthCap = `min(${maxWidth}px, 90vw)`
  const dialogStyle: CSSProperties = fillMaxWidth
    ? { width: widthCap, maxWidth: widthCap }
    : { maxWidth: widthCap }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !nonDismissible) {
      onClose()
    }
  }

  return createPortal(
    <div
      className={styles.backdrop}
      data-testid={testId}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className={`ui-elevated-surface ${styles.dialog}${panelClassName !== undefined ? ` ${panelClassName}` : ''}`}
        ref={dialogRef}
        style={dialogStyle}
        data-testid={testId !== undefined ? `${testId}-panel` : undefined}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
