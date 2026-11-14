import { ListboxButton } from '@headlessui/react'
import { CaretDown } from '@phosphor-icons/react'
import { joinClassNames } from '../../../lib/class-names'
import { DropdownChrome } from './DropdownChrome'
import { DropdownOptionsPanel } from './DropdownOptionsPanel'
import type { DropdownController } from './use-dropdown-controller'
import type { DropdownElementRefs } from './DropdownChrome'
import { isMultiSelect, type DropdownProps } from './dropdown-types'

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

  return (
    <ListboxButton
      ref={triggerRef}
      id={id}
      {...triggerRoleProps(dropdownProps)}
      className={joinClassNames(['ui-dropdown__trigger', triggerClassName])}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      aria-controls={controller.listboxId}
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
      <span className="ui-dropdown__value">{controller.selectedLabel}</span>
      <CaretDown
        className="ui-dropdown__chevron"
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
    <div className={joinClassNames(['ui-dropdown', dropdownProps.className])} ref={rootRef}>
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
