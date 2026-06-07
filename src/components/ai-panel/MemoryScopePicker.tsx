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
 * Inline "Always Ask" level chooser shown above the chat input when a
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
      BASE_OPTIONS.map((opt) => ({
        ...opt,
        disabled: opt.scope === 'group' && !hasGroup,
      })),
    [hasGroup]
  )

  const enabledIndices = useMemo(
    () => options.map((opt, i) => (opt.disabled ? -1 : i)).filter((i) => i >= 0),
    [options]
  )

  const initialIndex = useMemo(() => {
    const fromDefault = options.findIndex((opt) => opt.scope === defaultScope && !opt.disabled)
    if (fromDefault >= 0) {
      return fromDefault
    }
    const connectionIndex = options.findIndex((opt) => opt.scope === 'connection' && !opt.disabled)
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
      const currentPos = enabledIndices.indexOf(highlightedIndex)
      const start = currentPos === -1 ? 0 : currentPos
      const nextPos = (start + delta + enabledIndices.length) % enabledIndices.length
      setHighlightedIndex(enabledIndices[nextPos]!)
    },
    [enabledIndices, highlightedIndex]
  )

  const selectIndex = useCallback(
    (index: number) => {
      const opt = options[index]
      if (!opt || opt.disabled) {
        return
      }
      onSelect(opt.scope)
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.timeStamp <= attachedAt) {
        return
      }
      const h = handlersRef.current
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        h.moveHighlight(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        h.moveHighlight(-1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        h.selectIndex(h.highlightedIndex)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        h.onCancel()
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
      {options.map((opt, i) => {
        const IconComponent = opt.icon
        const isHighlighted = i === highlightedIndex
        return (
          <div
            key={opt.scope}
            role="option"
            id={`memory-scope-${opt.scope}`}
            aria-selected={isHighlighted && !opt.disabled}
            aria-disabled={opt.disabled || undefined}
            className={[
              styles.option,
              isHighlighted && !opt.disabled ? styles.optionHighlighted : '',
              opt.disabled ? styles.optionDisabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-testid={`memory-scope-option-${opt.scope}`}
            onClick={() => selectIndex(i)}
            onMouseEnter={() => {
              if (!opt.disabled) {
                setHighlightedIndex(i)
              }
            }}
          >
            <IconComponent size={16} className={styles.optionIcon} aria-hidden />
            <span className={styles.optionLabel}>{opt.label}</span>
            {opt.disabled && (
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
