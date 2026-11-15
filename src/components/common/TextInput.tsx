import { forwardRef, type InputHTMLAttributes } from 'react'
import { joinClassNames } from '../../lib/class-names'
import {
  fieldChromeClassName,
  NEUTRAL_FIELD_VALUE_STATE,
  type FieldFill,
  type FieldTextEmphasis,
  type FieldValueState,
} from '../../lib/class-names-field'
import { dataFlag } from '../../lib/data-attributes'

export type TextInputVariant =
  | 'default'
  | 'mono'
  | 'formField'
  | 'tableCell'
  | 'search'
  | 'listSearch'
  | 'iconLeading'
  | 'accentName'
  | 'gridCell'
  | 'bare'

type ChromeVariant =
  | 'default'
  | 'mono'
  | 'formField'
  | 'tableCell'
  | 'search'
  | 'listSearch'
  | 'iconLeading'
  | 'accentName'
type UnchromedVariant = 'gridCell' | 'bare'
type PaddingKey =
  | 'standard'
  | 'passwordToggleGutter'
  | 'searchIconGutters'
  | 'listSearchGutters'
  | 'leadingIconGutter'

const CHROME_VARIANT_CLASSES: Record<ChromeVariant, string> = {
  default: 'py-1.25 font-body text-body',
  mono: 'py-1.25 font-mono text-mono',
  formField: 'h-control flex-1 font-mono text-size-mono',
  tableCell: 'h-7.5 text-size-row',
  search: 'h-control font-body text-body',
  listSearch: 'h-control py-0 font-body text-body',
  iconLeading: 'h-control py-1.25 font-body text-body',
  accentName: 'h-control max-w-105 my-1 font-body text-body font-semibold',
}

export type TextInputWidth = 'fill' | 'narrow' | 'medium' | 'wide'

const WIDTH_CLASSES: Record<TextInputWidth, string> = {
  fill: 'w-full',
  narrow: 'w-30',
  medium: 'w-50',
  wide: 'w-90',
}

const UNCHROMED_VARIANT_CLASSES: Record<UnchromedVariant, string> = {
  gridCell:
    'grow shrink basis-0 w-full max-w-full min-w-0 h-full min-h-5.5 px-1 py-0.5 border-none bg-transparent outline-none font-mono text-size-mono leading-tight text-light-on-surface dark:text-dark-on-surface disabled:italic disabled:text-light-outline dark:disabled:text-dark-outline',
  bare: '',
}

const PADDING_X_CLASSES: Record<PaddingKey, string> = {
  standard: 'px-2.5',
  passwordToggleGutter: 'pl-2.5 pr-9',
  searchIconGutters: 'pl-8.5 pr-8',
  listSearchGutters: 'pl-8.5 pr-2.5 not-placeholder-shown:pr-7.5',
  leadingIconGutter: 'pl-8.5 pr-2.5',
}

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  variant?: TextInputVariant
  fieldWidth?: TextInputWidth
  invalid?: boolean
  fieldState?: FieldValueState
  passwordToggleGutter?: boolean
}

function isUnchromed(variant: TextInputVariant): variant is UnchromedVariant {
  return variant === 'gridCell' || variant === 'bare'
}

function fieldEmphasis(variant: TextInputVariant): FieldTextEmphasis {
  if (variant === 'accentName') return 'accent'
  return 'standard'
}

function fieldFill(variant: TextInputVariant): FieldFill {
  if (variant === 'tableCell') return 'steady'
  return 'responsive'
}

function paddingKey(variant: TextInputVariant, passwordToggleGutter: boolean): PaddingKey {
  if (variant === 'search') return 'searchIconGutters'
  if (variant === 'listSearch') return 'listSearchGutters'
  if (variant === 'iconLeading') return 'leadingIconGutter'
  if (passwordToggleGutter) return 'passwordToggleGutter'
  return 'standard'
}

interface VariantClassOptions {
  variant: TextInputVariant
  fieldWidth: TextInputWidth
  invalid: boolean
  fieldState: FieldValueState
  passwordToggleGutter: boolean
}

function variantClassName({
  variant,
  fieldWidth,
  invalid,
  fieldState,
  passwordToggleGutter,
}: VariantClassOptions): string {
  if (isUnchromed(variant)) return UNCHROMED_VARIANT_CLASSES[variant]
  return joinClassNames([
    fieldChromeClassName({
      invalid: invalid,
      fieldState: fieldState,
      emphasis: fieldEmphasis(variant),
      fill: fieldFill(variant),
    }),
    PADDING_X_CLASSES[paddingKey(variant, passwordToggleGutter)],
    WIDTH_CLASSES[fieldWidth],
    CHROME_VARIANT_CLASSES[variant],
  ])
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    variant = 'default',
    fieldWidth = 'fill',
    invalid = false,
    fieldState = NEUTRAL_FIELD_VALUE_STATE,
    passwordToggleGutter = false,
    className,
    autoCapitalize = 'none',
    autoCorrect = 'off',
    ...rest
  },
  ref
) {
  return (
    <input
      ref={ref}
      {...rest}
      data-variant={variant}
      data-invalid={dataFlag(invalid)}
      data-modified={dataFlag(fieldState.modified)}
      data-null={dataFlag(fieldState.isNull)}
      className={joinClassNames([
        variantClassName({ variant, fieldWidth, invalid, fieldState, passwordToggleGutter }),
        className,
      ])}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
    />
  )
})
