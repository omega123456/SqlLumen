import { useEffect, useState, useCallback } from 'react'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { createDatabase } from '../../lib/schema-commands'
import { useDatabaseEncoding } from '../../hooks/useDatabaseEncoding'
import { DialogShell } from './DialogShell'
import { EncodingFields } from './EncodingFields'
import { showErrorToast } from '../../stores/toast-store'
import styles from './CreateDatabaseDialog.module.css'
import { MYSQL_IDENTIFIER_MAX_LENGTH } from '../../lib/sql-utils'
import { toErrorMessage } from '../../lib/error-message'
import { isPlaywrightBuild } from '../../lib/tauri-env'
import { useFormSubmit } from '../../hooks/useFormSubmit'

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

  useEffect(() => {
    if (!isOpen) return
    setName('')
    setIsSubmitting(false)
    setError(null)
    setNameError(null)
  }, [isOpen])

  const validateName = useCallback((value: string): string | null => {
    if (!value.trim()) return 'Database name is required'
    if (value.length > MYSQL_IDENTIFIER_MAX_LENGTH)
      return `Database name cannot exceed ${MYSQL_IDENTIFIER_MAX_LENGTH} characters`
    return null
  }, [])

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setName(value)
    if (nameError) {
      setNameError(validateName(value))
    }
  }

  const handleSubmit = useCallback(async () => {
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
    } catch (error) {
      const message = toErrorMessage(error)
      setError(message)
      showErrorToast('Failed to create database', message)
    } finally {
      setIsSubmitting(false)
    }
  }, [connectionId, encoding.charset, encoding.collation, name, onSuccess, validateName])

  const handleFormSubmit = useFormSubmit(handleSubmit)

  const isValid = name.trim().length > 0 && name.length <= MYSQL_IDENTIFIER_MAX_LENGTH

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={480}
      testId="create-database-dialog"
      ariaLabel="Create database"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={isSubmitting}
      formProps={{ onSubmit: handleFormSubmit }}
    >
      <div
        className={styles.encodingRoot}
        data-testid="create-db-form"
        aria-busy={encoding.isLoading ? true : undefined}
      >
        <h2 className={styles.title}>Create database</h2>

        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="create-db-name">
            Database name
          </label>
          <TextInput
            id="create-db-name"
            type="text"
            invalid={!!nameError}
            value={name}
            onChange={handleNameChange}
            placeholder="my_new_database"
            maxLength={MYSQL_IDENTIFIER_MAX_LENGTH}
            autoFocus={!isPlaywrightBuild()}
            data-testid="create-db-name-input"
          />
          {nameError && (
            <div className={styles.validationError} data-testid="create-db-name-error">
              {nameError}
            </div>
          )}
        </div>

        <EncodingFields idPrefix="create-db" encoding={encoding} />

        {error && (
          <div className={styles.error} data-testid="create-db-error">
            {error}
          </div>
        )}

        <div className={styles.actions}>
          <Button
            variant="accent"
            type="submit"
            disabled={!isValid || isSubmitting}
            data-testid="create-db-submit-button"
          >
            {isSubmitting ? 'Creating...' : 'Create database'}
          </Button>
          <Button onClick={onCancel} disabled={isSubmitting} data-testid="create-db-cancel-button">
            Cancel
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
