/**
 * BlobPastePopover — a compact popover anchored to the BLOB viewer's Paste
 * button. It hosts a mono textarea + a short hint + a primary Load action on a
 * `--ui-popover-*` surface positioned beneath the anchor button.
 *
 * The popover overlays the dialog rather than pushing its layout down. It owns
 * its open/close lifecycle (open from the Paste button via `isOpen`), focuses
 * the textarea on open, dismisses on Escape, on outside-click, and after a
 * successful Load, and returns focus to the anchor button on close. Pasted text
 * is parsed via the shared `parsePastedBytes`; success is reported through
 * `onApply`, parse failures through `onError` (the parent routes them to a
 * toast).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Textarea } from '../common/Textarea'
import { Button } from '../common/Button'
import { parsePastedBytes } from '../../lib/blob-utils'
import styles from './BlobPastePopover.module.css'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface BlobPastePopoverProps {
  /** Whether the popover is open. */
  isOpen: boolean
  /** Close the popover (Escape, outside-click, or after a successful Load). */
  onClose: () => void
  /** Successful parse: hand the decoded bytes back to the dialog. */
  onApply: (bytes: Uint8Array) => void
  /** Parse failure: surface a human-readable message (parent toasts it). */
  onError: (msg: string) => void
  /** The Paste button the popover anchors to; focus returns here on close. */
  anchorRef: React.RefObject<HTMLElement | null>
}

export function BlobPastePopover({
  isOpen,
  onClose,
  onApply,
  onError,
  anchorRef,
}: BlobPastePopoverProps) {
  const [text, setText] = useState('')
  const [placement, setPlacement] = useState<'below' | 'above'>('below')
  const popoverRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset the draft + focus the textarea whenever the popover opens.
  useEffect(() => {
    if (!isOpen) return
    const id = requestAnimationFrame(() => {
      setText('')
      textareaRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) return

    const updatePlacement = () => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor || !popover) return

      const anchorRect = anchor.getBoundingClientRect()
      const popoverRect = popover.getBoundingClientRect()
      const spaceBelow = window.innerHeight - anchorRect.bottom
      const shouldFlipAbove =
        spaceBelow < popoverRect.height && anchorRect.top >= popoverRect.height

      setPlacement(shouldFlipAbove ? 'above' : 'below')
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [isOpen, anchorRef])

  // Close on Escape; restore focus to the anchor on close.
  const close = useCallback(() => {
    onClose()
    anchorRef.current?.focus()
  }, [onClose, anchorRef])

  const focusableElements = useCallback((): HTMLElement[] => {
    const popover = popoverRef.current
    if (!popover) return []

    return Array.from(popover.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.hasAttribute('disabled') && element.tabIndex >= 0
    )
  }, [])

  // Outside-click dismissal: close when a pointerdown lands outside both the
  // popover surface and its anchor button.
  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen, close, anchorRef])

  const handleLoad = useCallback(() => {
    const result = parsePastedBytes(text)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onApply(result.bytes)
    close()
  }, [text, onApply, onError, close])

  // Keep Escape from bubbling to the dialog's own Escape handler so it closes
  // only the popover while the popover is open.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        close()
        return
      }

      if (e.key !== 'Tab') return

      const focusable = focusableElements()
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const activeElement = document.activeElement
      const currentIndex = focusable.findIndex((element) => element === activeElement)

      if (e.shiftKey) {
        if (currentIndex === 0 || currentIndex === -1) {
          e.preventDefault()
          focusable[focusable.length - 1]?.focus()
        }
        return
      }

      if (currentIndex === focusable.length - 1) {
        e.preventDefault()
        focusable[0]?.focus()
      }
    },
    [close, focusableElements]
  )

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      className={placement === 'above' ? `${styles.popover} ${styles.popoverAbove}` : styles.popover}
      role="dialog"
      aria-label="Paste base64 or hex"
      onKeyDown={handleKeyDown}
      data-testid="blob-paste-popover"
      data-placement={placement}
    >
      <span className={styles.title}>Paste base64 or hex</span>
      <Textarea
        ref={textareaRef}
        variant="mono"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste base64 or hex"
        aria-label="Paste base64 or hex"
        data-testid="blob-paste-input"
      />
      <div className={styles.footer}>
        <span className={styles.hint}>Accepts base64 or hex</span>
        <Button onClick={handleLoad} data-testid="blob-paste-apply">
          Load
        </Button>
      </div>
    </div>
  )
}
