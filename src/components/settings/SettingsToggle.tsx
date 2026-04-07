import { useId } from 'react'
import { Checkbox } from '../common/Checkbox'
import styles from './SettingsToggle.module.css'

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
    <div className={styles.toggle} data-testid={dataTestId}>
      <div className={styles.labelGroup}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {description && <span className={styles.description}>{description}</span>}
      </div>
      <Checkbox
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
    </div>
  )
}
