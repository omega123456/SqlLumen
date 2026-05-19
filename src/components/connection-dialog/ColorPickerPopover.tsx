import { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { HexColorPicker } from 'react-colorful'
import { TextInput } from '../common/TextInput'
import styles from './ColorPickerPopover.module.css'

interface ColorPickerPopoverProps {
  color: string | null
  onChange: (color: string | null) => void
}

const POPOVER_HEIGHT = 220
const POPOVER_GAP = 4

export function ColorPickerPopover({ color, onChange }: ColorPickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [hexInput, setHexInput] = useState(color ?? '')
  const portalRef = useRef<HTMLDivElement>(null)
  const swatchRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})
  const [portalContainer, setPortalContainer] = useState<Element>(() => document.body)

  // Close popover on outside click — check both wrapper and portal
  useEffect(() => {
    if (!isOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        portalRef.current &&
        !portalRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen])

  const handleToggleOpen = () => {
    if (isOpen) {
      setIsOpen(false)
    } else {
      setHexInput(color ?? '')
      if (swatchRef.current) {
        setPortalContainer(swatchRef.current.closest('dialog') ?? document.body)
        const rect = swatchRef.current.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        const flipUp = spaceBelow < POPOVER_HEIGHT

        if (flipUp) {
          setPopoverStyle({
            position: 'fixed',
            bottom: window.innerHeight - rect.top + POPOVER_GAP,
            left: rect.left,
          })
        } else {
          setPopoverStyle({
            position: 'fixed',
            top: rect.bottom + POPOVER_GAP,
            left: rect.left,
          })
        }
      }
      setIsOpen(true)
    }
  }

  const handlePickerColorChange = (next: string) => {
    onChange(next)
    setHexInput(next)
  }

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setHexInput(value)
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      onChange(value)
    }
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.swatch}
        style={{ backgroundColor: color ?? 'var(--surface-container-high)' }}
        ref={swatchRef}
        onClick={handleToggleOpen}
        aria-label="Choose color"
      />
      {isOpen &&
        ReactDOM.createPortal(
          <div
            ref={portalRef}
            className={styles.popover}
            style={popoverStyle}
            data-testid="color-picker-popover"
          >
            <HexColorPicker color={color ?? '#3b82f6'} onChange={handlePickerColorChange} />
            <TextInput
              variant="bare"
              type="text"
              className={`ui-field-chrome ${styles.hexInput}`}
              value={hexInput}
              onChange={handleHexInputChange}
              placeholder="#000000"
              aria-label="Hex color value"
            />
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => {
                onChange(null)
                setIsOpen(false)
              }}
            >
              Clear Color
            </button>
          </div>,
          portalContainer
        )}
    </div>
  )
}
