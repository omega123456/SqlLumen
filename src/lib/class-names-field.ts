import { joinClassNames } from './class-names'

export interface FieldValueState {
  modified: boolean
  isNull: boolean
}

export const NEUTRAL_FIELD_VALUE_STATE: FieldValueState = { modified: false, isNull: false }

type FieldEdgeTone = 'valid' | 'invalid' | 'modified'
type FieldTextTone = 'default' | 'null' | 'accent'
export type FieldTextEmphasis = 'standard' | 'accent'
export type FieldFill = 'responsive' | 'steady'

const FIELD_SHAPE = 'rounded-control border appearance-none outline-none'

const FIELD_FILL_CLASSES: Record<FieldFill, string> = {
  responsive:
    'bg-light-fill-control dark:bg-dark-fill-control not-disabled:hover:bg-light-fill-control-hover dark:not-disabled:hover:bg-dark-fill-control-hover focus:bg-light-surface-container-high dark:focus:bg-dark-surface-container-high disabled:bg-light-fill-subtle-pressed dark:disabled:bg-dark-fill-subtle-pressed',
  steady:
    'bg-light-fill-control dark:bg-dark-fill-control disabled:bg-light-fill-subtle-pressed dark:disabled:bg-dark-fill-subtle-pressed',
}

const FIELD_TEXT_CLASSES: Record<FieldTextTone, string> = {
  default:
    'text-light-on-surface dark:text-dark-on-surface disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled placeholder:text-light-outline dark:placeholder:text-dark-outline disabled:cursor-not-allowed',
  accent:
    'text-light-primary dark:text-dark-primary disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled placeholder:text-light-outline dark:placeholder:text-dark-outline disabled:cursor-not-allowed',
  null: 'italic text-light-outline dark:text-dark-outline disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled placeholder:text-light-outline dark:placeholder:text-dark-outline disabled:cursor-not-allowed',
}

const FIELD_SIDE_STROKE =
  'border-x-light-stroke-control dark:border-x-dark-stroke-control border-t-light-stroke-control dark:border-t-dark-stroke-control'

const FIELD_EDGE_CLASSES: Record<FieldEdgeTone, string> = {
  valid: joinClassNames([
    FIELD_SIDE_STROKE,
    'border-b-light-stroke-text-field dark:border-b-dark-stroke-text-field focus:border-b-light-primary dark:focus:border-b-dark-primary disabled:border-b-light-stroke-control dark:disabled:border-b-dark-stroke-control focus:shadow-light-field-focus dark:focus:shadow-dark-field-focus',
  ]),
  invalid: joinClassNames([
    FIELD_SIDE_STROKE,
    'border-b-light-error dark:border-b-dark-error disabled:border-b-light-stroke-control dark:disabled:border-b-dark-stroke-control shadow-light-field-error dark:shadow-dark-field-error',
  ]),
  modified:
    'border-light-primary dark:border-dark-primary focus:shadow-light-field-focus dark:focus:shadow-dark-field-focus',
}

function edgeTone(invalid: boolean, fieldState: FieldValueState): FieldEdgeTone {
  if (invalid) return 'invalid'
  if (fieldState.modified) return 'modified'
  return 'valid'
}

function textTone(fieldState: FieldValueState, emphasis: FieldTextEmphasis): FieldTextTone {
  if (fieldState.isNull) return 'null'
  if (emphasis === 'accent') return 'accent'
  return 'default'
}

export const INVALID_CONTROL_EDGE =
  'border-b-light-error dark:border-b-dark-error shadow-light-field-error dark:shadow-dark-field-error'

export const INVALID_CONTROL_FOCUS_RING =
  'focus-visible:outline-none focus-visible:shadow-light-field-error-focus-ring dark:focus-visible:shadow-dark-field-error-focus-ring'

export interface FieldAppearance {
  invalid?: boolean
  fieldState?: FieldValueState
  emphasis?: FieldTextEmphasis
  fill?: FieldFill
}

export function fieldChromeClassName({
  invalid = false,
  fieldState = NEUTRAL_FIELD_VALUE_STATE,
  emphasis = 'standard',
  fill = 'responsive',
}: FieldAppearance = {}): string {
  return joinClassNames([
    FIELD_SHAPE,
    FIELD_FILL_CLASSES[fill],
    FIELD_TEXT_CLASSES[textTone(fieldState, emphasis)],
    FIELD_EDGE_CLASSES[edgeTone(invalid, fieldState)],
  ])
}

export const FIELD_CHROME = fieldChromeClassName()
