import { forwardRef, type InputHTMLAttributes } from 'react'
import { joinClassNames } from '../../lib/class-names'
import {
  fieldChromeClassName,
  NEUTRAL_FIELD_VALUE_STATE,
  type FieldValueState,
} from '../../lib/class-names-field'
import { dataFlag } from '../../lib/data-attributes'

export type TextInputVariant =
  'default' | 'mono' | 'formField' | 'tableCell' | 'search' | 'gridCell' | 'bare'

type ChromeVariant = 'default' | 'mono' | 'formField' | 'tableCell' | 'search'
type UnchromedVariant = 'gridCell' | 'bare'
type PaddingKey = 'standard' | 'passwordToggleGutter' | 'searchIconGutters'

const CHROME_VARIANT_CLASSES: Record<ChromeVariant, string> = {
  default: 'w-full py-1.25 font-body text-body',
  mono: 'w-full py-1.25 font-mono text-mono',
  formField: 'h-control w-full flex-1 font-mono text-size-mono',
  tableCell: 'h-7.5 w-full text-size-row',
  search: 'h-control w-full font-body text-body',
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
}

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  variant?: TextInputVariant
  invalid?: boolean
  fieldState?: FieldValueState
  passwordToggleGutter?: boolean
}

function isUnchromed(variant: TextInputVariant): variant is UnchromedVariant {
  return variant === 'gridCell' || variant === 'bare'
}

function paddingKey(variant: TextInputVariant, passwordToggleGutter: boolean): PaddingKey {
  if (variant === 'search') return 'searchIconGutters'
  if (passwordToggleGutter) return 'passwordToggleGutter'
  return 'standard'
}

interface VariantClassOptions {
  variant: TextInputVariant
  invalid: boolean
  fieldState: FieldValueState
  passwordToggleGutter: boolean
}

function variantClassName({
  variant,
  invalid,
  fieldState,
  passwordToggleGutter,
}: VariantClassOptions): string {
  if (isUnchromed(variant)) return UNCHROMED_VARIANT_CLASSES[variant]
  return joinClassNames([
    fieldChromeClassName(invalid, fieldState),
    PADDING_X_CLASSES[paddingKey(variant, passwordToggleGutter)],
    CHROME_VARIANT_CLASSES[variant],
  ])
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    variant = 'default',
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
        variantClassName({ variant, invalid, fieldState, passwordToggleGutter }),
        className,
      ])}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
    />
  )
})
