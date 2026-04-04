import { forwardRef, type InputHTMLAttributes } from 'react'
import styles from './Checkbox.module.css'

function mergeClassNames(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={mergeClassNames(styles.input, className)}
      {...rest}
    />
  )
})
