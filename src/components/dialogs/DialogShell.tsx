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
  /** Optional class name for the backdrop (e.g. a lighter smoke). */
  backdropClassName?: string
  /** Optional preferred focus target when the dialog opens. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Render the panel as a form with submit semantics. */
  formProps?: Omit<FormHTMLAttributes<HTMLFormElement>, 'children' | 'className' | 'style'>
  children: React.ReactNode
}

interface DialogSizing {
  maxWidth: number
  panelWidth: string | undefined
  panelHeight: string | undefined
  fillMaxWidth: boolean
  panelPadding: boolean
}

const VIEWPORT_WIDTH_CAP = '90vw'

function baseDialogStyle(sizing: DialogSizing): CSSProperties {
  if (sizing.panelWidth) return { width: sizing.panelWidth, maxWidth: sizing.panelWidth }
  const widthCap = `min(${sizing.maxWidth}px, ${VIEWPORT_WIDTH_CAP})`
  if (sizing.fillMaxWidth) return { width: widthCap, maxWidth: widthCap }
  return { maxWidth: widthCap }
}

function resolveDialogStyle(sizing: DialogSizing): CSSProperties {
  let dialogStyle = baseDialogStyle(sizing)
  if (sizing.panelHeight) {
    dialogStyle = {
      ...dialogStyle,
      height: sizing.panelHeight,
      maxHeight: sizing.panelHeight,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }
  }
  if (!sizing.panelPadding) {
    dialogStyle = { ...dialogStyle, padding: 0 }
  }
  return dialogStyle
}

function withOptionalClassName(baseClassName: string, extraClassName: string | undefined): string {
  if (!extraClassName) return baseClassName
  return `${baseClassName} ${extraClassName}`
}

function panelTestIdFor(testId: string | undefined): string | undefined {
  if (testId === undefined) return undefined
  return `${testId}-panel`
}

interface DialogPanelProps {
  formProps: DialogShellProps['formProps']
  className: string
  style: CSSProperties
  testId: string | undefined
  panelRef: RefObject<HTMLDivElement | null>
  setFormRef: (node: HTMLFormElement | null) => void
  children: React.ReactNode
}

function DialogPanel({
  formProps,
  className,
  style,
  testId,
  panelRef,
  setFormRef,
  children,
}: DialogPanelProps) {
  if (formProps) {
    return (
      <form
        {...formProps}
        className={className}
        ref={setFormRef}
        style={style}
        data-testid={testId}
      >
        {children}
      </form>
    )
  }
  return (
    <div className={className} ref={panelRef} style={style} data-testid={testId}>
      {children}
    </div>
  )
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
  backdropClassName,
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
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !nonDismissible) {
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

  const dialogStyle = resolveDialogStyle({
    maxWidth: maxWidth,
    panelWidth: panelWidth,
    panelHeight: panelHeight,
    fillMaxWidth: fillMaxWidth,
    panelPadding: panelPadding,
  })

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget && !nonDismissible) {
      onClose()
    }
  }

  const panelClassNameValue = withOptionalClassName(
    `ui-elevated-surface ${styles.dialog}`,
    panelClassName
  )

  return createPortal(
    <div
      className={withOptionalClassName(styles.backdrop, backdropClassName)}
      data-testid={testId}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <DialogPanel
        formProps={formProps}
        className={panelClassNameValue}
        style={dialogStyle}
        testId={panelTestIdFor(testId)}
        panelRef={dialogRef}
        setFormRef={setFormRef}
      >
        {children}
      </DialogPanel>
    </div>,
    portalRoot ?? document.body
  )
}
