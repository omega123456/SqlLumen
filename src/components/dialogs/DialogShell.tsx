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
import { joinClassNames } from '../../lib/class-names'

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
  backdropTone?: DialogBackdropTone
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

export type DialogBackdropTone = 'scrim' | 'palette'

type DialogWidthMode = 'fit' | 'fixed'
type DialogHeightMode = 'content' | 'fixed'
type DialogPaddingMode = 'padded' | 'flush'

const WIDTH_CLASSES: Record<DialogWidthMode, string> = {
  fit: 'w-fit',
  fixed: '',
}

const HEIGHT_CLASSES: Record<DialogHeightMode, string> = {
  content: '',
  fixed: 'flex flex-col overflow-hidden',
}

const PADDING_CLASSES: Record<DialogPaddingMode, string> = {
  padded: 'p-6',
  flush: 'p-0',
}

const BACKDROP_TONE_CLASSES: Record<DialogBackdropTone, string> = {
  scrim: 'bg-light-smoke dark:bg-dark-smoke',
  palette: 'bg-smoke-palette',
}

const VIEWPORT_WIDTH_CAP = '90vw'

function widthModeOf(sizing: DialogSizing): DialogWidthMode {
  if (sizing.panelWidth) return 'fixed'
  if (sizing.fillMaxWidth) return 'fixed'
  return 'fit'
}

function heightModeOf(sizing: DialogSizing): DialogHeightMode {
  if (sizing.panelHeight) return 'fixed'
  return 'content'
}

interface PanelLayout {
  padding: DialogPaddingMode
  height: DialogHeightMode
}

function panelLayoutOf(sizing: DialogSizing): PanelLayout {
  return { padding: paddingModeOf(sizing), height: heightModeOf(sizing) }
}

function paddingModeOf(sizing: DialogSizing): DialogPaddingMode {
  if (sizing.panelPadding) return 'padded'
  return 'flush'
}

function dialogWidthStyle(sizing: DialogSizing): CSSProperties {
  if (sizing.panelWidth) return { width: sizing.panelWidth, maxWidth: sizing.panelWidth }
  const widthCap = `min(${sizing.maxWidth}px, ${VIEWPORT_WIDTH_CAP})`
  if (sizing.fillMaxWidth) return { width: widthCap, maxWidth: widthCap }
  return { maxWidth: widthCap }
}

function dialogHeightStyle(sizing: DialogSizing): CSSProperties {
  if (!sizing.panelHeight) return {}
  return { height: sizing.panelHeight, maxHeight: sizing.panelHeight }
}

function resolveDialogStyle(sizing: DialogSizing): CSSProperties {
  return { ...dialogWidthStyle(sizing), ...dialogHeightStyle(sizing) }
}

function resolvePanelClassName(sizing: DialogSizing, panelClassName: string | undefined): string {
  return joinClassNames([
    'min-w-dialog-min rounded-overlay border border-light-stroke-flyout bg-light-surface-container-high shadow-light-dialog dark:border-dark-stroke-flyout dark:bg-dark-surface-container-high dark:shadow-dark-dialog',
    WIDTH_CLASSES[widthModeOf(sizing)],
    HEIGHT_CLASSES[heightModeOf(sizing)],
    PADDING_CLASSES[paddingModeOf(sizing)],
    panelClassName,
  ])
}

function panelTestIdFor(testId: string | undefined): string | undefined {
  if (testId === undefined) return undefined
  return `${testId}-panel`
}

interface DialogPanelProps {
  layout: PanelLayout
  formProps: DialogShellProps['formProps']
  className: string
  style: CSSProperties
  testId: string | undefined
  panelRef: RefObject<HTMLDivElement | null>
  setFormRef: (node: HTMLFormElement | null) => void
  children: React.ReactNode
}

function DialogPanel({
  layout,
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
        data-padding={layout.padding}
        data-height={layout.height}
        data-testid={testId}
      >
        {children}
      </form>
    )
  }
  return (
    <div
      className={className}
      ref={panelRef}
      style={style}
      data-padding={layout.padding}
      data-height={layout.height}
      data-testid={testId}
    >
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

interface DialogPanelRefInputs {
  isFocusTrapActive: boolean
  initialFocusRef: RefObject<HTMLElement | null> | undefined
}

function useDialogPanelRef({ isFocusTrapActive, initialFocusRef }: DialogPanelRefInputs) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, isFocusTrapActive, initialFocusRef)
  const setFormRef = useCallback((node: HTMLFormElement | null) => {
    dialogRef.current = node as HTMLDivElement | null
  }, [])
  return { dialogRef: dialogRef, setFormRef: setFormRef }
}

function closeOnBackdropClick(event: React.MouseEvent, dismiss: Omit<DismissInputs, 'isOpen'>) {
  if (dismiss.nonDismissible) return
  if (event.target === event.currentTarget) {
    dismiss.onClose()
  }
}

interface DialogBackdropProps {
  tone: DialogBackdropTone
  testId: string | undefined
  ariaLabel: string | undefined
  dismiss: Omit<DismissInputs, 'isOpen'>
  children: React.ReactNode
}

function DialogBackdrop({ tone, testId, ariaLabel, dismiss, children }: DialogBackdropProps) {
  return (
    <div
      className={joinClassNames([
        'fixed inset-0 z-1000 flex items-center justify-center',
        BACKDROP_TONE_CLASSES[tone],
      ])}
      data-tone={tone}
      data-testid={testId}
      onClick={(event) => closeOnBackdropClick(event, dismiss)}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  )
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
  backdropTone = 'scrim',
  initialFocusRef,
  formProps,
  children,
}: DialogShellProps) {
  const { dialogRef, setFormRef } = useDialogPanelRef({
    isFocusTrapActive: isOpen && !disableFocusManagement,
    initialFocusRef: initialFocusRef,
  })

  useEscapeToClose({ isOpen: isOpen, nonDismissible: nonDismissible, onClose: onClose })

  if (!isOpen) return null

  const sizing: DialogSizing = {
    maxWidth: maxWidth,
    panelWidth: panelWidth,
    panelHeight: panelHeight,
    fillMaxWidth: fillMaxWidth,
    panelPadding: panelPadding,
  }

  return createPortal(
    <DialogBackdrop
      tone={backdropTone}
      testId={testId}
      ariaLabel={ariaLabel}
      dismiss={{ nonDismissible: nonDismissible, onClose: onClose }}
    >
      <DialogPanel
        layout={panelLayoutOf(sizing)}
        formProps={formProps}
        className={resolvePanelClassName(sizing, panelClassName)}
        style={resolveDialogStyle(sizing)}
        testId={panelTestIdFor(testId)}
        panelRef={dialogRef}
        setFormRef={setFormRef}
      >
        {children}
      </DialogPanel>
    </DialogBackdrop>,
    portalRoot ?? document.body
  )
}
