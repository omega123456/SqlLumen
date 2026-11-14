import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DatabaseIcon, FolderOpenIcon, GlobeIcon } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { MemoryScope } from '../../lib/ai-memory-commands'
import styles from './MemoryScopePicker.module.css'

export interface MemoryScopePickerProps {
  hasGroup: boolean
  defaultScope?: MemoryScope
  onSelect: (scope: MemoryScope) => void
  onCancel: () => void
}

interface ScopeOption {
  scope: MemoryScope
  label: string
  icon: Icon
}

function isEnabledOptionFor(
  option: ScopeOption & { disabled: boolean },
  scope: MemoryScope | undefined
): boolean {
  return option.scope === scope && !option.disabled
}

const BASE_OPTIONS: ScopeOption[] = [
  { scope: 'connection', label: 'Connection', icon: DatabaseIcon },
  { scope: 'group', label: 'Group', icon: FolderOpenIcon },
  { scope: 'global', label: 'Global', icon: GlobeIcon },
]

interface PickerKeyHandlers {
  moveHighlight: (delta: number) => void
  selectIndex: (index: number) => void
  highlightedIndex: number
  onCancel: () => void
}

const PICKER_KEY_ACTIONS: Record<string, (handlers: PickerKeyHandlers) => void> = {
  ArrowDown: (handlers) => handlers.moveHighlight(1),
  ArrowUp: (handlers) => handlers.moveHighlight(-1),
  Enter: (handlers) => handlers.selectIndex(handlers.highlightedIndex),
  Escape: (handlers) => handlers.onCancel(),
}

type PickerOption = (typeof BASE_OPTIONS)[number] & { disabled: boolean }

function usePickerOptions(hasGroup: boolean, defaultScope: MemoryScopePickerProps['defaultScope']) {
  const options = useMemo(
    () =>
      BASE_OPTIONS.map((option) => ({
        ...option,
        disabled: option.scope === 'group' && !hasGroup,
      })),
    [hasGroup]
  )

  const enabledIndices = useMemo(
    () =>
      options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0),
    [options]
  )

  const initialIndex = useMemo(() => {
    const fromDefault = options.findIndex((option) => isEnabledOptionFor(option, defaultScope))
    if (fromDefault >= 0) {
      return fromDefault
    }
    const connectionIndex = options.findIndex((option) => isEnabledOptionFor(option, 'connection'))
    if (connectionIndex >= 0) {
      return connectionIndex
    }
    return enabledIndices[0] ?? 0
  }, [options, defaultScope, enabledIndices])

  return { options, enabledIndices, initialIndex }
}

function usePickerKeyboard(handlers: PickerKeyHandlers): void {
  const { moveHighlight, selectIndex, highlightedIndex, onCancel } = handlers
  const handlersRef = useRef({ moveHighlight, selectIndex, highlightedIndex, onCancel })

  useEffect(() => {
    handlersRef.current = { moveHighlight, selectIndex, highlightedIndex, onCancel }
  }, [moveHighlight, selectIndex, highlightedIndex, onCancel])

  useEffect(() => {
    const attachedAt = performance.now()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.timeStamp <= attachedAt) {
        return
      }
      const keyAction = PICKER_KEY_ACTIONS[event.key]
      if (!keyAction) return
      event.preventDefault()
      keyAction(handlersRef.current)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])
}

interface MemoryScopeOptionProps {
  option: PickerOption
  isHighlighted: boolean
  onSelect: () => void
  onHighlight: () => void
}

function MemoryScopeOption({
  option,
  isHighlighted,
  onSelect,
  onHighlight,
}: MemoryScopeOptionProps) {
  const IconComponent = option.icon
  const isSelectableHighlight = isHighlighted && !option.disabled
  return (
    <div
      role="option"
      id={`memory-scope-${option.scope}`}
      aria-selected={isSelectableHighlight}
      aria-disabled={option.disabled || undefined}
      className={[
        styles.option,
        isSelectableHighlight ? styles.optionHighlighted : '',
        option.disabled ? styles.optionDisabled : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`memory-scope-option-${option.scope}`}
      onClick={onSelect}
      onMouseEnter={() => {
        if (!option.disabled) {
          onHighlight()
        }
      }}
    >
      <IconComponent size={16} className={styles.optionIcon} aria-hidden />
      <span className={styles.optionLabel}>{option.label}</span>
      {option.disabled && (
        <span className={styles.optionCaption} data-testid="memory-scope-no-group-caption">
          no group
        </span>
      )}
    </div>
  )
}

function useHighlightedIndex(enabledIndices: number[], initialIndex: number) {
  const [highlightedIndex, setHighlightedIndex] = useState(initialIndex)

  useEffect(() => {
    setHighlightedIndex(initialIndex)
  }, [initialIndex])

  const moveHighlight = useCallback(
    (delta: number) => {
      if (enabledIndices.length === 0) {
        return
      }
      const currentPosition = enabledIndices.indexOf(highlightedIndex)
      const start = currentPosition === -1 ? 0 : currentPosition
      const nextPosition = (start + delta + enabledIndices.length) % enabledIndices.length
      setHighlightedIndex(enabledIndices[nextPosition])
    },
    [enabledIndices, highlightedIndex]
  )

  return { highlightedIndex, setHighlightedIndex, moveHighlight }
}

export function MemoryScopePicker({
  hasGroup,
  defaultScope,
  onSelect,
  onCancel,
}: MemoryScopePickerProps) {
  const { options, enabledIndices, initialIndex } = usePickerOptions(hasGroup, defaultScope)
  const { highlightedIndex, setHighlightedIndex, moveHighlight } = useHighlightedIndex(
    enabledIndices,
    initialIndex
  )

  const selectIndex = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option) return
      if (option.disabled) return
      onSelect(option.scope)
    },
    [options, onSelect]
  )

  usePickerKeyboard({
    moveHighlight: moveHighlight,
    selectIndex: selectIndex,
    highlightedIndex: highlightedIndex,
    onCancel: onCancel,
  })

  return (
    <div
      role="listbox"
      id="memory-scope-listbox"
      aria-label="Save memory to"
      className={styles.picker}
      data-testid="memory-scope-picker"
    >
      <div className={styles.header} aria-hidden>
        Save memory to:
      </div>
      {options.map((option, index) => (
        <MemoryScopeOption
          key={option.scope}
          option={option}
          isHighlighted={index === highlightedIndex}
          onSelect={() => selectIndex(index)}
          onHighlight={() => setHighlightedIndex(index)}
        />
      ))}
    </div>
  )
}
