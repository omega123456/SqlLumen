import type { ReactNode } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'

const SETTINGS_FIELD_LABEL_STYLE = {
  display: 'block',
  marginBottom: 6,
  fontSize: 'var(--type-size-sm)',
} as const

export interface SettingsFieldLabelProps {
  id?: string
  htmlFor?: string
  children: ReactNode
}

export function SettingsFieldLabel({ id, htmlFor, children }: SettingsFieldLabelProps) {
  return (
    <label id={id} htmlFor={htmlFor} style={SETTINGS_FIELD_LABEL_STYLE}>
      {children}
    </label>
  )
}

export interface SettingsDropdownFieldProps {
  name: string
  label: ReactNode
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function SettingsDropdownField({
  name,
  label,
  options,
  value,
  onChange,
  disabled,
}: SettingsDropdownFieldProps) {
  const labelId = `${name}-label`
  return (
    <div>
      <SettingsFieldLabel id={labelId}>{label}</SettingsFieldLabel>
      <Dropdown
        id={`settings-${name}`}
        labelledBy={labelId}
        options={options}
        value={value}
        onChange={onChange}
        disabled={disabled}
        data-testid={`settings-${name}-dropdown`}
      />
    </div>
  )
}
