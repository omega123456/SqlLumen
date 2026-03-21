import { useState } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { createDatabase } from '../../lib/schema-commands'
import { useDatabaseEncoding } from '../../hooks/useDatabaseEncoding'
import { DialogShell } from './DialogShell'
import styles from './CreateDatabaseDialog.module.css'

export interface CreateDatabaseDialogProps {
  isOpen: boolean
  connectionId: string
  onSuccess: (databaseName: string) => void
  onCancel: () => void
}

export function CreateDatabaseDialog({
  isOpen,
  connectionId,
  onSuccess,
  onCancel,
}: CreateDatabaseDialogProps) {
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  const encoding = useDatabaseEncoding(connectionId, isOpen)

  const validateName = (value: string): string | null => {
    if (!value.trim()) return 'Database name is required'
    if (value.length > 64) return 'Database name cannot exceed 64 characters'
    return null
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setName(value)
    if (nameError) {
      setNameError(validateName(value))
    }
  }

  const handleSubmit = async () => {
    const validation = validateName(name)
    if (validation) {
      setNameError(validation)
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await createDatabase(
        connectionId,
        name.trim(),
        encoding.charset || undefined,
        encoding.collation || undefined
      )
      onSuccess(name.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Build dropdown options
  const charsetOptions: DropdownOption[] = [
    { value: '', label: 'Server Default' },
    ...encoding.charsets.map((cs) => ({
      value: cs.charset,
      label: cs.charset,
      description: cs.description,
    })),
  ]

  const collationOptions: DropdownOption[] = [
    { value: '', label: 'Default' },
    ...encoding.filteredCollations.map((c) => ({
      value: c.name,
      label: c.name,
      description: c.isDefault ? 'default' : undefined,
    })),
  ]

  const isValid = name.trim().length > 0 && name.length <= 64

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={480}
      testId="create-database-dialog"
      ariaLabel="Create Database"
    >
      <h2 className={styles.title}>Create Database</h2>

      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="create-db-name">
          Database Name
        </label>
        <input
          id="create-db-name"
          type="text"
          className="ui-input"
          value={name}
          onChange={handleNameChange}
          placeholder="my_new_database"
          maxLength={64}
          autoFocus
          data-testid="create-db-name-input"
        />
        {nameError && (
          <div className={styles.validationError} data-testid="create-db-name-error">
            {nameError}
          </div>
        )}
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} id="create-db-charset-label">
          Character Set
        </label>
        <Dropdown
          id="create-db-charset"
          labelledBy="create-db-charset-label"
          options={charsetOptions}
          value={encoding.charset}
          onChange={encoding.setCharset}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} id="create-db-collation-label">
          Collation
        </label>
        <Dropdown
          id="create-db-collation"
          labelledBy="create-db-collation-label"
          options={collationOptions}
          value={encoding.collation}
          onChange={encoding.setCollation}
        />
      </div>

      {error && (
        <div className={styles.error} data-testid="create-db-error">
          {error}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className="ui-button-secondary"
          onClick={onCancel}
          data-testid="create-db-cancel-button"
        >
          Cancel
        </button>
        <button
          type="button"
          className="ui-button-primary"
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
          data-testid="create-db-submit-button"
        >
          {isSubmitting ? 'Creating...' : 'Create Database'}
        </button>
      </div>
    </DialogShell>
  )
}
