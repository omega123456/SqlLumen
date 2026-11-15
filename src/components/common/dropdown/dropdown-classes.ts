import { joinClassNames, SCROLLBAR } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import {
  INVALID_CONTROL_EDGE,
  INVALID_CONTROL_FOCUS_RING,
  NEUTRAL_FIELD_VALUE_STATE,
} from '../../../lib/class-names-field'
import {
  gridCellOverlayTriggerClassName,
  gridCellTriggerClassName,
} from './dropdown-grid-cell-classes'
import type {
  CommonDropdownProps,
  DropdownFieldState,
  DropdownPlacement,
  DropdownTriggerAppearance,
  DropdownTriggerChrome,
  DropdownTriggerSize,
  DropdownTriggerWidth,
} from './dropdown-types'

type TriggerBorderTone = 'default' | 'modified' | 'invalid'
type TriggerFocus = 'ring' | 'ringOverErrorEdge'
type TriggerDisabledLook = 'blocked' | 'waiting'
type TriggerTextTone = 'default' | 'null'
type TriggerFill = 'closed' | 'open'
type OptionFill = 'idle' | 'highlighted' | 'selected' | 'disabled'
type PanelPosition = 'viewport' | 'dialog'

const TRIGGER_SIZE_CLASSES: Record<DropdownTriggerSize, string> = {
  md: 'h-control pr-2 pl-2.5 font-body text-body',
  sm: 'h-control-sm pr-2 pl-2.5 font-body text-size-row leading-5',
  cell: 'h-7.5 pr-2 pl-2.5 font-body text-size-row leading-5',
  monoCell: 'h-control px-2 py-1.75 font-mono text-size-caption leading-5 transition-bg-and-color',
  field: 'h-control min-h-10 px-3 py-2.5 font-body text-size-caption leading-5',
  filter: 'h-8.5 px-2.5 font-body text-size-caption leading-5',
}

const TRIGGER_CURSOR_CLASSES: Record<DropdownTriggerSize, string> = {
  md: 'cursor-default',
  sm: 'cursor-default',
  cell: 'cursor-default',
  monoCell: 'cursor-default',
  field: 'cursor-default',
  filter: 'cursor-pointer',
}

const TRIGGER_WIDTH_CLASSES: Record<DropdownTriggerWidth, string> = {
  fill: 'w-full',
  auto: 'w-auto',
  combo: 'w-21',
}

const TRIGGER_FILL_CLASSES: Record<TriggerFill, string> = {
  closed:
    'bg-light-fill-control dark:bg-dark-fill-control not-disabled:hover:bg-light-fill-control-hover dark:not-disabled:hover:bg-dark-fill-control-hover disabled:bg-light-fill-subtle-pressed dark:disabled:bg-dark-fill-subtle-pressed',
  open: 'bg-light-fill-control-pressed dark:bg-dark-fill-control-pressed not-disabled:hover:bg-light-fill-control-hover dark:not-disabled:hover:bg-dark-fill-control-hover disabled:bg-light-fill-subtle-pressed dark:disabled:bg-dark-fill-subtle-pressed',
}

const TRIGGER_BORDER_CLASSES: Record<TriggerBorderTone, string> = {
  default:
    'border-x-light-stroke-control dark:border-x-dark-stroke-control border-t-light-stroke-control dark:border-t-dark-stroke-control border-b-light-stroke-control-bottom dark:border-b-dark-stroke-control-bottom disabled:border-light-stroke-control dark:disabled:border-dark-stroke-control',
  modified: 'border-light-primary dark:border-dark-primary',
  invalid: joinClassNames([
    'border-x-light-stroke-control dark:border-x-dark-stroke-control border-t-light-stroke-control dark:border-t-dark-stroke-control disabled:border-light-stroke-control dark:disabled:border-dark-stroke-control',
    INVALID_CONTROL_EDGE,
  ]),
}

const TRIGGER_FOCUS_CLASSES: Record<TriggerFocus, string> = {
  ring: FOCUS_RING,
  ringOverErrorEdge: INVALID_CONTROL_FOCUS_RING,
}

const TRIGGER_DISABLED_LOOK_CLASSES: Record<TriggerDisabledLook, string> = {
  blocked: 'disabled:cursor-not-allowed',
  waiting: 'disabled:cursor-wait disabled:opacity-70',
}

const TRIGGER_TEXT_CLASSES: Record<TriggerTextTone, string> = {
  default:
    'text-light-on-surface dark:text-dark-on-surface disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled',
  null: 'italic text-light-outline dark:text-dark-outline disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled',
}

const OPTION_FILL_CLASSES: Record<OptionFill, string> = {
  idle: 'bg-transparent hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover text-light-on-surface dark:text-dark-on-surface cursor-default',
  highlighted:
    'bg-light-fill-subtle-hover dark:bg-dark-fill-subtle-hover text-light-on-surface dark:text-dark-on-surface cursor-default',
  selected:
    'bg-light-fill-neutral-selected dark:bg-dark-fill-neutral-selected hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover text-light-on-surface dark:text-dark-on-surface cursor-default',
  disabled:
    'bg-transparent text-light-text-disabled dark:text-dark-text-disabled cursor-not-allowed',
}

const PANEL_POSITION_CLASSES: Record<PanelPosition, string> = {
  viewport: 'fixed',
  dialog: 'absolute',
}

function triggerBorderTone(appearance: DropdownTriggerAppearance): TriggerBorderTone {
  if (appearance.invalid) return 'invalid'
  if (appearance.fieldState.modified) return 'modified'
  return 'default'
}

function triggerFocus(appearance: DropdownTriggerAppearance): TriggerFocus {
  if (appearance.invalid) return 'ringOverErrorEdge'
  return 'ring'
}

function triggerDisabledLook(appearance: DropdownTriggerAppearance): TriggerDisabledLook {
  if (appearance.waiting) return 'waiting'
  return 'blocked'
}

function triggerTextTone(fieldState: DropdownFieldState): TriggerTextTone {
  if (fieldState.isNull) return 'null'
  return 'default'
}

function triggerFill(isOpen: boolean): TriggerFill {
  if (isOpen) return 'open'
  return 'closed'
}

function optionFill(selected: boolean, focus: boolean, disabled: boolean): OptionFill {
  if (disabled) return 'disabled'
  if (selected) return 'selected'
  if (focus) return 'highlighted'
  return 'idle'
}

function panelPosition(isPortalInDialog: boolean): PanelPosition {
  if (isPortalInDialog) return 'dialog'
  return 'viewport'
}

export function triggerAppearanceOf<TValue extends string>(
  props: CommonDropdownProps<TValue>
): DropdownTriggerAppearance {
  return {
    size: props.triggerSize ?? 'md',
    width: props.triggerWidth ?? 'fill',
    chrome: props.triggerChrome ?? 'field',
    fieldState: props.fieldState ?? NEUTRAL_FIELD_VALUE_STATE,
    invalid: props.invalid ?? false,
    waiting: props.waiting ?? false,
  }
}

export interface DropdownTriggerClassOptions {
  open: boolean
  appearance: DropdownTriggerAppearance
  placement: DropdownPlacement | undefined
  className: string | undefined
}

const TRIGGER_FRAME = 'group flex items-center justify-between gap-2 whitespace-nowrap text-left'

function fieldTriggerClassName({ open, appearance }: DropdownTriggerClassOptions): string {
  return joinClassNames([
    'rounded-control border font-regular',
    TRIGGER_FOCUS_CLASSES[triggerFocus(appearance)],
    TRIGGER_FILL_CLASSES[triggerFill(open)],
    TRIGGER_SIZE_CLASSES[appearance.size],
    TRIGGER_WIDTH_CLASSES[appearance.width],
    TRIGGER_BORDER_CLASSES[triggerBorderTone(appearance)],
    TRIGGER_TEXT_CLASSES[triggerTextTone(appearance.fieldState)],
  ])
}

function dialogFieldTriggerClassName({ appearance }: DropdownTriggerClassOptions): string {
  return joinClassNames([
    'h-control w-full rounded-control border border-light-stroke-control bg-light-fill-control px-2.5 py-1.25 font-body text-body font-regular dark:border-dark-stroke-control dark:bg-dark-fill-control',
    FOCUS_RING,
    TRIGGER_TEXT_CLASSES[triggerTextTone(appearance.fieldState)],
  ])
}

const TRIGGER_CHROME_CLASS_BUILDERS: Record<
  DropdownTriggerChrome,
  (options: DropdownTriggerClassOptions) => string
> = {
  field: fieldTriggerClassName,
  dialogField: dialogFieldTriggerClassName,
  gridCell: () => gridCellTriggerClassName(),
  gridCellOverlay: ({ open, placement }) => gridCellOverlayTriggerClassName(open, placement),
}

export function dropdownTriggerClassName(options: DropdownTriggerClassOptions): string {
  return joinClassNames([
    TRIGGER_FRAME,
    TRIGGER_CURSOR_CLASSES[options.appearance.size],
    TRIGGER_DISABLED_LOOK_CLASSES[triggerDisabledLook(options.appearance)],
    TRIGGER_CHROME_CLASS_BUILDERS[options.appearance.chrome](options),
    options.className,
  ])
}

export interface DropdownOptionClassState {
  selected: boolean
  focus: boolean
  disabled: boolean
}

export function dropdownOptionClassName(
  optionState: DropdownOptionClassState,
  isMultiOption: boolean
): string {
  const { selected, focus, disabled } = optionState
  const showsSelectionPill = selected && !isMultiOption
  return joinClassNames([
    'relative flex flex-none flex-col items-stretch justify-center gap-0.5 w-full min-h-menu-item px-2.5 rounded-control font-body text-body font-regular whitespace-nowrap text-left outline-none focus-visible:shadow-none',
    OPTION_FILL_CLASSES[optionFill(selected, focus, disabled)],
    showsSelectionPill
      ? 'before:absolute before:left-0 before:top-1/2 before:-mt-2 before:h-4 before:w-0.75 before:rounded-track before:bg-light-primary dark:before:bg-dark-primary'
      : undefined,
  ])
}

export function dropdownPanelClassName(isPortalInDialog: boolean): string {
  return joinClassNames([
    PANEL_POSITION_CLASSES[panelPosition(isPortalInDialog)],
    'z-10040 flex flex-col p-1 list-none rounded-overlay border border-light-stroke-flyout dark:border-dark-stroke-flyout bg-light-surface-container-high dark:bg-dark-surface-container-high shadow-light-flyout dark:shadow-dark-flyout outline-none overflow-x-hidden overflow-y-auto',
    SCROLLBAR,
  ])
}
