import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import ReactDOM from 'react-dom'
import { HexColorPicker } from 'react-colorful'
import { TextInput } from '../common/TextInput'
import { Button } from '../common/Button'
import { joinClassNames } from '../../lib/class-names'
import { isTargetOutside } from '../../lib/input-events'
import { FOCUS_RING } from '../../lib/focus-ring'
import { FIELD_CHROME } from '../../lib/class-names-field'
import '../../styles/vendor/react-colorful.css'

interface ColorPickerPopoverProps {
  color: string | null
  onChange: (color: string | null) => void
}

const POPOVER_HEIGHT = 220
const POPOVER_GAP = 4

function popoverPositionFor(swatchRect: DOMRect): React.CSSProperties {
  const spaceBelow = window.innerHeight - swatchRect.bottom
  if (spaceBelow < POPOVER_HEIGHT) {
    return {
      position: 'fixed',
      bottom: window.innerHeight - swatchRect.top + POPOVER_GAP,
      left: swatchRect.left,
    }
  }
  return { position: 'fixed', top: swatchRect.bottom + POPOVER_GAP, left: swatchRect.left }
}

type SwatchFill = 'chosen' | 'unset'

const SWATCH_FILL_CLASSES: Record<SwatchFill, string> = {
  chosen: '',
  unset: 'bg-light-surface-container-high dark:bg-dark-surface-container-high',
}

function swatchClassName(color: string | null): string {
  const fill: SwatchFill = color === null ? 'unset' : 'chosen'
  return joinClassNames([
    'size-4 shrink-0 cursor-pointer rounded-round border border-light-stroke-control p-0 transition-border-color hover:border-light-stroke-card dark:border-dark-stroke-control dark:hover:border-dark-stroke-card',
    SWATCH_FILL_CLASSES[fill],
    FOCUS_RING,
  ])
}

function swatchStyle(color: string | null): React.CSSProperties | undefined {
  if (color === null) return undefined
  return { backgroundColor: color }
}

const DEFAULT_PICKER_COLOR = '#3b82f6'
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

interface OpenPopover {
  style: React.CSSProperties
  container: Element
}

function openPopoverFor(swatch: HTMLButtonElement | null): OpenPopover {
  if (!swatch) return { style: {}, container: document.body }
  return {
    style: popoverPositionFor(swatch.getBoundingClientRect()),
    container: swatch.closest('dialog') ?? document.body,
  }
}

interface OutsideClickTargets {
  wrapperRef: RefObject<HTMLDivElement | null>
  portalRef: RefObject<HTMLDivElement | null>
}

function useCloseOnOutsideMouseDown(
  isOpen: boolean,
  targets: OutsideClickTargets,
  close: () => void
) {
  const { wrapperRef, portalRef } = targets
  useEffect(() => {
    if (!isOpen) return
    const handleMouseDown = (event: MouseEvent) => {
      const isOutsidePicker =
        isTargetOutside(wrapperRef.current, event.target) &&
        isTargetOutside(portalRef.current, event.target)
      if (isOutsidePicker) {
        close()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [close, isOpen, portalRef, wrapperRef])
}

interface ColorPickerPanelProps extends ColorPickerPopoverProps {
  panelRef: RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  onClose: () => void
}

function ColorPickerPanel({ color, onChange, panelRef, style, onClose }: ColorPickerPanelProps) {
  const [hexInput, setHexInput] = useState(color ?? '')

  const handlePickerColorChange = (next: string) => {
    onChange(next)
    setHexInput(next)
  }

  const handleHexInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setHexInput(value)
    if (HEX_COLOR_PATTERN.test(value)) {
      onChange(value)
    }
  }

  return (
    <div
      ref={panelRef}
      className="z-10000 flex flex-col gap-2 rounded-overlay border border-light-stroke-flyout bg-light-surface-container-high p-2 shadow-light-flyout dark:border-dark-stroke-flyout dark:bg-dark-surface-container-high dark:shadow-dark-flyout"
      style={style}
      data-color-picker-panel
      data-testid="color-picker-popover"
    >
      <HexColorPicker color={color ?? DEFAULT_PICKER_COLOR} onChange={handlePickerColorChange} />
      <TextInput
        variant="bare"
        type="text"
        className={joinClassNames([FIELD_CHROME, 'w-full px-2 py-1 font-mono text-size-body'])}
        value={hexInput}
        onChange={handleHexInputChange}
        placeholder="#000000"
        aria-label="Hex color value"
      />
      <Button
        variant="bare"
        className={joinClassNames([
          'cursor-pointer rounded-control bg-transparent p-1 text-center font-body text-size-caption text-light-on-surface-variant hover:bg-light-surface-container-high hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:bg-dark-surface-container-high dark:hover:text-dark-on-surface',
          FOCUS_RING,
        ])}
        onClick={() => {
          onChange(null)
          onClose()
        }}
      >
        Clear color
      </Button>
    </div>
  )
}

export function ColorPickerPopover({ color, onChange }: ColorPickerPopoverProps) {
  const [openPopover, setOpenPopover] = useState<OpenPopover | null>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const swatchRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpenPopover(null), [])
  useCloseOnOutsideMouseDown(
    openPopover !== null,
    { wrapperRef: wrapperRef, portalRef: portalRef },
    close
  )

  const handleToggleOpen = () => {
    if (openPopover) {
      close()
      return
    }
    setOpenPopover(openPopoverFor(swatchRef.current))
  }

  return (
    <div className="relative inline-flex items-center" ref={wrapperRef}>
      <Button
        variant="bare"
        className={swatchClassName(color)}
        style={swatchStyle(color)}
        ref={swatchRef}
        onClick={handleToggleOpen}
        aria-label="Choose color"
      />
      {openPopover &&
        ReactDOM.createPortal(
          <ColorPickerPanel
            color={color}
            onChange={onChange}
            panelRef={portalRef}
            style={openPopover.style}
            onClose={close}
          />,
          openPopover.container
        )}
    </div>
  )
}
