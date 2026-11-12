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
import { CaretDown, Check, type IconWeight } from '@phosphor-icons/react'
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

type DropdownRenderContext = {
  selected: boolean
  highlighted: boolean
}

type DropdownLabelProps =
  { labelledBy: string; ariaLabel?: undefined } | { ariaLabel: string; labelledBy?: undefined }

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
  /** Trigger chevron size and weight; defaults to 16px bold. */
  chevronSize?: number
  chevronWeight?: IconWeight
  /** Minimum flyout width in px; defaults to the Fluent 140px. */
  minPanelWidth?: number
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
/** Fluent flyout: detached 4px from the trigger, at least 140px wide. */
const FLYOUT_GAP = 4
const FLYOUT_MIN_WIDTH = 140

function indexOfValue(options: DropdownOption[], value: string): number {
  return options.findIndex((option) => option.value === value)
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

type HorizontalPanelBounds = { left: number; width: number }

interface FixedPanelLayoutRequest {
  triggerRect: DOMRect
  dialogRect: DOMRect | null
  horizontal: HorizontalPanelBounds
  placement: DropdownPlacement
}

function assignForwardedRef<T>(ref: React.ForwardedRef<T>, node: T | null): void {
  if (typeof ref === 'function') {
    ref(node)
    return
  }
  if (ref) {
    ref.current = node
  }
}

function fallbackTriggerLabel(props: DropdownProps): string {
  if (isMultiSelect(props) && props.value.length > 0) return props.value.join(', ')
  if (!isMultiSelect(props) && props.value) return props.value
  return props.placeholder ?? props.options[0]?.label ?? ''
}

function multiSelectTriggerLabel(props: MultiSelectDropdownProps): string {
  return props.value
    .map((value) => props.options.find((option) => option.value === value)?.label ?? value)
    .join(', ')
}

function resolveSelectedLabel(props: DropdownProps, selectedOptions: DropdownOption[]): ReactNode {
  if (props.renderTriggerValue) return props.renderTriggerValue(selectedOptions)
  if (selectedOptions.length === 0) return fallbackTriggerLabel(props)
  if (isMultiSelect(props)) return multiSelectTriggerLabel(props)
  return selectedOptions[0]?.label ?? props.placeholder ?? props.options[0]?.label ?? ''
}

function applyTriggerLabel(
  trigger: HTMLButtonElement,
  labelledBy: string | undefined,
  ariaLabel: string | undefined
): void {
  if (labelledBy) {
    trigger.setAttribute('aria-labelledby', labelledBy)
    trigger.removeAttribute('aria-label')
    return
  }
  if (ariaLabel) {
    trigger.setAttribute('aria-label', ariaLabel)
    trigger.removeAttribute('aria-labelledby')
  }
}

function horizontalPanelBounds(triggerRect: DOMRect, minPanelWidth: number): HorizontalPanelBounds {
  const viewportWidth = window.innerWidth
  let left = triggerRect.left
  let width = Math.max(triggerRect.width, minPanelWidth)
  if (left < VIEWPORT_MARGIN) {
    width -= VIEWPORT_MARGIN - left
    left = VIEWPORT_MARGIN
  }
  if (left + width > viewportWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - width)
    width = Math.min(width, viewportWidth - VIEWPORT_MARGIN - VIEWPORT_MARGIN)
  }
  return { left: left, width: width }
}

function verticalPanelPlacement(
  triggerRect: DOMRect,
  panel: HTMLElement
): { placement: DropdownPlacement; maxHeight: number } {
  const desiredHeight = Math.min(panel.scrollHeight || MAX_DROPDOWN_HEIGHT, MAX_DROPDOWN_HEIGHT)
  const availableBelow = Math.max(
    0,
    window.innerHeight - VIEWPORT_MARGIN - FLYOUT_GAP - triggerRect.bottom
  )
  const availableAbove = Math.max(0, triggerRect.top - VIEWPORT_MARGIN - FLYOUT_GAP)
  const opensAbove = availableBelow < desiredHeight && availableAbove > availableBelow
  const availableSpace = opensAbove ? availableAbove : availableBelow
  return {
    placement: opensAbove ? 'top' : 'bottom',
    maxHeight: Math.max(0, Math.min(MAX_DROPDOWN_HEIGHT, Math.floor(availableSpace))),
  }
}

function fixedPanelLayout(request: FixedPanelLayoutRequest): DropdownFixedLayout {
  const { triggerRect, dialogRect, horizontal } = request
  const left = horizontal.left - (dialogRect?.left ?? 0)
  if (request.placement === 'bottom') {
    const top = triggerRect.bottom + FLYOUT_GAP - (dialogRect?.top ?? 0)
    return { left: left, width: horizontal.width, top: top, bottom: null }
  }
  const containerBottom = dialogRect?.bottom ?? window.innerHeight
  const bottom = containerBottom - triggerRect.top + FLYOUT_GAP
  return { left: left, width: horizontal.width, top: null, bottom: bottom }
}

function closestDialogElement(trigger: HTMLElement): HTMLElement | null {
  const closestDialog = trigger.closest('dialog')
  return closestDialog instanceof HTMLElement ? closestDialog : null
}

function listboxAriaLabelFor(props: CommonDropdownProps): string | undefined {
  if (props.listAriaLabel !== undefined) return props.listAriaLabel
  if (props.labelledBy || !props.ariaLabel) return undefined
  return props.ariaLabel
}

function buildListboxClassName(isPortalInDialog: boolean, placement: DropdownPlacement): string {
  return [
    'ui-dropdown__panel',
    'click-outside-ignore',
    isPortalInDialog ? 'ui-dropdown__panel--in-dialog' : '',
    placement === 'top' ? 'ui-dropdown__panel--top' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function buildListboxStyle(
  maxHeight: number,
  layout: DropdownFixedLayout,
  placement: DropdownPlacement
): CSSProperties {
  const verticalAnchor =
    placement === 'bottom'
      ? { top: `${layout.top}px`, bottom: 'auto' }
      : { bottom: `${layout.bottom}px`, top: 'auto' }
  return {
    maxHeight: `${maxHeight}px`,
    left: `${layout.left}px`,
    width: `${layout.width}px`,
    ...verticalAnchor,
  }
}

function SingleOptionLabel({
  option,
  context,
  renderOptionLabel,
}: {
  option: DropdownOption
  context: DropdownRenderContext
  renderOptionLabel: CommonDropdownProps['renderOptionLabel']
}) {
  if (renderOptionLabel) return <>{renderOptionLabel(option, context)}</>
  return (
    <>
      <span>{option.label}</span>
      {option.description ? <span className="ui-dropdown__meta">{option.description}</span> : null}
    </>
  )
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
  const previousOpenRef = useRef(open)
  const scrollParentsRef = useRef<Set<EventTarget> | null>(null)

  useEffect(() => {
    if (previousOpenRef.current !== open) {
      previousOpenRef.current = open
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

    if (!scrollParentsRef.current) {
      scrollParentsRef.current = new Set<EventTarget>(getScrollParents(trigger))
    }
    const scrollParents = scrollParentsRef.current

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
      renderOptionLabel,
      closeOnSelect = !isMultiSelect(props),
      focusListOnOpen = true,
      workspaceTabId,
      chevronSize = 16,
      chevronWeight = 'bold',
      minPanelWidth = FLYOUT_MIN_WIDTH,
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
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
    const [isPortalInDialog, setIsPortalInDialog] = useState(false)
    const openRef = useRef(false)

    const setTriggerRef = useCallback(
      (node: HTMLButtonElement | null) => {
        triggerRef.current = node
        assignForwardedRef(forwardedRef, node)
      },
      [forwardedRef]
    )

    const selectedIndices = useMemo(() => {
      if (isMultiSelect(props)) {
        return props.value
          .map((selectedValue) => indexOfValue(options, selectedValue))
          .filter((index) => index >= 0)
      }

      return [indexOfValue(options, props.value)].filter((index) => index >= 0)
    }, [options, props])

    const selectedOptions = useMemo(
      () => selectedIndices.map((index) => options[index]!).filter(Boolean),
      [options, selectedIndices]
    )

    const selectedLabel = useMemo(
      () => resolveSelectedLabel(props, selectedOptions),
      [props, selectedOptions]
    )

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

      applyTriggerLabel(trigger, labelledBy, ariaLabel)
    }, [ariaLabel, labelledBy])

    const updatePlacement = useCallback(() => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel) {
        return
      }

      // Inside a native <dialog> the panel must render into that dialog's top-layer subtree.
      const dialog = closestDialogElement(trigger)
      setPortalContainer(dialog ?? document.body)
      setIsPortalInDialog(dialog !== null)

      const triggerRect = trigger.getBoundingClientRect()
      const horizontal = horizontalPanelBounds(triggerRect, minPanelWidth)
      const vertical = verticalPanelPlacement(triggerRect, panel)
      setPlacement(vertical.placement)
      setDropdownMaxHeight(vertical.maxHeight)
      setDropdownLayout(
        fixedPanelLayout({
          triggerRect: triggerRect,
          dialogRect: dialog?.getBoundingClientRect() ?? null,
          horizontal: horizontal,
          placement: vertical.placement,
        })
      )
    }, [minPanelWidth])

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
    const listboxAriaLabel = listboxAriaLabelFor(props)
    const listboxClassName = buildListboxClassName(isPortalInDialog, placement)
    const listboxStyle = buildListboxStyle(dropdownMaxHeight, dropdownLayout, placement)

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
          aria-labelledby={labelledBy}
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
          onBlur={(event) => {
            if (!focusListOnOpen) {
              return
            }

            if (isWithinDropdownTarget(event.relatedTarget)) {
              return
            }

            closeListbox()
          }}
          data-placement={placement}
          style={listboxStyle}
        >
          {options.map((option, index) => (
            <ListboxOption
              as="li"
              key={`${option.value}-${index}`}
              id={`${listboxId}-option-${index}`}
              value={option.value}
              disabled={option.disabled}
              aria-label={option.label}
              data-testid={dataTestId ? `${dataTestId}-option-${option.value}` : undefined}
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
                          renderOptionLabel(option, {
                            selected: selected,
                            highlighted: focus,
                          })
                        ) : (
                          <>
                            <span>{option.label}</span>
                            {option.description ? (
                              <span className="ui-dropdown__meta">{option.description}</span>
                            ) : null}
                          </>
                        )}
                      </span>
                      <Check className="ui-dropdown__check" size={16} weight="bold" aria-hidden />
                    </span>
                  ) : (
                    <SingleOptionLabel
                      option={option}
                      context={{ selected: selected, highlighted: focus }}
                      renderOptionLabel={renderOptionLabel}
                    />
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
                  onClick={(event) => {
                    triggerOnClick?.(event)
                  }}
                  onFocus={onTriggerFocus}
                  onBlur={(event) => {
                    onTriggerBlur?.(event)
                    if (event.defaultPrevented || !open || focusListOnOpen) {
                      return
                    }

                    if (isWithinDropdownTarget(event.relatedTarget)) {
                      return
                    }

                    closeListbox()
                  }}
                  onKeyDown={onTriggerKeyDown}
                >
                  <span className="ui-dropdown__value">{selectedLabel}</span>
                  <CaretDown
                    className="ui-dropdown__chevron"
                    size={chevronSize}
                    weight={chevronWeight}
                    aria-hidden
                  />
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
                onClick={(event) => {
                  triggerOnClick?.(event)
                }}
                onFocus={onTriggerFocus}
                onBlur={(event) => {
                  onTriggerBlur?.(event)
                  if (event.defaultPrevented || !open || focusListOnOpen) {
                    return
                  }

                  if (isWithinDropdownTarget(event.relatedTarget)) {
                    return
                  }

                  closeListbox()
                }}
                onKeyDown={onTriggerKeyDown}
              >
                <span className="ui-dropdown__value">{selectedLabel}</span>
                <CaretDown
                  className="ui-dropdown__chevron"
                  size={chevronSize}
                  weight={chevronWeight}
                  aria-hidden
                />
              </ListboxButton>
              {renderOptions(open)}
            </div>
          )
        }}
      </Listbox>
    )
  }
)
