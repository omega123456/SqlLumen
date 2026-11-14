import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { ListboxOption, ListboxOptions } from '@headlessui/react'
import { Check } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { isActivationKey } from '../../../lib/input-events'
import { buildListboxClassName, buildListboxStyle, buildOptionClassName } from './dropdown-layout'
import { listboxAriaLabelFor } from './dropdown-labels'
import type { DropdownController } from './use-dropdown-controller'
import {
  isMultiSelect,
  type CommonDropdownProps,
  type DropdownOption,
  type DropdownProps,
  type DropdownRenderContext,
} from './dropdown-types'

const CHECK_ICON_SIZE = 16

interface OptionLabelProps<TValue extends string> {
  option: DropdownOption<TValue>
  context: DropdownRenderContext
  renderOptionLabel: CommonDropdownProps<TValue>['renderOptionLabel']
}

function SingleOptionLabel<TValue extends string>({
  option,
  context,
  renderOptionLabel,
}: OptionLabelProps<TValue>) {
  if (renderOptionLabel) return <>{renderOptionLabel(option, context)}</>
  return (
    <>
      <span>{option.label}</span>
      {option.description ? <span className="ui-dropdown__meta">{option.description}</span> : null}
    </>
  )
}

function MultiOptionLabel<TValue extends string>(props: OptionLabelProps<TValue>) {
  return (
    <span className="ui-dropdown__option-row">
      <span className="ui-dropdown__option-content">
        <SingleOptionLabel {...props} />
      </span>
      <Check className="ui-dropdown__check" size={CHECK_ICON_SIZE} weight="bold" aria-hidden />
    </span>
  )
}

function preventFocusSteal(event: ReactMouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

interface DropdownOptionsPanelProps<TValue extends string> {
  dropdownProps: DropdownProps<TValue>
  controller: DropdownController
}

function useListKeyDown<TValue extends string>(dropdownProps: DropdownProps<TValue>) {
  const { onTriggerKeyDown, onListKeyDown } = dropdownProps
  return (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'Tab') {
      onTriggerKeyDown?.(event as unknown as ReactKeyboardEvent<HTMLButtonElement>)
      onListKeyDown?.(event)
      return
    }

    if (isActivationKey(event.key)) {
      return
    }

    onListKeyDown?.(event)
  }
}

function DropdownOptionItem<TValue extends string>({
  dropdownProps,
  controller,
  option,
  index,
}: DropdownOptionsPanelProps<TValue> & { option: DropdownOption<TValue>; index: number }) {
  const { 'data-testid': dataTestId, renderOptionLabel } = dropdownProps
  const isMultiOption = isMultiSelect(dropdownProps)
  const closeOnSelect = dropdownProps.closeOnSelect ?? !isMultiOption
  const OptionLabel = isMultiOption ? MultiOptionLabel : SingleOptionLabel

  const handleClick = () => {
    const shouldCloseAfterPick = isMultiOption && closeOnSelect
    if (shouldCloseAfterPick) {
      queueMicrotask(controller.closeListbox)
    }
  }

  return (
    <ListboxOption
      as="li"
      id={`${controller.listboxId}-option-${index}`}
      value={option.value}
      disabled={option.disabled}
      aria-label={option.label}
      data-testid={dataTestId ? `${dataTestId}-option-${option.value}` : undefined}
      className={(optionState) => buildOptionClassName(optionState, isMultiOption)}
      onMouseDown={preventFocusSteal}
      onClick={handleClick}
    >
      {({ selected, focus }) => (
        <OptionLabel
          option={option}
          context={{ selected: selected, highlighted: focus }}
          renderOptionLabel={renderOptionLabel}
        />
      )}
    </ListboxOption>
  )
}

export function DropdownOptionsPanel<TValue extends string>({
  dropdownProps,
  controller,
  panelRef,
}: DropdownOptionsPanelProps<TValue> & { panelRef: (node: HTMLUListElement | null) => void }) {
  const { focusListOnOpen = true, labelledBy } = dropdownProps
  const { panelLayout, listboxId } = controller
  const handleKeyDown = useListKeyDown(dropdownProps)

  const handleBlur = (event: React.FocusEvent<HTMLUListElement>) => {
    if (!focusListOnOpen) return
    if (controller.isWithinDropdownTarget(event.relatedTarget)) return
    controller.closeListbox()
  }

  return createPortal(
    <ListboxOptions
      static
      as="ul"
      modal={false}
      ref={panelRef}
      id={listboxId}
      className={buildListboxClassName(panelLayout)}
      aria-labelledby={labelledBy}
      aria-label={listboxAriaLabelFor(dropdownProps)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      data-placement={panelLayout.placement}
      style={buildListboxStyle(panelLayout)}
    >
      {dropdownProps.options.map((option, index) => (
        <DropdownOptionItem
          key={`${option.value}-${index}`}
          dropdownProps={dropdownProps}
          controller={controller}
          option={option}
          index={index}
        />
      ))}
    </ListboxOptions>,
    panelLayout.portalContainer ?? document.body
  )
}
