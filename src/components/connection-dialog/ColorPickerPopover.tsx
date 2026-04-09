import { useState, useRef } from 'react'
import { HexColorPicker } from 'react-colorful'
import { TextInput } from '../common/TextInput'
import { useDismissOnOutsideClick } from './useDismissOnOutsideClick'
import styles from './ColorPickerPopover.module.css'

interface ColorPickerPopoverProps {
  color: string | null
  onChange: (color: string | null) => void
}

export function ColorPickerPopover({ color, onChange }: ColorPickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [hexInput, setHexInput] = useState(color ?? '')
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useDismissOnOutsideClick(wrapperRef, isOpen, () => setIsOpen(false))

  const handleToggleOpen = () => {
    if (isOpen) {
      setIsOpen(false)
    } else {
      setHexInput(color ?? '')
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
        onClick={handleToggleOpen}
        aria-label="Choose color"
      />
      {isOpen && (
        <div className={styles.popover} data-testid="color-picker-popover">
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
        </div>
      )}
    </div>
  )
}
