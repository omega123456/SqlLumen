import type {
  ButtonHTMLAttributes,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
} from 'react'
import type { IconWeight } from '@phosphor-icons/react'
import type { FieldValueState } from '../../../lib/class-names-field'

export interface DropdownOption<TValue extends string = string> {
  value: TValue
  label: string
  description?: string
  disabled?: boolean
}

export type DropdownPlacement = 'top' | 'bottom'

export type DropdownTriggerSize = 'md' | 'sm'

export type DropdownTriggerWidth = 'fill' | 'auto' | 'combo'

export type DropdownTriggerChrome = 'field' | 'gridCell' | 'gridCellOverlay'

export type DropdownFieldState = FieldValueState

export interface DropdownTriggerAppearance {
  size: DropdownTriggerSize
  width: DropdownTriggerWidth
  chrome: DropdownTriggerChrome
  fieldState: DropdownFieldState
}

export type DropdownFixedLayout = {
  left: number
  width: number
  top: number | null
  bottom: number | null
}

export type DropdownRenderContext = {
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

export type CommonDropdownProps<TValue extends string = string> = DropdownLabelProps & {
  id: string
  options: DropdownOption<TValue>[]
  disabled?: boolean
  'data-testid'?: string
  className?: string
  triggerClassName?: string
  triggerSize?: DropdownTriggerSize
  triggerWidth?: DropdownTriggerWidth
  triggerChrome?: DropdownTriggerChrome
  fieldState?: DropdownFieldState
  onTriggerKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onListKeyDown?: (event: ReactKeyboardEvent<HTMLUListElement>) => void
  onOpenChange?: (open: boolean) => void
  onTriggerFocus?: (event: ReactFocusEvent<HTMLButtonElement>) => void
  onTriggerBlur?: (event: ReactFocusEvent<HTMLButtonElement>) => void
  triggerProps?: DropdownTriggerProps
  closeOnSelect?: boolean
  focusListOnOpen?: boolean
  placeholder?: string
  listAriaLabel?: string
  renderTriggerValue?: (selectedOptions: DropdownOption<TValue>[]) => ReactNode
  renderOptionLabel?: (option: DropdownOption<TValue>, context: DropdownRenderContext) => ReactNode
  workspaceTabId?: string
  chevronSize?: number
  chevronWeight?: IconWeight
  minPanelWidth?: number
}

type SingleSelectDropdownProps<TValue extends string> = CommonDropdownProps<TValue> & {
  multiple?: false
  value: TValue
  onChange: (value: TValue) => void
}

export type MultiSelectDropdownProps<TValue extends string> = CommonDropdownProps<TValue> & {
  multiple: true
  value: TValue[]
  onChange: (value: TValue[]) => void
}

export type DropdownProps<TValue extends string = string> =
  SingleSelectDropdownProps<TValue> | MultiSelectDropdownProps<TValue>

export type DropdownComponentProps<TValue extends string> = DropdownProps<TValue> & {
  ref?: Ref<HTMLButtonElement>
}

export function isMultiSelect<TValue extends string>(
  props: DropdownProps<TValue>
): props is MultiSelectDropdownProps<TValue> {
  return props.multiple === true
}
