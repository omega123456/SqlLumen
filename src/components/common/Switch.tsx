import { forwardRef, type InputHTMLAttributes } from 'react'
import styles from './Switch.module.css'

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>

/** Fluent toggle switch with an On/Off caption, on the native checkbox (prototype `.sw-t`). */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { className, checked, ...rest },
  ref
) {
  return (
    <span className={styles.root}>
      <span className={styles.caption} aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        checked={checked}
        className={className ? `${styles.input} ${className}` : styles.input}
        {...rest}
      />
    </span>
  )
})
