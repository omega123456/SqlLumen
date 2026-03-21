import { useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import styles from './DialogShell.module.css'

export interface DialogShellProps {
  isOpen: boolean
  onClose: () => void
  maxWidth?: number
  /** data-testid applied to the backdrop wrapper */
  testId?: string
  /** aria-label for the dialog */
  ariaLabel?: string
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
  testId,
  ariaLabel,
  children,
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, isOpen)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
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
      <div className={styles.dialog} ref={dialogRef} style={{ maxWidth: `${maxWidth}px` }}>
        {children}
      </div>
    </div>,
    document.body
  )
}
