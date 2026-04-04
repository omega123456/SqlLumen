import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'

export interface DropdownOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

function enabledIndices(options: DropdownOption[]): number[] {
  const out: number[] = []
  for (let i = 0; i < options.length; i++) {
    if (!options[i].disabled) {
      out.push(i)
    }
  }
  return out
}

function indexOfValue(options: DropdownOption[], value: string): number {
  return options.findIndex((o) => o.value === value)
}

type DropdownLabelProps =
  | { labelledBy: string; ariaLabel?: undefined }
  | { ariaLabel: string; labelledBy?: undefined }

export type DropdownProps = DropdownLabelProps & {
  id: string
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  'data-testid'?: string
  className?: string
  triggerClassName?: string
  onTriggerKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
  onListKeyDown?: (e: ReactKeyboardEvent<HTMLUListElement>) => void
  onOpenChange?: (open: boolean) => void
  onTriggerFocus?: (e: ReactFocusEvent<HTMLButtonElement>) => void
  onTriggerBlur?: (e: ReactFocusEvent<HTMLButtonElement>) => void
  triggerProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'role' | 'id'>
}

export const Dropdown = forwardRef<HTMLButtonElement, DropdownProps>(function Dropdown(
  {
    id,
    labelledBy,
    ariaLabel,
    options,
    value,
    onChange,
    disabled,
    'data-testid': dataTestId,
    className,
    triggerClassName,
    onTriggerKeyDown,
    onListKeyDown,
    onOpenChange,
    onTriggerFocus,
    onTriggerBlur,
    triggerProps,
  },
  forwardedRef
) {
  const { onClick: triggerOnClick, ...triggerRest } = triggerProps ?? {}
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const setTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node
      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef]
  )

  const selectedIndex = useMemo(() => indexOfValue(options, value), [options, value])
  const selectedLabel = options[selectedIndex]?.label ?? options[0]?.label ?? ''

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const openWithHighlight = useCallback(() => {
    const enabled = enabledIndices(options)
    const preferred = enabled.includes(selectedIndex) ? selectedIndex : (enabled[0] ?? 0)
    setHighlightedIndex(preferred)
    setOpen(true)
  }, [options, selectedIndex])

  useDismissOnOutsideClick(rootRef, open, close, { closeOnEscape: true })

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) {
      return
    }
    const raf = window.requestAnimationFrame(() => {
      listRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [open])

  const moveHighlight = useCallback(
    (delta: number) => {
      const enabled = enabledIndices(options)
      if (enabled.length === 0) {
        return
      }
      const currentPos = enabled.indexOf(highlightedIndex)
      const start = currentPos === -1 ? 0 : currentPos
      const nextPos = (start + delta + enabled.length) % enabled.length
      setHighlightedIndex(enabled[nextPos]!)
    },
    [highlightedIndex, options]
  )

  const selectIndex = useCallback(
    (idx: number) => {
      const opt = options[idx]
      if (!opt || opt.disabled) {
        return
      }
      onChange(opt.value)
      close()
      triggerRef.current?.focus()
    },
    [close, onChange, options]
  )

  const handleTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    onTriggerKeyDown?.(e)
    if (e.defaultPrevented) {
      return
    }
    if (disabled) {
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        openWithHighlight()
      } else {
        moveHighlight(1)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        openWithHighlight()
      } else {
        moveHighlight(-1)
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (open) {
        selectIndex(highlightedIndex)
      } else {
        openWithHighlight()
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        close()
      }
    } else if (e.key === 'Home') {
      if (open) {
        e.preventDefault()
        const enabled = enabledIndices(options)
        if (enabled.length > 0) {
          setHighlightedIndex(enabled[0]!)
        }
      }
    } else if (e.key === 'End') {
      if (open) {
        e.preventDefault()
        const enabled = enabledIndices(options)
        if (enabled.length > 0) {
          setHighlightedIndex(enabled[enabled.length - 1]!)
        }
      }
    }
  }

  const handleListKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    onListKeyDown?.(e)
    if (e.defaultPrevented) {
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveHighlight(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight(-1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectIndex(highlightedIndex)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      triggerRef.current?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      const enabled = enabledIndices(options)
      if (enabled.length > 0) {
        setHighlightedIndex(enabled[0]!)
      }
    } else if (e.key === 'End') {
      e.preventDefault()
      const enabled = enabledIndices(options)
      if (enabled.length > 0) {
        setHighlightedIndex(enabled[enabled.length - 1]!)
      }
    }
  }

  const rootClassName = ['ui-dropdown', className].filter(Boolean).join(' ')
  const triggerClass = ['ui-dropdown__trigger', triggerClassName].filter(Boolean).join(' ')

  const listboxLabelledBy = labelledBy ?? undefined
  const listboxAriaLabel = ariaLabel && !labelledBy ? ariaLabel : undefined

  return (
    <div className={rootClassName} ref={rootRef}>
      <button
        ref={setTriggerRef}
        id={id}
        type="button"
        role="combobox"
        className={triggerClass}
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        data-testid={dataTestId}
        {...triggerRest}
        onClick={(e) => {
          triggerOnClick?.(e)
          if (disabled) {
            return
          }
          if (open) {
            setOpen(false)
          } else {
            openWithHighlight()
          }
        }}
        onFocus={onTriggerFocus}
        onBlur={onTriggerBlur}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="ui-dropdown__value">{selectedLabel}</span>
        <CaretDown className="ui-dropdown__chevron" size={16} weight="bold" aria-hidden />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          className="ui-dropdown__panel"
          role="listbox"
          tabIndex={0}
          aria-labelledby={listboxLabelledBy}
          aria-label={listboxAriaLabel}
          onKeyDown={handleListKeyDown}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value
            const isHighlighted = idx === highlightedIndex
            const optionClass = [
              'ui-dropdown__option',
              isSelected ? 'ui-dropdown__option--selected' : '',
              isHighlighted && !isSelected ? 'ui-dropdown__option--highlighted' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <li key={`${opt.value}-${idx}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-label={opt.label}
                  aria-selected={isSelected}
                  className={optionClass}
                  disabled={opt.disabled}
                  onMouseEnter={() => {
                    setHighlightedIndex(idx)
                  }}
                  onClick={() => {
                    selectIndex(idx)
                  }}
                >
                  <span>{opt.label}</span>
                  {opt.description ? (
                    <span className="ui-dropdown__meta">{opt.description}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})
