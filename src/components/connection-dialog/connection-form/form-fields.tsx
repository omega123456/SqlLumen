import type { ReactNode } from 'react'
import { Eye, EyeSlash, FolderOpen } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { TextInput } from '../../common/TextInput'
import { IconButton } from '../../common/IconButton'
import { Checkbox } from '../../common/Checkbox'
import type { ConnectionFormData } from '../../../types/connection'
import type { FormErrors, UpdateField } from '../connection-editor-state'
import styles from '../ConnectionForm.module.css'

const FIELD_ICON_SIZE = 16

export interface FormFieldProps {
  id: string
  label: string
  error?: string
  children: ReactNode
}

export function FormField({ id, label, error, children }: FormFieldProps) {
  return (
    <div className={styles.fieldGroup}>
      <label htmlFor={id} className={styles.labelCaps}>
        {label}
      </label>
      {children}
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  )
}

interface SslFileFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBrowse: () => void
  disabled: boolean
  browseLabel: string
  placeholder?: string
}

export function SslFileField({
  id,
  label,
  value,
  onChange,
  onBrowse,
  disabled,
  browseLabel,
  placeholder,
}: SslFileFieldProps) {
  return (
    <div className={styles.fieldGroup}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.fileInputRow}>
        <TextInput
          type="text"
          id={id}
          variant="mono"
          className={styles.fileInputRowField}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
        <Button
          variant="bare"
          className={styles.browseButton}
          onClick={onBrowse}
          disabled={disabled}
          aria-label={browseLabel}
        >
          <FolderOpen size={FIELD_ICON_SIZE} />
        </Button>
      </div>
    </div>
  )
}

export interface FormFields {
  formData: ConnectionFormData
  errors: FormErrors
  updateField: UpdateField
}

export interface PasswordControls {
  showPassword: boolean
  hasSavedPassword: boolean
  clearSavedPassword: boolean
  showDuplicateHint: boolean
  onPasswordChange: (value: string) => void
  onToggleShowPassword: () => void
  onClearSavedPasswordChange: (checked: boolean) => void
}

const SAVED_PASSWORD_MASK = '••••••••'

function savedPasswordPlaceholder(password: PasswordControls): string {
  if (!password.hasSavedPassword) return ''
  if (password.clearSavedPassword) return ''
  return SAVED_PASSWORD_MASK
}

interface PasswordFieldProps {
  value: string
  password: PasswordControls
}

export function PasswordField({ value, password }: PasswordFieldProps) {
  return (
    <FormField id="conn-password" label="Password">
      <div className={styles.passwordWrapper}>
        <TextInput
          id="conn-password"
          type={password.showPassword ? 'text' : 'password'}
          passwordToggleGutter
          value={value}
          onChange={(event) => password.onPasswordChange(event.target.value)}
          placeholder={savedPasswordPlaceholder(password)}
          disabled={password.clearSavedPassword}
        />
        <IconButton
          size="sm"
          className={styles.passwordToggle}
          onClick={password.onToggleShowPassword}
          aria-label={password.showPassword ? 'Hide password' : 'Show password'}
        >
          {password.showPassword ? (
            <EyeSlash size={FIELD_ICON_SIZE} />
          ) : (
            <Eye size={FIELD_ICON_SIZE} />
          )}
        </IconButton>
      </div>
      {password.showDuplicateHint && (
        <span className={styles.fieldHint} data-testid="duplicate-password-hint">
          Password is not copied — enter it to save.
        </span>
      )}
      {password.hasSavedPassword && (
        <label className={styles.label}>
          <Checkbox
            checked={password.clearSavedPassword}
            onChange={(event) => password.onClearSavedPasswordChange(event.target.checked)}
          />{' '}
          Use no password (remove saved password)
        </label>
      )}
    </FormField>
  )
}
