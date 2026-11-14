import { forwardRef, type InputHTMLAttributes } from 'react'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'>

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { className, checked, ...rest },
  ref
) {
  return (
    <span className="inline-flex flex-none items-center gap-3">
      <span
        className="min-w-6 text-right text-body text-light-on-surface dark:text-dark-on-surface"
        aria-hidden="true"
      >
        {checked ? 'On' : 'Off'}
      </span>
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        checked={checked}
        className={joinClassNames([
          'relative h-5 w-10 flex-none appearance-none rounded-switch border cursor-default outline-none transition-background duration-120',
          FOCUS_RING,
          'border-light-on-surface-variant dark:border-dark-on-surface-variant bg-light-fill-control dark:bg-dark-fill-control',
          'checked:bg-light-primary dark:checked:bg-dark-primary checked:border-light-primary dark:checked:border-dark-primary',
          'disabled:cursor-not-allowed disabled:bg-transparent disabled:border-light-text-disabled dark:disabled:border-dark-text-disabled checked:disabled:bg-light-text-disabled dark:checked:disabled:bg-dark-text-disabled checked:disabled:border-transparent',
          'after:absolute after:left-0.75 after:top-0.75 after:size-3 after:rounded-round after:transition-left after:duration-120 after:bg-light-on-surface-variant dark:after:bg-dark-on-surface-variant checked:after:left-5.75 checked:after:bg-light-on-primary dark:checked:after:bg-dark-on-primary disabled:after:bg-light-text-disabled dark:disabled:after:bg-dark-text-disabled checked:disabled:after:bg-light-on-primary dark:checked:disabled:after:bg-dark-on-primary',
          className,
        ])}
        {...rest}
      />
    </span>
  )
})
