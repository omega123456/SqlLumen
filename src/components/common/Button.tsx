import { forwardRef, type ButtonHTMLAttributes } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'test'
  | 'tertiary'
  | 'danger'
  | 'toolbar'
  | 'toolbarDanger'
  | 'ghost'
  | 'rowDelete'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'ui-button-primary',
  secondary: 'ui-button-secondary',
  test: 'ui-button-test',
  tertiary: 'ui-button-tertiary',
  danger: 'ui-button-danger',
  toolbar: 'ui-button-toolbar',
  toolbarDanger: 'ui-button-toolbar ui-button-toolbar--danger',
  ghost: 'ui-button-ghost',
  rowDelete: 'ui-button-row-delete',
}

function mergeClassNames(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={mergeClassNames(VARIANT_CLASS[variant], className)}
      {...rest}
    />
  )
})
