import { ListboxButton } from '@headlessui/react'
import { CaretDown } from '@phosphor-icons/react'
import { joinClassNames } from '../../../lib/class-names'
import { dataFlag } from '../../../lib/data-attributes'
import {
  dropdownRootWidthClassName,
  dropdownTriggerClassName,
  triggerAppearanceOf,
} from './dropdown-classes'
import { DropdownChrome } from './DropdownChrome'
import { DropdownOptionsPanel } from './DropdownOptionsPanel'
import type { DropdownController } from './use-dropdown-controller'
import type { DropdownElementRefs } from './DropdownChrome'
import { isMultiSelect, type DropdownProps, type DropdownTriggerAppearance } from './dropdown-types'

const DEFAULT_CHEVRON_SIZE = 16

interface DropdownBodyProps<TValue extends string> {
  open: boolean
  dropdownProps: DropdownProps<TValue>
  controller: DropdownController
  elements: DropdownElementRefs
}

function triggerRoleProps<TValue extends string>(dropdownProps: DropdownProps<TValue>) {
  if (isMultiSelect(dropdownProps)) return {}
  return { role: 'combobox' }
}

interface DropdownTriggerProps<TValue extends string> {
  open: boolean
  dropdownProps: DropdownProps<TValue>
  controller: DropdownController
  triggerRef: (node: HTMLButtonElement | null) => void
}

function triggerStateAttributes(appearance: DropdownTriggerAppearance) {
  return {
    'data-size': appearance.size,
    'data-width': appearance.width,
    'data-chrome': appearance.chrome,
    'data-modified': dataFlag(appearance.fieldState.modified),
    'data-null': dataFlag(appearance.fieldState.isNull),
    'data-invalid': dataFlag(appearance.invalid),
    'data-waiting': dataFlag(appearance.waiting),
  }
}

function DropdownTrigger<TValue extends string>({
  open,
  dropdownProps,
  controller,
  triggerRef,
}: DropdownTriggerProps<TValue>) {
  const {
    id,
    labelledBy,
    ariaLabel,
    'data-testid': dataTestId,
    triggerClassName,
    triggerProps,
    chevronSize = DEFAULT_CHEVRON_SIZE,
    chevronWeight = 'bold',
  } = dropdownProps
  const { onClick: triggerOnClick, ...triggerRest } = triggerProps ?? {}
  const appearance = triggerAppearanceOf(dropdownProps)

  return (
    <ListboxButton
      ref={triggerRef}
      id={id}
      {...triggerRoleProps(dropdownProps)}
      className={dropdownTriggerClassName({
        open: open,
        appearance: appearance,
        placement: controller.panelLayout.placement,
        className: triggerClassName,
      })}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      aria-controls={controller.listboxId}
      {...triggerStateAttributes(appearance)}
      data-panel-placement={open ? controller.panelLayout.placement : undefined}
      data-testid={dataTestId}
      {...triggerRest}
      onClick={(event) => {
        triggerOnClick?.(event)
      }}
      onFocus={dropdownProps.onTriggerFocus}
      onBlur={(event) => controller.handleTriggerBlur(event, open)}
      onKeyDown={dropdownProps.onTriggerKeyDown}
    >
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {controller.selectedLabel}
      </span>
      <CaretDown
        className="shrink-0 text-light-on-surface-variant dark:text-dark-on-surface-variant group-disabled:text-light-text-disabled dark:group-disabled:text-dark-text-disabled"
        size={chevronSize}
        weight={chevronWeight}
        aria-hidden
      />
    </ListboxButton>
  )
}

export function DropdownBody<TValue extends string>({
  open,
  dropdownProps,
  controller,
  elements,
}: DropdownBodyProps<TValue>) {
  const { rootRef } = elements
  return (
    <div
      className={joinClassNames([
        'relative',
        dropdownRootWidthClassName(dropdownProps.triggerWidth),
        dropdownProps.className,
      ])}
      ref={rootRef}
    >
      <DropdownChrome
        open={open}
        optionCount={dropdownProps.options.length}
        elements={elements}
        workspaceTabId={dropdownProps.workspaceTabId}
        focusListOnOpen={dropdownProps.focusListOnOpen ?? true}
        onOpenChange={dropdownProps.onOpenChange}
        closeListbox={controller.closeListbox}
        updatePlacement={controller.updatePlacement}
      />
      <DropdownTrigger
        open={open}
        dropdownProps={dropdownProps}
        controller={controller}
        triggerRef={controller.attach.trigger}
      />
      {open ? (
        <DropdownOptionsPanel
          dropdownProps={dropdownProps}
          controller={controller}
          panelRef={controller.attach.panel}
        />
      ) : null}
    </div>
  )
}
