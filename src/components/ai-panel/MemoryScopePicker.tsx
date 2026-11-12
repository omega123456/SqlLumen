import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DatabaseIcon, FolderOpenIcon, GlobeIcon } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { MemoryScope } from '../../lib/ai-memory-commands'
import styles from './MemoryScopePicker.module.css'

export interface MemoryScopePickerProps {
  /**
   * Whether the active connection belongs to a group. When false the Group
   * option is disabled (aria-disabled), visibly greyed, and skipped during
   * keyboard navigation.
   */
  hasGroup: boolean
  /**
   * The saved default scope. Used only to seed the initial highlight. When it
   * is not a concrete level (e.g. `'ask'`) the highlight falls back to
   * Connection. A disabled level (Group without a group) never seeds the
   * highlight.
   */
  defaultScope?: MemoryScope
  /** Emitted when the user picks an (enabled) scope. */
  onSelect: (scope: MemoryScope) => void
  /** Emitted when the picker is cancelled (Escape). */
  onCancel: () => void
}

interface ScopeOption {
  scope: MemoryScope
  label: string
  icon: Icon
}

const BASE_OPTIONS: ScopeOption[] = [
  { scope: 'connection', label: 'Connection', icon: DatabaseIcon },
  { scope: 'group', label: 'Group', icon: FolderOpenIcon },
  { scope: 'global', label: 'Global', icon: GlobeIcon },
]

/**
 * Inline "Always ask" level chooser shown above the chat input when a
 * `/remember` save needs a scope. Mirrors the `SlashCommandDropdown` listbox
 * look + keyboard model; the Group option is visible but unselectable and
 * skipped in arrow-key navigation when the active connection has no group.
 */
export function MemoryScopePicker({
  hasGroup,
  defaultScope,
  onSelect,
  onCancel,
}: MemoryScopePickerProps) {
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
    const fromDefault = options.findIndex(
      (option) => option.scope === defaultScope && !option.disabled
    )
    if (fromDefault >= 0) {
      return fromDefault
    }
    const connectionIndex = options.findIndex(
      (option) => option.scope === 'connection' && !option.disabled
    )
    if (connectionIndex >= 0) {
      return connectionIndex
    }
    return enabledIndices[0] ?? 0
  }, [options, defaultScope, enabledIndices])

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
      setHighlightedIndex(enabledIndices[nextPosition]!)
    },
    [enabledIndices, highlightedIndex]
  )

  const selectIndex = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option || option.disabled) {
        return
      }
      onSelect(option.scope)
    },
    [options, onSelect]
  )

  // Keep the latest key handlers in a ref so the document listener can be
  // attached exactly once (stable across highlight changes) yet always call
  // the current closures.
  const handlersRef = useRef({ moveHighlight, selectIndex, highlightedIndex, onCancel })

  useEffect(() => {
    handlersRef.current = { moveHighlight, selectIndex, highlightedIndex, onCancel }
  }, [moveHighlight, selectIndex, highlightedIndex, onCancel])

  useEffect(() => {
    // Timestamp at which this listener becomes active. The keydown that opened
    // the picker (e.g. the Enter that sent `/remember`) is dispatched *before*
    // this effect runs, so it carries an earlier `timeStamp` and is ignored —
    // preventing it from immediately bubbling to `document` and auto-selecting
    // the highlighted option.
    const attachedAt = performance.now()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.timeStamp <= attachedAt) {
        return
      }
      const handlers = handlersRef.current
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        handlers.moveHighlight(1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        handlers.moveHighlight(-1)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        handlers.selectIndex(handlers.highlightedIndex)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        handlers.onCancel()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

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
      {options.map((option, index) => {
        const IconComponent = option.icon
        const isHighlighted = index === highlightedIndex
        return (
          <div
            key={option.scope}
            role="option"
            id={`memory-scope-${option.scope}`}
            aria-selected={isHighlighted && !option.disabled}
            aria-disabled={option.disabled || undefined}
            className={[
              styles.option,
              isHighlighted && !option.disabled ? styles.optionHighlighted : '',
              option.disabled ? styles.optionDisabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-testid={`memory-scope-option-${option.scope}`}
            onClick={() => selectIndex(index)}
            onMouseEnter={() => {
              if (!option.disabled) {
                setHighlightedIndex(index)
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
      })}
    </div>
  )
}
