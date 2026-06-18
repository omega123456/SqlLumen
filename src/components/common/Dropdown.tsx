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
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { CaretDown, Check } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { subscribeToTabDeactivated } from '../../lib/workspace-tab-activity-events'

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
  workspaceTabId?: string
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
// Fallback inset for options when the trigger's horizontal padding can't be read. Options
// sit inside a portaled panel (outside the token scope), so the inline padding must be a
// concrete px value. We mirror the trigger's own padding so options stay proportional to
// their trigger — important for compact dropdowns where extra padding would force wrapping.
const DEFAULT_OPTION_INLINE_PADDING = 16

function resolveOptionInlinePadding(triggerPaddingLeft: string): string {
  const parsed = Number.parseFloat(triggerPaddingLeft)
  return Number.isFinite(parsed) ? `${parsed}px` : `${DEFAULT_OPTION_INLINE_PADDING}px`
}

function indexOfValue(options: DropdownOption[], value: string): number {
  return options.findIndex((o) => o.value === value)
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

type DropdownChromeProps = {
  open: boolean
  options: DropdownOption[]
  rootRef: React.RefObject<HTMLDivElement | null>
  triggerRef: React.RefObject<HTMLButtonElement | null>
  panelRef: React.RefObject<HTMLUListElement | null>
  workspaceTabId?: string
  focusListOnOpen: boolean
  onOpenChange?: (open: boolean) => void
  closeListbox: () => void
  updatePlacement: () => void
}

function DropdownChrome({
  open,
  options,
  rootRef,
  triggerRef,
  panelRef,
  workspaceTabId,
  focusListOnOpen,
  onOpenChange,
  closeListbox,
  updatePlacement,
}: DropdownChromeProps) {
  const prevOpenRef = useRef(open)
  const scrollParentsRef = useRef<Set<EventTarget> | null>(null)

  useEffect(() => {
    if (prevOpenRef.current !== open) {
      prevOpenRef.current = open
      onOpenChange?.(open)
    }
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)
      ) {
        return
      }

      closeListbox()
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [closeListbox, open, panelRef, rootRef])

  useEffect(() => {
    if (!workspaceTabId) {
      return
    }

    return subscribeToTabDeactivated(workspaceTabId, closeListbox)
  }, [closeListbox, workspaceTabId])

  useLayoutEffect(() => {
    if (!open || !focusListOnOpen) {
      return
    }

    queueMicrotask(() => {
      panelRef.current?.focus()
    })
  }, [focusListOnOpen, open, panelRef])

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) {
      return
    }

    updatePlacement()

    const updateInstanceMetrics = () => {
      const triggerStyles = window.getComputedStyle(trigger)
      const triggerRect = trigger.getBoundingClientRect()
      const measuredTriggerHeight =
        triggerRect.height ||
        Number.parseFloat(triggerStyles.height) ||
        trigger.offsetHeight ||
        trigger.clientHeight ||
        0

      panel.style.setProperty('--ui-dropdown-instance-option-font-size', triggerStyles.fontSize)
      panel.style.setProperty('--ui-dropdown-instance-option-line-height', triggerStyles.lineHeight)
      // The option's min-height already matches the full trigger height, so vertical
      // spacing is handled by min-height + centering. Adding the trigger's padding on
      // top would leave no slack and make rows with bolder (selected) text taller.
      panel.style.setProperty('--ui-dropdown-instance-option-padding-block', '0px')
      // The panel is portaled to <body>, outside the --ui-dropdown-* token scope, so the
      // CSS token fallback can't resolve there — the inline padding must be a concrete px
      // value. Use a comfortable minimum so option text stays clear of the accent bar even
      // when the trigger itself uses a compact, narrow horizontal padding.
      panel.style.setProperty(
        '--ui-dropdown-instance-option-padding-inline',
        resolveOptionInlinePadding(triggerStyles.paddingLeft)
      )
      panel.style.setProperty(
        '--ui-dropdown-instance-option-min-height',
        `${Math.round(measuredTriggerHeight)}px`
      )
    }

    updateInstanceMetrics()

    if (!scrollParentsRef.current) {
      scrollParentsRef.current = new Set<EventTarget>(getScrollParents(trigger))
    }
    const scrollParents = scrollParentsRef.current

    scrollParents.forEach((target) => {
      target.addEventListener('scroll', updatePlacement, { passive: true })
      target.addEventListener('scroll', updateInstanceMetrics, { passive: true })
    })
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('resize', updateInstanceMetrics)

    return () => {
      scrollParents.forEach((target) => {
        target.removeEventListener('scroll', updatePlacement)
        target.removeEventListener('scroll', updateInstanceMetrics)
      })
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('resize', updateInstanceMetrics)
    }
  }, [open, options.length, panelRef, triggerRef, updatePlacement])

  return null
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
      workspaceTabId,
    } = props

    const { onClick: triggerOnClick, ...triggerRest } = triggerProps ?? {}
    const listboxId = useId()
    const rootRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLUListElement>(null)
    const [placement, setPlacement] = useState<DropdownPlacement>('bottom')
    const [dropdownMaxHeight, setDropdownMaxHeight] = useState(MAX_DROPDOWN_HEIGHT)
    const [dropdownLayout, setDropdownLayout] = useState<DropdownFixedLayout>({
      left: 0,
      width: 0,
      top: null,
      bottom: null,
    })
    const [dropdownInstanceStyle, setDropdownInstanceStyle] = useState<DropdownInstanceStyle>({})
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
    const [isPortalInDialog, setIsPortalInDialog] = useState(false)
    const openRef = useRef(false)

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

    const isWithinDropdownTarget = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)

    const closeListbox = useCallback(() => {
      if (!openRef.current) {
        return
      }

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      ;(panelRef.current ?? triggerRef.current)?.dispatchEvent(event)
    }, [])

    useLayoutEffect(() => {
      const trigger = triggerRef.current
      if (!trigger) {
        return
      }

      if (labelledBy) {
        trigger.setAttribute('aria-labelledby', labelledBy)
        trigger.removeAttribute('aria-label')
      } else if (ariaLabel) {
        trigger.setAttribute('aria-label', ariaLabel)
        trigger.removeAttribute('aria-labelledby')
      }
    }, [ariaLabel, labelledBy])

    const updatePlacement = useCallback(() => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel) {
        return
      }

      // When used inside a native <dialog>, render into that dialog's top-layer subtree.
      const closestDialog = trigger.closest('dialog')
      if (closestDialog instanceof HTMLElement) {
        setPortalContainer(closestDialog)
        setIsPortalInDialog(true)
      } else {
        setPortalContainer(document.body)
        setIsPortalInDialog(false)
      }

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

      const desiredHeight = Math.min(panel.scrollHeight || MAX_DROPDOWN_HEIGHT, MAX_DROPDOWN_HEIGHT)
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
        '--ui-dropdown-instance-option-padding-block': '0px',
        '--ui-dropdown-instance-option-padding-inline': resolveOptionInlinePadding(
          triggerStyles.paddingLeft
        ),
        '--ui-dropdown-instance-option-min-height': `${Math.round(measuredTriggerHeight)}px`,
      })

      const dialogRect =
        closestDialog instanceof HTMLElement ? closestDialog.getBoundingClientRect() : null
      const leftValue = dialogRect ? left - dialogRect.left : left
      const topValue = dialogRect ? triggerRect.bottom - 1 - dialogRect.top : triggerRect.bottom - 1
      const bottomValue = dialogRect
        ? dialogRect.bottom - triggerRect.top + 1
        : vh - triggerRect.top + 1

      if (nextPlacement === 'bottom') {
        setDropdownLayout({
          left: leftValue,
          width,
          top: topValue,
          bottom: null,
        })
      } else {
        setDropdownLayout({
          left: leftValue,
          width,
          top: null,
          bottom: bottomValue,
        })
      }
    }, [])

    const setPanelRef = useCallback(
      (node: HTMLUListElement | null) => {
        panelRef.current = node
        if (node) {
          updatePlacement()
        }
      },
      [updatePlacement]
    )

    const rootClassName = ['ui-dropdown', className].filter(Boolean).join(' ')
    const triggerClass = ['ui-dropdown__trigger', triggerClassName].filter(Boolean).join(' ')
    const listboxLabelledBy = labelledBy ?? undefined
    const listboxAriaLabel = listAriaLabel ?? (ariaLabel && !labelledBy ? ariaLabel : undefined)
    const listboxClassName = [
      'ui-dropdown__panel',
      'click-outside-ignore',
      isPortalInDialog ? 'ui-dropdown__panel--in-dialog' : '',
      placement === 'top' ? 'ui-dropdown__panel--top' : '',
    ]
      .filter(Boolean)
      .join(' ')
    const listboxStyle: DropdownInstanceStyle = {
      maxHeight: `${dropdownMaxHeight}px`,
      left: `${dropdownLayout.left}px`,
      width: `${dropdownLayout.width}px`,
      ...dropdownInstanceStyle,
      ...(placement === 'bottom'
        ? { top: `${dropdownLayout.top}px`, bottom: 'auto' }
        : { bottom: `${dropdownLayout.bottom}px`, top: 'auto' }),
    }

    const renderOptions = (open: boolean) => {
      if (!open) {
        return null
      }

      return createPortal(
        <ListboxOptions
          static
          as="ul"
          modal={false}
          ref={setPanelRef}
          id={listboxId}
          className={listboxClassName}
          aria-labelledby={listboxLabelledBy}
          aria-label={listboxAriaLabel}
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              onTriggerKeyDown?.(event as unknown as ReactKeyboardEvent<HTMLButtonElement>)
              onListKeyDown?.(event)
              return
            }

            if (event.key === 'Enter' || event.key === ' ') {
              return
            }

            onListKeyDown?.(event)
          }}
          onBlur={(e) => {
            if (!focusListOnOpen) {
              return
            }

            if (isWithinDropdownTarget(e.relatedTarget)) {
              return
            }

            closeListbox()
          }}
          data-placement={placement}
          style={listboxStyle}
        >
          {options.map((opt, idx) => (
            <ListboxOption
              as="li"
              key={`${opt.value}-${idx}`}
              id={`${listboxId}-option-${idx}`}
              value={opt.value}
              disabled={opt.disabled}
              aria-label={opt.label}
              data-testid={dataTestId ? `${dataTestId}-option-${opt.value}` : undefined}
              className={({ selected, focus, disabled: optionDisabled }) =>
                [
                  'ui-dropdown__option',
                  selected ? 'ui-dropdown__option--selected' : '',
                  focus && !selected ? 'ui-dropdown__option--highlighted' : '',
                  isMultiSelect(props) ? 'ui-dropdown__option--multi' : '',
                  optionDisabled ? 'ui-dropdown__option--disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={() => {
                if (isMultiSelect(props) && closeOnSelect) {
                  queueMicrotask(closeListbox)
                }
              }}
            >
              {({ selected, focus }) => (
                <>
                  {isMultiSelect(props) ? (
                    <span className="ui-dropdown__option-row">
                      <span className="ui-dropdown__option-content">
                        {renderOptionLabel ? (
                          renderOptionLabel(opt, {
                            selected,
                            highlighted: focus,
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
                      <Check className="ui-dropdown__check" size={16} weight="bold" aria-hidden />
                    </span>
                  ) : renderOptionLabel ? (
                    renderOptionLabel(opt, {
                      selected,
                      highlighted: focus,
                    })
                  ) : (
                    <>
                      <span>{opt.label}</span>
                      {opt.description ? (
                        <span className="ui-dropdown__meta">{opt.description}</span>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>,
        portalContainer ?? document.body
      )
    }

    if (isMultiSelect(props)) {
      return (
        <Listbox value={props.value} onChange={props.onChange} disabled={disabled} multiple>
          {({ open }) => {
            openRef.current = open
            return (
              <div className={rootClassName} ref={rootRef}>
                <DropdownChrome
                  open={open}
                  options={options}
                  rootRef={rootRef}
                  triggerRef={triggerRef}
                  panelRef={panelRef}
                  workspaceTabId={workspaceTabId}
                  focusListOnOpen={focusListOnOpen}
                  onOpenChange={onOpenChange}
                  closeListbox={closeListbox}
                  updatePlacement={updatePlacement}
                />
                <ListboxButton
                  ref={setTriggerRef}
                  id={id}
                  className={triggerClass}
                  aria-labelledby={labelledBy}
                  aria-label={ariaLabel}
                  aria-controls={listboxId}
                  data-panel-placement={open ? placement : undefined}
                  data-testid={dataTestId}
                  {...triggerRest}
                  onClick={(e) => {
                    triggerOnClick?.(e)
                  }}
                  onFocus={onTriggerFocus}
                  onBlur={(e) => {
                    onTriggerBlur?.(e)
                    if (e.defaultPrevented || !open || focusListOnOpen) {
                      return
                    }

                    if (isWithinDropdownTarget(e.relatedTarget)) {
                      return
                    }

                    closeListbox()
                  }}
                  onKeyDown={onTriggerKeyDown}
                >
                  <span className="ui-dropdown__value">{selectedLabel}</span>
                  <CaretDown className="ui-dropdown__chevron" size={16} weight="bold" aria-hidden />
                </ListboxButton>
                {renderOptions(open)}
              </div>
            )
          }}
        </Listbox>
      )
    }

    return (
      <Listbox value={props.value} onChange={props.onChange} disabled={disabled}>
        {({ open }) => {
          openRef.current = open
          return (
            <div className={rootClassName} ref={rootRef}>
              <DropdownChrome
                open={open}
                options={options}
                rootRef={rootRef}
                triggerRef={triggerRef}
                panelRef={panelRef}
                workspaceTabId={workspaceTabId}
                focusListOnOpen={focusListOnOpen}
                onOpenChange={onOpenChange}
                closeListbox={closeListbox}
                updatePlacement={updatePlacement}
              />
              <ListboxButton
                ref={setTriggerRef}
                id={id}
                role="combobox"
                className={triggerClass}
                aria-labelledby={labelledBy}
                aria-label={ariaLabel}
                aria-controls={listboxId}
                data-panel-placement={open ? placement : undefined}
                data-testid={dataTestId}
                {...triggerRest}
                onClick={(e) => {
                  triggerOnClick?.(e)
                }}
                onFocus={onTriggerFocus}
                onBlur={(e) => {
                  onTriggerBlur?.(e)
                  if (e.defaultPrevented || !open || focusListOnOpen) {
                    return
                  }

                  if (isWithinDropdownTarget(e.relatedTarget)) {
                    return
                  }

                  closeListbox()
                }}
                onKeyDown={onTriggerKeyDown}
              >
                <span className="ui-dropdown__value">{selectedLabel}</span>
                <CaretDown className="ui-dropdown__chevron" size={16} weight="bold" aria-hidden />
              </ListboxButton>
              {renderOptions(open)}
            </div>
          )
        }}
      </Listbox>
    )
  }
)
