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

function variantClasses(variant: TextareaVariant): string {
  switch (variant) {
    case 'default': {
      return 'ui-textarea'
    }
    case 'mono': {
      return mergeClassNames('ui-textarea', styles.mono)
    }
    case 'formField': {
      return styles.formField
    }
    case 'bare': {
      return ''
    }
  }
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { variant = 'default', invalid, className, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={mergeClassNames(variantClasses(variant), invalid && styles.invalid, className)}
      {...rest}
    />
  )
})
