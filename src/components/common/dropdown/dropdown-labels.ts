import type { ReactNode, Ref } from 'react'
import {
  isMultiSelect,
  type CommonDropdownProps,
  type DropdownOption,
  type DropdownProps,
  type MultiSelectDropdownProps,
} from './dropdown-types'

function indexOfValue(options: DropdownOption[], value: string): number {
  return options.findIndex((option) => option.value === value)
}

function selectedValues<TValue extends string>(props: DropdownProps<TValue>): TValue[] {
  if (isMultiSelect(props)) return props.value
  return [props.value]
}

export function selectedOptionsOf<TValue extends string>(
  props: DropdownProps<TValue>
): DropdownOption<TValue>[] {
  return selectedValues(props)
    .map((selectedValue) => indexOfValue(props.options, selectedValue))
    .filter((index) => index >= 0)
    .map((index) => props.options[index])
    .filter(Boolean)
}

export function assignForwardedRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === 'function') {
    ref(node)
    return
  }
  if (ref) {
    ref.current = node
  }
}

function selectedValueText<TValue extends string>(props: DropdownProps<TValue>): string {
  if (isMultiSelect(props)) return props.value.join(', ')
  return props.value
}

function fallbackTriggerLabel<TValue extends string>(props: DropdownProps<TValue>): string {
  const selectedText = selectedValueText(props)
  if (selectedText) return selectedText
  return props.placeholder ?? props.options[0]?.label ?? ''
}

function multiSelectTriggerLabel<TValue extends string>(
  props: MultiSelectDropdownProps<TValue>
): string {
  return props.value
    .map((value) => props.options.find((option) => option.value === value)?.label ?? value)
    .join(', ')
}

export function resolveSelectedLabel<TValue extends string>(
  props: DropdownProps<TValue>,
  selectedOptions: DropdownOption<TValue>[]
): ReactNode {
  if (props.renderTriggerValue) return props.renderTriggerValue(selectedOptions)
  if (selectedOptions.length === 0) return fallbackTriggerLabel(props)
  if (isMultiSelect(props)) return multiSelectTriggerLabel(props)
  return selectedOptions[0]?.label ?? props.placeholder ?? props.options[0]?.label ?? ''
}

export function applyTriggerLabel(
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

export function listboxAriaLabelFor<TValue extends string>(
  props: CommonDropdownProps<TValue>
): string | undefined {
  if (props.listAriaLabel !== undefined) return props.listAriaLabel
  if (props.labelledBy) return undefined
  if (!props.ariaLabel) return undefined
  return props.ariaLabel
}
