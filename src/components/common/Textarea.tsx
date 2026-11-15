import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { joinClassNames } from '../../lib/class-names'
import { fieldChromeClassName } from '../../lib/class-names-field'
import { dataFlag } from '../../lib/data-attributes'

export type TextareaVariant =
  'default' | 'mono' | 'formField' | 'verticalResize' | 'fixedSize' | 'bare'

type ChromeVariant = Exclude<TextareaVariant, 'bare'>

const CHROME_VARIANT_CLASSES: Record<ChromeVariant, string> = {
  default: 'w-full px-2.5 py-1.25 resize font-body text-body',
  mono: 'w-full px-2.5 py-1.25 resize font-mono text-mono',
  formField: 'w-full flex-1 min-h-18 px-2.5 py-1.25 resize-y font-mono text-mono',
  verticalResize: 'w-full min-h-12 px-2.5 py-1.25 resize-y font-body text-body',
  fixedSize: 'w-full px-2.5 py-1.25 resize-none font-body text-body',
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  variant?: TextareaVariant
  invalid?: boolean
}

function variantClassName(variant: TextareaVariant, invalid: boolean): string {
  if (variant === 'bare') return ''
  return joinClassNames([fieldChromeClassName({ invalid }), CHROME_VARIANT_CLASSES[variant]])
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { variant = 'default', invalid = false, className, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      data-variant={variant}
      data-invalid={dataFlag(invalid)}
      className={joinClassNames([variantClassName(variant, invalid), className])}
      autoCapitalize="none"
      autoCorrect="off"
      {...rest}
    />
  )
})
