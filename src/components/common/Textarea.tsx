import { forwardRef, type TextareaHTMLAttributes } from 'react'
import styles from './Textarea.module.css'

function mergeClassNames(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type TextareaVariant = 'default' | 'mono' | 'formField' | 'bare'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  variant?: TextareaVariant
  invalid?: boolean
}

const VARIANT_CLASSES: Record<TextareaVariant, string> = {
  default: 'ui-textarea',
  mono: mergeClassNames('ui-textarea', styles.mono),
  formField: mergeClassNames('ui-field-chrome', styles.formField),
  bare: '',
}

function variantClasses(variant: TextareaVariant): string {
  return VARIANT_CLASSES[variant]
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { variant = 'default', invalid, className, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={mergeClassNames(variantClasses(variant), invalid && styles.invalid, className)}
      autoCapitalize="none"
      autoCorrect="off"
      {...rest}
    />
  )
})
