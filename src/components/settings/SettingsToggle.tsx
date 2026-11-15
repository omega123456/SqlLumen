import { useId } from 'react'
import { Switch } from '../common/Switch'

export interface SettingsToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  'data-testid'?: string
}

export function SettingsToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
  'data-testid': dataTestId,
}: SettingsToggleProps) {
  const id = useId()

  return (
    <div
      className="flex min-h-17 items-center justify-between gap-4 rounded-card border border-light-stroke-card bg-light-surface-container-high px-4 py-3 dark:border-dark-stroke-card dark:bg-dark-surface-container-high"
      data-testid={dataTestId}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <label
          htmlFor={id}
          className="cursor-default text-body text-light-on-surface dark:text-dark-on-surface"
        >
          {label}
        </label>
        {description && (
          <span className="text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {description}
          </span>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
    </div>
  )
}
