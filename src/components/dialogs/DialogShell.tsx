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
import { ELEVATED_SURFACE } from '../../lib/class-names'

export interface DialogShellProps {
  isOpen: boolean
  onClose: () => void
  portalRoot?: HTMLElement | null
  maxWidth?: number
  panelWidth?: string
  panelHeight?: string
  fillMaxWidth?: boolean
  testId?: string
  ariaLabel?: string
  disableFocusManagement?: boolean
  nonDismissible?: boolean
  panelPadding?: boolean
  panelClassName?: string
  backdropClassName?: string
  initialFocusRef?: RefObject<HTMLElement | null>
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

interface DismissInputs {
  isOpen: boolean
  nonDismissible: boolean
  onClose: () => void
}

function useEscapeToClose({ isOpen, nonDismissible, onClose }: DismissInputs) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (nonDismissible) return
      if (event.key === 'Escape') {
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
}

function closeOnBackdropClick(event: React.MouseEvent, dismiss: Omit<DismissInputs, 'isOpen'>) {
  if (dismiss.nonDismissible) return
  if (event.target === event.currentTarget) {
    dismiss.onClose()
  }
}

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

  useEscapeToClose({ isOpen: isOpen, nonDismissible: nonDismissible, onClose: onClose })

  if (!isOpen) return null

  const dialogStyle = resolveDialogStyle({
    maxWidth: maxWidth,
    panelWidth: panelWidth,
    panelHeight: panelHeight,
    fillMaxWidth: fillMaxWidth,
    panelPadding: panelPadding,
  })

  return createPortal(
    <div
      className={withOptionalClassName(styles.backdrop, backdropClassName)}
      data-testid={testId}
      onClick={(event) =>
        closeOnBackdropClick(event, { nonDismissible: nonDismissible, onClose: onClose })
      }
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <DialogPanel
        formProps={formProps}
        className={withOptionalClassName(`${ELEVATED_SURFACE} ${styles.dialog}`, panelClassName)}
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
