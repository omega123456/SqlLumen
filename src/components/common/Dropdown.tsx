import {
  type CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { CaretDown, Check } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'

export interface DropdownOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

type DropdownPlacement = 'top' | 'bottom'

type DropdownFixedLayout = {
  left: number
  width: number
  top: number | null
  bottom: number | null
}

type DropdownInstanceStyle = CSSProperties & {
  '--ui-dropdown-instance-option-font-size'?: string
  '--ui-dropdown-instance-option-line-height'?: string
  '--ui-dropdown-instance-option-padding-block'?: string
  '--ui-dropdown-instance-option-padding-inline'?: string
  '--ui-dropdown-instance-option-min-height'?: string
}

type DropdownRenderContext = {
  selected: boolean
  highlighted: boolean
}

type DropdownLabelProps =
  | { labelledBy: string; ariaLabel?: undefined }
  | { ariaLabel: string; labelledBy?: undefined }

type DropdownTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'role' | 'id'
> & {
  [key: `data-${string}`]: string | number | undefined
}

type CommonDropdownProps = DropdownLabelProps & {
  id: string
  options: DropdownOption[]
  disabled?: boolean
  'data-testid'?: string
  className?: string
  triggerClassName?: string
  onTriggerKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
  onListKeyDown?: (e: ReactKeyboardEvent<HTMLUListElement>) => void
  onOpenChange?: (open: boolean) => void
  onTriggerFocus?: (e: ReactFocusEvent<HTMLButtonElement>) => void
  onTriggerBlur?: (e: ReactFocusEvent<HTMLButtonElement>) => void
  triggerProps?: DropdownTriggerProps
  closeOnSelect?: boolean
  focusListOnOpen?: boolean
  placeholder?: string
  listAriaLabel?: string
  renderTriggerValue?: (selectedOptions: DropdownOption[]) => ReactNode
  renderOptionLabel?: (option: DropdownOption, context: DropdownRenderContext) => ReactNode
}

type SingleSelectDropdownProps = CommonDropdownProps & {
  multiple?: false
  value: string
  onChange: (value: string) => void
}

type MultiSelectDropdownProps = CommonDropdownProps & {
  multiple: true
  value: string[]
  onChange: (value: string[]) => void
}

export type DropdownProps = SingleSelectDropdownProps | MultiSelectDropdownProps

const MAX_DROPDOWN_HEIGHT = 320
const VIEWPORT_MARGIN = 8

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

function normalizeTypeaheadLabel(value: string): string {
  return value.trim().toLowerCase()
}

function isTypeaheadKey(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return (
    event.key.length === 1 && event.key !== ' ' && !event.altKey && !event.ctrlKey && !event.metaKey
  )
}

function getScrollParents(node: HTMLElement | null): (HTMLElement | Window)[] {
  const list: (HTMLElement | Window)[] = [window]
  let current = node?.parentElement ?? null

  while (current) {
    const style = window.getComputedStyle(current)
    const { overflow, overflowX, overflowY } = style
    if (/(auto|scroll|overlay)/.test(overflow + overflowX + overflowY)) {
      list.push(current)
    }
    current = current.parentElement
  }

  return list
}

function isMultiSelect(props: DropdownProps): props is MultiSelectDropdownProps {
  return props.multiple === true
}

function isOptionSelected(props: DropdownProps, optionValue: string): boolean {
  if (isMultiSelect(props)) {
    return props.value.includes(optionValue)
  }

  return props.value === optionValue
}

export const Dropdown = forwardRef<HTMLButtonElement, DropdownProps>(
  function Dropdown(props, forwardedRef) {
    const {
      id,
      labelledBy,
      ariaLabel,
      options,
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
      placeholder,
      renderTriggerValue,
      renderOptionLabel,
      closeOnSelect = !isMultiSelect(props),
      focusListOnOpen = true,
      listAriaLabel,
    } = props

    const { onClick: triggerOnClick, ...triggerRest } = triggerProps ?? {}
    const listboxId = useId()
    const rootRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLUListElement>(null)
    const [open, setOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(0)
    const [placement, setPlacement] = useState<DropdownPlacement>('bottom')
    const [dropdownMaxHeight, setDropdownMaxHeight] = useState(MAX_DROPDOWN_HEIGHT)
    const [dropdownLayout, setDropdownLayout] = useState<DropdownFixedLayout>({
      left: 0,
      width: 0,
      top: null,
      bottom: null,
    })
    const [dropdownInstanceStyle, setDropdownInstanceStyle] = useState<DropdownInstanceStyle>({})
    const typeaheadRef = useRef('')
    const typeaheadResetTimeoutRef = useRef<number | null>(null)

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

    const selectedIndices = useMemo(() => {
      if (isMultiSelect(props)) {
        return props.value
          .map((selectedValue) => indexOfValue(options, selectedValue))
          .filter((idx) => idx >= 0)
      }

      return [indexOfValue(options, props.value)].filter((idx) => idx >= 0)
    }, [options, props])

    const selectedOptions = useMemo(
      () => selectedIndices.map((idx) => options[idx]!).filter(Boolean),
      [options, selectedIndices]
    )

    const selectedLabel = useMemo(() => {
      if (renderTriggerValue) {
        return renderTriggerValue(selectedOptions)
      }

      if (selectedOptions.length === 0) {
        if (isMultiSelect(props)) {
          if (props.value.length > 0) {
            return props.value.join(', ')
          }
        } else if (props.value) {
          return props.value
        }

        return placeholder ?? options[0]?.label ?? ''
      }

      if (isMultiSelect(props)) {
        return props.value
          .map((value) => options.find((option) => option.value === value)?.label ?? value)
          .join(', ')
      }

      return selectedOptions[0]?.label ?? placeholder ?? options[0]?.label ?? ''
    }, [options, placeholder, props, renderTriggerValue, selectedOptions])

    const resetTypeahead = useCallback(() => {
      typeaheadRef.current = ''
      if (typeaheadResetTimeoutRef.current !== null) {
        window.clearTimeout(typeaheadResetTimeoutRef.current)
        typeaheadResetTimeoutRef.current = null
      }
    }, [])

    const close = useCallback(() => {
      resetTypeahead()
      setOpen(false)
    }, [resetTypeahead])

    const openWithHighlight = useCallback(() => {
      resetTypeahead()
      const enabled = enabledIndices(options)
      const selectedIndex = selectedIndices.find((idx) => enabled.includes(idx)) ?? -1
      const preferred = selectedIndex >= 0 ? selectedIndex : (enabled[0] ?? 0)
      setHighlightedIndex(preferred)
      setOpen(true)
      if (focusListOnOpen) {
        queueMicrotask(() => {
          panelRef.current?.focus()
        })
      }
    }, [focusListOnOpen, options, resetTypeahead, selectedIndices])

    useEffect(() => {
      return () => {
        resetTypeahead()
      }
    }, [resetTypeahead])

    useEffect(() => {
      onOpenChange?.(open)
    }, [open, onOpenChange])

    useEffect(() => {
      if (!open) {
        return
      }

      const handleMouseDown = (event: MouseEvent) => {
        const target = event.target as Node
        if (rootRef.current?.contains(target)) {
          return
        }
        if (panelRef.current?.contains(target)) {
          return
        }
        close()
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          close()
          triggerRef.current?.focus()
        }
      }

      document.addEventListener('mousedown', handleMouseDown)
      document.addEventListener('keydown', handleKeyDown)

      return () => {
        document.removeEventListener('mousedown', handleMouseDown)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }, [close, open])

    useLayoutEffect(() => {
      if (!open) {
        return
      }

      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel) {
        return
      }

      const updatePlacement = () => {
        const triggerRect = trigger.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        const m = VIEWPORT_MARGIN
        const triggerStyles = window.getComputedStyle(trigger)
        const measuredTriggerHeight =
          triggerRect.height ||
          Number.parseFloat(triggerStyles.height) ||
          trigger.offsetHeight ||
          trigger.clientHeight ||
          0

        let left = triggerRect.left
        let width = triggerRect.width
        if (left < m) {
          width -= m - left
          left = m
        }
        if (left + width > vw - m) {
          width = Math.max(80, vw - m - left)
        }

        const desiredHeight = Math.min(
          panel.scrollHeight || MAX_DROPDOWN_HEIGHT,
          MAX_DROPDOWN_HEIGHT
        )
        const availableBelow = Math.max(0, vh - m - triggerRect.bottom)
        const availableAbove = Math.max(0, triggerRect.top - m)
        const nextPlacement: DropdownPlacement =
          availableBelow < desiredHeight && availableAbove > availableBelow ? 'top' : 'bottom'
        const availableSpace = nextPlacement === 'top' ? availableAbove : availableBelow

        setPlacement(nextPlacement)
        setDropdownMaxHeight(Math.max(0, Math.min(MAX_DROPDOWN_HEIGHT, Math.floor(availableSpace))))
        setDropdownInstanceStyle({
          '--ui-dropdown-instance-option-font-size': triggerStyles.fontSize,
          '--ui-dropdown-instance-option-line-height': triggerStyles.lineHeight,
          '--ui-dropdown-instance-option-padding-block': triggerStyles.paddingTop,
          '--ui-dropdown-instance-option-padding-inline': triggerStyles.paddingLeft,
          '--ui-dropdown-instance-option-min-height': `${Math.round(measuredTriggerHeight)}px`,
        })

        if (nextPlacement === 'bottom') {
          setDropdownLayout({
            left,
            width,
            top: triggerRect.bottom - 1,
            bottom: null,
          })
        } else {
          setDropdownLayout({
            left,
            width,
            top: null,
            bottom: vh - triggerRect.top + 1,
          })
        }
      }

      updatePlacement()

      const scrollParents = new Set<EventTarget>(getScrollParents(trigger))
      scrollParents.forEach((target) => {
        target.addEventListener('scroll', updatePlacement, { passive: true })
      })
      window.addEventListener('resize', updatePlacement)

      return () => {
        scrollParents.forEach((target) => {
          target.removeEventListener('scroll', updatePlacement)
        })
        window.removeEventListener('resize', updatePlacement)
      }
    }, [open, options.length])

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

    const handleTypeahead = useCallback(
      (character: string) => {
        const enabled = enabledIndices(options)
        if (enabled.length === 0) {
          return false
        }

        const nextCharacter = character.toLowerCase()
        const nextSearch = `${typeaheadRef.current}${nextCharacter}`
        const currentPosition = enabled.indexOf(highlightedIndex)
        const orderedIndices =
          currentPosition === -1
            ? enabled
            : [...enabled.slice(currentPosition + 1), ...enabled.slice(0, currentPosition + 1)]

        const findMatch = (search: string) =>
          orderedIndices.find((optionIndex) =>
            normalizeTypeaheadLabel(options[optionIndex]?.label ?? '').startsWith(search)
          )

        const nextSearchMatch = findMatch(nextSearch)
        const nextCharacterMatch = findMatch(nextCharacter)
        const matchedIndex = nextSearchMatch ?? nextCharacterMatch
        if (matchedIndex === undefined) {
          resetTypeahead()
          return false
        }

        typeaheadRef.current = nextSearchMatch !== undefined ? nextSearch : nextCharacter

        if (typeaheadResetTimeoutRef.current !== null) {
          window.clearTimeout(typeaheadResetTimeoutRef.current)
        }
        typeaheadResetTimeoutRef.current = window.setTimeout(() => {
          typeaheadRef.current = ''
          typeaheadResetTimeoutRef.current = null
        }, 700)

        setHighlightedIndex(matchedIndex)
        return true
      },
      [highlightedIndex, options, resetTypeahead]
    )

    const selectIndex = useCallback(
      (idx: number) => {
        const opt = options[idx]
        if (!opt || opt.disabled) {
          return
        }

        if (isMultiSelect(props)) {
          const nextValue = props.value.includes(opt.value)
            ? props.value.filter((value) => value !== opt.value)
            : [...props.value, opt.value]
          props.onChange(nextValue)
          if (closeOnSelect) {
            close()
            triggerRef.current?.focus()
          } else {
            if (focusListOnOpen) {
              panelRef.current?.focus()
            } else {
              triggerRef.current?.focus()
            }
          }
          return
        }

        props.onChange(opt.value)
        if (closeOnSelect) {
          close()
          triggerRef.current?.focus()
        }
      },
      [close, closeOnSelect, options, props]
    )

    const handleTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (disabled) {
        onTriggerKeyDown?.(e)
        return
      }

      if (open) {
        if (e.key === 'Tab') {
          close()
          onTriggerKeyDown?.(e)
          return
        }

        if (e.key === 'Escape') {
          onTriggerKeyDown?.(e)
          if (e.defaultPrevented) {
            return
          }
          e.preventDefault()
          close()
          return
        }

        if (isTypeaheadKey(e)) {
          const handled = handleTypeahead(e.key)
          if (handled) {
            e.preventDefault()
            return
          }
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault()
          moveHighlight(1)
          return
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault()
          moveHighlight(-1)
          return
        }

        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectIndex(highlightedIndex)
          return
        }

        if (e.key === 'Home') {
          e.preventDefault()
          const enabled = enabledIndices(options)
          if (enabled.length > 0) {
            setHighlightedIndex(enabled[0]!)
          }
          return
        }

        if (e.key === 'End') {
          e.preventDefault()
          const enabled = enabledIndices(options)
          if (enabled.length > 0) {
            setHighlightedIndex(enabled[enabled.length - 1]!)
          }
          return
        }
      }

      onTriggerKeyDown?.(e)
      if (e.defaultPrevented) {
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        openWithHighlight()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        openWithHighlight()
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openWithHighlight()
      }
    }

    const handleListKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
      onListKeyDown?.(e)
      if (e.defaultPrevented) {
        return
      }
      if (isTypeaheadKey(e)) {
        const handled = handleTypeahead(e.key)
        if (handled) {
          e.preventDefault()
          return
        }
      }
      if (e.key === 'Tab') {
        close()
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

    const multiple = isMultiSelect(props)
    const rootClassName = ['ui-dropdown', className].filter(Boolean).join(' ')
    const triggerClass = ['ui-dropdown__trigger', triggerClassName].filter(Boolean).join(' ')
    const activeDescendantId = open ? `${listboxId}-option-${highlightedIndex}` : undefined

    const listboxLabelledBy = labelledBy ?? undefined
    const listboxAriaLabel = listAriaLabel ?? (ariaLabel && !labelledBy ? ariaLabel : undefined)

    return (
      <div className={rootClassName} ref={rootRef}>
        <button
          ref={setTriggerRef}
          id={id}
          type="button"
          role={multiple ? undefined : 'combobox'}
          className={triggerClass}
          aria-labelledby={labelledBy}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={!multiple && !focusListOnOpen ? activeDescendantId : undefined}
          data-panel-placement={open ? placement : undefined}
          disabled={disabled}
          data-testid={dataTestId}
          {...triggerRest}
          onClick={(e) => {
            triggerOnClick?.(e)
            if (e.defaultPrevented || disabled) {
              return
            }
            if (open) {
              setOpen(false)
            } else {
              openWithHighlight()
            }
          }}
          onFocus={onTriggerFocus}
          onBlur={(e) => {
            onTriggerBlur?.(e)
            if (e.defaultPrevented || !open || focusListOnOpen) {
              return
            }

            const nextFocused = e.relatedTarget
            if (
              nextFocused instanceof Node &&
              (rootRef.current?.contains(nextFocused) || panelRef.current?.contains(nextFocused))
            ) {
              return
            }

            close()
          }}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="ui-dropdown__value">{selectedLabel}</span>
          <CaretDown className="ui-dropdown__chevron" size={16} weight="bold" aria-hidden />
        </button>
        {open
          ? createPortal(
              <ul
                ref={panelRef}
                id={listboxId}
                className={[
                  'ui-dropdown__panel',
                  placement === 'top' ? 'ui-dropdown__panel--top' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                role="listbox"
                tabIndex={0}
                aria-labelledby={listboxLabelledBy}
                aria-label={listboxAriaLabel}
                aria-activedescendant={
                  !multiple && focusListOnOpen ? activeDescendantId : undefined
                }
                aria-multiselectable={multiple ? 'true' : undefined}
                onKeyDown={handleListKeyDown}
                onBlur={(e) => {
                  if (!focusListOnOpen) {
                    return
                  }

                  const nextFocused = e.relatedTarget
                  if (
                    nextFocused instanceof Node &&
                    (rootRef.current?.contains(nextFocused) ||
                      panelRef.current?.contains(nextFocused))
                  ) {
                    return
                  }

                  close()
                }}
                data-placement={placement}
                style={{
                  maxHeight: `${dropdownMaxHeight}px`,
                  left: `${dropdownLayout.left}px`,
                  width: `${dropdownLayout.width}px`,
                  ...dropdownInstanceStyle,
                  ...(placement === 'bottom'
                    ? { top: `${dropdownLayout.top}px`, bottom: 'auto' }
                    : { bottom: `${dropdownLayout.bottom}px`, top: 'auto' }),
                }}
              >
                {options.map((opt, idx) => {
                  const isSelected = isOptionSelected(props, opt.value)
                  const isHighlighted = idx === highlightedIndex
                  const optionClass = [
                    'ui-dropdown__option',
                    isSelected ? 'ui-dropdown__option--selected' : '',
                    isHighlighted && !isSelected ? 'ui-dropdown__option--highlighted' : '',
                    isMultiSelect(props) ? 'ui-dropdown__option--multi' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <li key={`${opt.value}-${idx}`} role="presentation">
                      <button
                        type="button"
                        id={`${listboxId}-option-${idx}`}
                        role="option"
                        aria-label={opt.label}
                        aria-selected={isSelected}
                        className={optionClass}
                        disabled={opt.disabled}
                        data-testid={dataTestId ? `${dataTestId}-option-${opt.value}` : undefined}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                        }}
                        onMouseEnter={() => {
                          setHighlightedIndex(idx)
                        }}
                        onClick={() => {
                          selectIndex(idx)
                        }}
                      >
                        {isMultiSelect(props) ? (
                          <span className="ui-dropdown__option-row">
                            <span className="ui-dropdown__option-content">
                              {renderOptionLabel ? (
                                renderOptionLabel(opt, {
                                  selected: isSelected,
                                  highlighted: isHighlighted,
                                })
                              ) : (
                                <>
                                  <span>{opt.label}</span>
                                  {opt.description ? (
                                    <span className="ui-dropdown__meta">{opt.description}</span>
                                  ) : null}
                                </>
                              )}
                            </span>
                            <Check
                              className="ui-dropdown__check"
                              size={16}
                              weight="bold"
                              aria-hidden
                            />
                          </span>
                        ) : renderOptionLabel ? (
                          renderOptionLabel(opt, {
                            selected: isSelected,
                            highlighted: isHighlighted,
                          })
                        ) : (
                          <>
                            <span>{opt.label}</span>
                            {opt.description ? (
                              <span className="ui-dropdown__meta">{opt.description}</span>
                            ) : null}
                          </>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>,
              document.body
            )
          : null}
      </div>
    )
  }
)
