import { joinClassNames } from './class-names'

const FIELD_FRAME =
  'rounded-control border appearance-none outline-none border-x-light-stroke-control dark:border-x-dark-stroke-control border-t-light-stroke-control dark:border-t-dark-stroke-control'

const FIELD_FILL =
  'bg-light-fill-control dark:bg-dark-fill-control not-disabled:hover:bg-light-fill-control-hover dark:not-disabled:hover:bg-dark-fill-control-hover focus:bg-light-surface-container-high dark:focus:bg-dark-surface-container-high disabled:bg-light-fill-subtle-pressed dark:disabled:bg-dark-fill-subtle-pressed'

const FIELD_TEXT =
  'text-light-on-surface dark:text-dark-on-surface disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled placeholder:text-light-outline dark:placeholder:text-dark-outline disabled:cursor-not-allowed'

const FIELD_EDGE_VALID =
  'border-b-light-stroke-text-field dark:border-b-dark-stroke-text-field focus:border-b-light-primary dark:focus:border-b-dark-primary disabled:border-b-light-stroke-control dark:disabled:border-b-dark-stroke-control focus:shadow-light-field-focus dark:focus:shadow-dark-field-focus'

const FIELD_EDGE_INVALID =
  'border-b-light-error dark:border-b-dark-error disabled:border-b-light-stroke-control dark:disabled:border-b-dark-stroke-control shadow-light-field-error dark:shadow-dark-field-error'

export const FIELD_CHROME = joinClassNames([FIELD_FRAME, FIELD_FILL, FIELD_TEXT, FIELD_EDGE_VALID])

const INVALID_FIELD_CHROME = joinClassNames([
  FIELD_FRAME,
  FIELD_FILL,
  FIELD_TEXT,
  FIELD_EDGE_INVALID,
])

export function fieldChromeClassName(invalid: boolean): string {
  if (invalid) return INVALID_FIELD_CHROME
  return FIELD_CHROME
}
