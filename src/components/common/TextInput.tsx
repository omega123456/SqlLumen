import { forwardRef, type InputHTMLAttributes } from 'react'
import { joinClassNames } from '../../lib/class-names'
import { fieldChromeClassName } from '../../lib/class-names-field'
import { dataFlag } from '../../lib/data-attributes'

export type TextInputVariant = 'default' | 'mono' | 'formField' | 'tableCell' | 'gridCell' | 'bare'

type ChromeVariant = 'default' | 'mono' | 'formField' | 'tableCell'
type UnchromedVariant = 'gridCell' | 'bare'
type PaddingKey = 'standard' | 'passwordToggleGutter'

const CHROME_VARIANT_CLASSES: Record<ChromeVariant, string> = {
  default: 'w-full py-1.25 font-body text-body',
  mono: 'w-full py-1.25 font-mono text-mono',
  formField: 'h-control w-full flex-1 font-mono text-size-mono',
  tableCell: 'h-7.5 w-full text-size-row',
}

const UNCHROMED_VARIANT_CLASSES: Record<UnchromedVariant, string> = {
  gridCell: 'td-cell-editor-input',
  bare: '',
}

const PADDING_X_CLASSES: Record<PaddingKey, string> = {
  standard: 'px-2.5',
  passwordToggleGutter: 'pl-2.5 pr-9',
}

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  variant?: TextInputVariant
  invalid?: boolean
  passwordToggleGutter?: boolean
}

function isUnchromed(variant: TextInputVariant): variant is UnchromedVariant {
  return variant === 'gridCell' || variant === 'bare'
}

function paddingKey(passwordToggleGutter: boolean): PaddingKey {
  if (passwordToggleGutter) return 'passwordToggleGutter'
  return 'standard'
}

interface VariantClassOptions {
  variant: TextInputVariant
  invalid: boolean
  passwordToggleGutter: boolean
}

function variantClassName({ variant, invalid, passwordToggleGutter }: VariantClassOptions): string {
  if (isUnchromed(variant)) return UNCHROMED_VARIANT_CLASSES[variant]
  return joinClassNames([
    fieldChromeClassName(invalid),
    PADDING_X_CLASSES[paddingKey(passwordToggleGutter)],
    CHROME_VARIANT_CLASSES[variant],
  ])
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    variant = 'default',
    invalid = false,
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
      className={joinClassNames([
        variantClassName({ variant, invalid, passwordToggleGutter }),
        className,
      ])}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
    />
  )
})
