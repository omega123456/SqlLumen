import { forwardRef, type InputHTMLAttributes } from 'react'
import styles from './TextInput.module.css'

function mergeClassNames(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type TextInputVariant =
  | 'default'
  | 'mono'
  | 'formField'
  | 'tableCell'
  | 'gridCell'
  | 'bare'

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  variant?: TextInputVariant
  invalid?: boolean
  /** Extra right padding when a password visibility toggle overlaps the field */
  passwordToggleGutter?: boolean
}

function variantClasses(variant: TextInputVariant): string {
  switch (variant) {
    case 'default': {
      return 'ui-input'
    }
    case 'mono': {
      return mergeClassNames('ui-input', styles.mono)
    }
    case 'formField': {
      return styles.formField
    }
    case 'tableCell': {
      return styles.tableCell
    }
    case 'gridCell': {
      return 'td-cell-editor-input'
    }
    case 'bare': {
      return ''
    }
  }
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { variant = 'default', invalid, passwordToggleGutter, className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={mergeClassNames(
        variantClasses(variant),
        invalid && styles.invalid,
        passwordToggleGutter && styles.passwordToggleGutter,
        className
      )}
      {...rest}
    />
  )
})
