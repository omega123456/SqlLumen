import {
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
  type FormHTMLAttributes,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import styles from './DialogShell.module.css'

export interface DialogShellProps {
  isOpen: boolean
  onClose: () => void
  /** Optional portal target. Use an open native <dialog> when the shell must render inside the top layer. */
  portalRoot?: HTMLElement | null
  maxWidth?: number
  /**
   * Panel width as a CSS length (e.g. `80vw` or `min(50vw, 720px)`). When set, the panel uses this
   * width and max-width, ignoring `maxWidth` / `fillMaxWidth` for sizing.
   */
  panelWidth?: string
  /**
   * Panel height as a CSS length (e.g. `min(50vh, 560px)`). When set, the panel uses this height and
   * max-height and lays out as a flex column so children can scroll inside.
   */
  panelHeight?: string
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
  /** When false, removes the panel’s outer padding (default 24px). Other dialogs keep default padding. */
  panelPadding?: boolean
  /** Optional class name for the dialog panel element. */
  panelClassName?: string
  /** Optional preferred focus target when the dialog opens. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Render the panel as a form with submit semantics. */
  formProps?: Omit<FormHTMLAttributes<HTMLFormElement>, 'children' | 'className' | 'style'>
  children: React.ReactNode
}

/**
 * Shared modal shell for all dialog components.
 * Handles portal rendering, backdrop click-to-dismiss, Escape key, and focus trapping.
 */
export function DialogShell({
  isOpen,
  onClose,
  portalRoot,
  maxWidth = 420,
  panelWidth,
  panelHeight,
  fillMaxWidth = false,
  testId,
  ariaLabel,
  disableFocusManagement = false,
  nonDismissible = false,
  panelPadding = true,
  panelClassName,
  initialFocusRef,
  formProps,
  children,
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, isOpen && !disableFocusManagement, initialFocusRef)
  const setFormRef = useCallback((node: HTMLFormElement | null) => {
    dialogRef.current = node as HTMLDivElement | null
  }, [])

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
  let dialogStyle: CSSProperties = panelWidth
    ? { width: panelWidth, maxWidth: panelWidth }
    : fillMaxWidth
      ? { width: widthCap, maxWidth: widthCap }
      : { maxWidth: widthCap }

  if (panelHeight) {
    dialogStyle = {
      ...dialogStyle,
      height: panelHeight,
      maxHeight: panelHeight,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }
  }

  if (!panelPadding) {
    dialogStyle = { ...dialogStyle, padding: 0 }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !nonDismissible) {
      onClose()
    }
  }

  const panelClassNameValue = `ui-elevated-surface ${styles.dialog}${
    panelClassName !== undefined ? ` ${panelClassName}` : ''
  }`
  const panelTestId = testId !== undefined ? `${testId}-panel` : undefined

  return createPortal(
    <div
      className={styles.backdrop}
      data-testid={testId}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {formProps ? (
        <form
          {...formProps}
          className={panelClassNameValue}
          ref={setFormRef}
          style={dialogStyle}
          data-testid={panelTestId}
        >
          {children}
        </form>
      ) : (
        <div
          className={panelClassNameValue}
          ref={dialogRef}
          style={dialogStyle}
          data-testid={panelTestId}
        >
          {children}
        </div>
      )}
    </div>,
    portalRoot ?? document.body
  )
}
