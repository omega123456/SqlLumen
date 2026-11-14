import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Textarea } from '../common/Textarea'
import { Button } from '../common/Button'
import { parsePastedBytes } from '../../lib/blob-utils'
import styles from './BlobPastePopover.module.css'
import { isTargetInside } from '../../lib/input-events'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface BlobPastePopoverProps {
  isOpen: boolean
  onClose: () => void
  onApply: (bytes: Uint8Array) => void
  onError: (message: string) => void
  anchorRef: React.RefObject<HTMLElement | null>
}

function isFocusableElement(element: HTMLElement): boolean {
  if (element.hasAttribute('disabled')) return false
  return element.tabIndex >= 0
}

type PopoverPlacement = 'below' | 'above'

const PASTE_INPUT_ROWS = 4

interface PopoverElements {
  anchorRef: React.RefObject<HTMLElement | null>
  popoverRef: React.RefObject<HTMLDivElement | null>
}

function placementFor(anchor: HTMLElement, popover: HTMLElement): PopoverPlacement {
  const anchorRect = anchor.getBoundingClientRect()
  const popoverRect = popover.getBoundingClientRect()
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const shouldFlipAbove = spaceBelow < popoverRect.height && anchorRect.top >= popoverRect.height
  return shouldFlipAbove ? 'above' : 'below'
}

function usePopoverPlacement(isOpen: boolean, elements: PopoverElements): PopoverPlacement {
  const { anchorRef, popoverRef } = elements
  const [placement, setPlacement] = useState<PopoverPlacement>('below')

  useLayoutEffect(() => {
    if (!isOpen) return

    const updatePlacement = () => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor) return
      if (!popover) return
      setPlacement(placementFor(anchor, popover))
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [isOpen, anchorRef, popoverRef])

  return placement
}

function useCloseOnOutsidePointerDown(
  isOpen: boolean,
  elements: PopoverElements,
  close: () => void
) {
  const { anchorRef, popoverRef } = elements
  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (isTargetInside(popoverRef.current, event.target)) return
      if (isTargetInside(anchorRef.current, event.target)) return
      close()
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen, close, anchorRef, popoverRef])
}

function focusableElementsIn(popover: HTMLElement | null): HTMLElement[] {
  if (!popover) return []
  return Array.from(popover.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isFocusableElement
  )
}

function wrapTabFocus(event: KeyboardEvent<HTMLDivElement>, focusable: HTMLElement[]) {
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }

  const currentIndex = focusable.findIndex((element) => element === document.activeElement)

  if (event.shiftKey) {
    const isAtFirstOrUnfocused = currentIndex === 0 || currentIndex === -1
    if (isAtFirstOrUnfocused) {
      event.preventDefault()
      focusable[focusable.length - 1]?.focus()
    }
    return
  }

  if (currentIndex === focusable.length - 1) {
    event.preventDefault()
    focusable[0]?.focus()
  }
}

function useResetDraftOnOpen(
  isOpen: boolean,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  setText: (text: string) => void
) {
  useEffect(() => {
    if (!isOpen) return
    const id = requestAnimationFrame(() => {
      setText('')
      textareaRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isOpen, setText, textareaRef])
}

interface PasteFormProps {
  text: string
  onTextChange: (text: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onLoad: () => void
}

function PasteForm({ text, onTextChange, textareaRef, onLoad }: PasteFormProps) {
  return (
    <>
      <span className={styles.title}>Paste base64 or hex</span>
      <Textarea
        ref={textareaRef}
        variant="mono"
        rows={PASTE_INPUT_ROWS}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="Paste base64 or hex"
        aria-label="Paste base64 or hex"
        data-testid="blob-paste-input"
      />
      <div className={styles.footer}>
        <span className={styles.hint}>Accepts base64 or hex</span>
        <Button variant="accent" onClick={onLoad} data-testid="blob-paste-apply">
          Load
        </Button>
      </div>
    </>
  )
}

export function BlobPastePopover({
  isOpen,
  onClose,
  onApply,
  onError,
  anchorRef,
}: BlobPastePopoverProps) {
  const [text, setText] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const elements = { anchorRef: anchorRef, popoverRef: popoverRef }
  const placement = usePopoverPlacement(isOpen, elements)
  useResetDraftOnOpen(isOpen, textareaRef, setText)

  const close = useCallback(() => {
    onClose()
    anchorRef.current?.focus()
  }, [onClose, anchorRef])
  useCloseOnOutsidePointerDown(isOpen, elements, close)

  const handleLoad = () => {
    const result = parsePastedBytes(text)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onApply(result.bytes)
    close()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    wrapTabFocus(event, focusableElementsIn(popoverRef.current))
  }

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      className={
        placement === 'above' ? `${styles.popover} ${styles.popoverAbove}` : styles.popover
      }
      role="dialog"
      aria-label="Paste base64 or hex"
      onKeyDown={handleKeyDown}
      data-testid="blob-paste-popover"
      data-placement={placement}
    >
      <PasteForm text={text} onTextChange={setText} textareaRef={textareaRef} onLoad={handleLoad} />
    </div>
  )
}
