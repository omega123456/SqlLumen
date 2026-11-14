import {
  useCallback,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import { filterCommands, type SlashCommand } from '../../../lib/slash-commands'
import { isPlainEnterKey } from '../../../lib/input-events'

const NO_HIGHLIGHT = -1

type DropdownKeyAction = 'next' | 'previous' | 'select' | 'close'

function resolveDropdownKeyAction(
  event: KeyboardEvent<HTMLTextAreaElement>,
  highlightedIndex: number
): DropdownKeyAction | null {
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowUp') return 'previous'
  if (event.key === 'Escape') return 'close'
  if (highlightedIndex < 0) return null
  if (event.key === 'Tab') return 'select'
  if (isPlainEnterKey(event)) return 'select'
  return null
}

function nextHighlightIndex(previous: number, commandCount: number): number {
  return previous < commandCount - 1 ? previous + 1 : 0
}

function previousHighlightIndex(previous: number, commandCount: number): number {
  return previous > 0 ? previous - 1 : commandCount - 1
}

export interface SlashCommandDropdownOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  setValue: Dispatch<SetStateAction<string>>
}

function useSlashCommandDropdownState() {
  const [showDropdown, setShowDropdown] = useState(false)
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(NO_HIGHLIGHT)

  const updateDropdown = useCallback((text: string) => {
    const isSlashCommandPrefix = text.startsWith('/') && !text.includes(' ')
    const commands = isSlashCommandPrefix ? filterCommands(text.slice(1)) : []
    setFilteredCommands(commands)
    setShowDropdown(commands.length > 0)
    setHighlightedIndex(NO_HIGHLIGHT)
  }, [])

  const resetDropdown = useCallback(() => {
    setShowDropdown(false)
    setFilteredCommands([])
    setHighlightedIndex(NO_HIGHLIGHT)
  }, [])

  return {
    showDropdown,
    filteredCommands,
    highlightedIndex,
    setShowDropdown,
    setHighlightedIndex,
    updateDropdown,
    resetDropdown,
  }
}

export function useSlashCommandDropdown({ textareaRef, setValue }: SlashCommandDropdownOptions) {
  const dropdownState = useSlashCommandDropdownState()
  const { showDropdown, filteredCommands, highlightedIndex } = dropdownState
  const { setShowDropdown, setHighlightedIndex, resetDropdown } = dropdownState

  const selectCommand = useCallback(
    (command: SlashCommand) => {
      const newValue = `/${command.name} `
      setValue(newValue)
      resetDropdown()
      requestAnimationFrame(() => {
        const element = textareaRef.current
        if (element) {
          element.focus()
          element.setSelectionRange(newValue.length, newValue.length)
        }
      })
    },
    [resetDropdown, setValue, textareaRef]
  )

  const runDropdownKeyAction = useCallback(
    (action: DropdownKeyAction) => {
      const commandCount = filteredCommands.length
      const dropdownKeyActions: Record<DropdownKeyAction, () => void> = {
        next: () => setHighlightedIndex((previous) => nextHighlightIndex(previous, commandCount)),
        previous: () =>
          setHighlightedIndex((previous) => previousHighlightIndex(previous, commandCount)),
        select: () => selectCommand(filteredCommands[highlightedIndex]),
        close: () => setShowDropdown(false),
      }
      dropdownKeyActions[action]()
    },
    [filteredCommands, highlightedIndex, selectCommand, setHighlightedIndex, setShowDropdown]
  )

  const handleDropdownKey = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const dropdownAction = showDropdown ? resolveDropdownKeyAction(event, highlightedIndex) : null
      if (!dropdownAction) return false
      event.preventDefault()
      runDropdownKeyAction(dropdownAction)
      return true
    },
    [highlightedIndex, runDropdownKeyAction, showDropdown]
  )

  return { ...dropdownState, selectCommand, handleDropdownKey }
}
