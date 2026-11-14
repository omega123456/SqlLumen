import { forwardRef, type InputHTMLAttributes } from 'react'
import styles from './TextInput.module.css'

function mergeClassNames(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type TextInputVariant = 'default' | 'mono' | 'formField' | 'tableCell' | 'gridCell' | 'bare'

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  variant?: TextInputVariant
  invalid?: boolean
  passwordToggleGutter?: boolean
}

const VARIANT_CLASSES: Record<TextInputVariant, string> = {
  default: 'ui-input',
  mono: mergeClassNames('ui-input', styles.mono),
  formField: mergeClassNames('ui-field-chrome', styles.formField),
  tableCell: mergeClassNames('ui-field-chrome', styles.tableCell),
  gridCell: 'td-cell-editor-input',
  bare: '',
}

function variantClasses(variant: TextInputVariant): string {
  return VARIANT_CLASSES[variant]
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    variant = 'default',
    invalid,
    passwordToggleGutter,
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
      className={mergeClassNames(
        variantClasses(variant),
        invalid && styles.invalid,
        passwordToggleGutter && styles.passwordToggleGutter,
        className
      )}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
    />
  )
})
