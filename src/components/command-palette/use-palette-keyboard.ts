import { useCallback, type KeyboardEvent } from 'react'
import type { PaletteSearchResult } from '../../lib/command-palette-search'
import { PALETTE_KEYS } from './palette-keys'
import type { SlashOption } from './slash-options'
import type { PaletteInput } from './use-palette-input'

export function clampedSlashIndex(activeIndex: number, optionCount: number): number {
  return optionCount === 0 ? 0 : Math.min(activeIndex, optionCount - 1)
}

function isCaretAtInputStart(input: HTMLInputElement | null): boolean {
  return input?.selectionStart === 0 && input.selectionEnd === 0
}

type PaletteKeyHandler = (event: KeyboardEvent<HTMLInputElement>) => void

export interface PaletteKeyboardOptions {
  paletteInput: PaletteInput
  slashOptions: SlashOption[]
  visibleResultCount: number
  activeResult: PaletteSearchResult | null
  onSelect: (result: PaletteSearchResult) => Promise<void>
  onClose: () => void
}

function usePaletteNavigationKeys(options: PaletteKeyboardOptions) {
  const { paletteInput, slashOptions, visibleResultCount, onClose } = options
  const { isSlashDropdownOpen, pills, handlePillRemove, setIsSlashDropdownOpen, setActiveIndex } =
    paletteInput

  const closeFromKeyboard = useCallback<PaletteKeyHandler>(
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (isSlashDropdownOpen) {
        setIsSlashDropdownOpen(false)
        return
      }
      if (pills.length > 0) {
        handlePillRemove(pills[pills.length - 1])
        return
      }
      onClose()
    },
    [handlePillRemove, isSlashDropdownOpen, onClose, pills, setIsSlashDropdownOpen]
  )

  const moveActiveIndexDown = useCallback<PaletteKeyHandler>(
    (event) => {
      event.preventDefault()
      const optionCount = isSlashDropdownOpen ? slashOptions.length : visibleResultCount
      if (optionCount === 0) return
      setActiveIndex((current) => Math.min(current + 1, optionCount - 1))
    },
    [isSlashDropdownOpen, setActiveIndex, slashOptions.length, visibleResultCount]
  )

  const moveActiveIndexUp = useCallback<PaletteKeyHandler>(
    (event) => {
      event.preventDefault()
      const canMove = isSlashDropdownOpen || visibleResultCount > 0
      if (!canMove) return
      setActiveIndex((current) => Math.max(current - 1, 0))
    },
    [isSlashDropdownOpen, setActiveIndex, visibleResultCount]
  )

  return { closeFromKeyboard, moveActiveIndexDown, moveActiveIndexUp }
}

function usePaletteActionKeys(options: PaletteKeyboardOptions) {
  const { paletteInput, slashOptions, activeResult, onSelect } = options
  const { isSlashDropdownOpen, activeIndex, pills, query, inputRef } = paletteInput
  const { handleSlashSelect, handlePillRemove, scopeToTableColumns } = paletteInput

  const openFromKeyboard = useCallback<PaletteKeyHandler>(
    (event) => {
      if (isSlashDropdownOpen) {
        event.preventDefault()
        const selectedOption = slashOptions[clampedSlashIndex(activeIndex, slashOptions.length)]
        if (selectedOption) {
          handleSlashSelect(selectedOption.pill)
        }
        return
      }
      if (!activeResult) return
      event.preventDefault()
      void onSelect(activeResult)
    },
    [activeIndex, activeResult, onSelect, handleSlashSelect, isSlashDropdownOpen, slashOptions]
  )

  const showColumnsFromKeyboard = useCallback<PaletteKeyHandler>(
    (event) => {
      if (isSlashDropdownOpen) return
      if (activeResult?.objectType !== 'table') return
      event.preventDefault()
      scopeToTableColumns(activeResult)
    },
    [activeResult, isSlashDropdownOpen, scopeToTableColumns]
  )

  const removeLastPillFromKeyboard = useCallback<PaletteKeyHandler>(
    (event) => {
      const canRemovePill =
        query.length === 0 && isCaretAtInputStart(inputRef.current) && pills.length > 0
      if (!canRemovePill) return
      event.preventDefault()
      handlePillRemove(pills[pills.length - 1])
    },
    [handlePillRemove, inputRef, pills, query.length]
  )

  return { openFromKeyboard, showColumnsFromKeyboard, removeLastPillFromKeyboard }
}

export function usePaletteKeyboard(options: PaletteKeyboardOptions): PaletteKeyHandler {
  const { closeFromKeyboard, moveActiveIndexDown, moveActiveIndexUp } =
    usePaletteNavigationKeys(options)
  const { openFromKeyboard, showColumnsFromKeyboard, removeLastPillFromKeyboard } =
    usePaletteActionKeys(options)

  return useCallback<PaletteKeyHandler>(
    (event) => {
      const keyHandlers: Record<string, PaletteKeyHandler> = {
        [PALETTE_KEYS.close.key]: closeFromKeyboard,
        [PALETTE_KEYS.down.key]: moveActiveIndexDown,
        [PALETTE_KEYS.up.key]: moveActiveIndexUp,
        [PALETTE_KEYS.open.key]: openFromKeyboard,
        [PALETTE_KEYS.columns.key]: showColumnsFromKeyboard,
        Backspace: removeLastPillFromKeyboard,
      }
      keyHandlers[event.key]?.(event)
    },
    [
      closeFromKeyboard,
      moveActiveIndexDown,
      moveActiveIndexUp,
      openFromKeyboard,
      removeLastPillFromKeyboard,
      showColumnsFromKeyboard,
    ]
  )
}
