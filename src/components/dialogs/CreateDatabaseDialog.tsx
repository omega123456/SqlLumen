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

interface CreateDatabaseFormState {
  name: string
  isSubmitting: boolean
  error: string | null
  nameError: string | null
}

const IDLE_FORM_STATE: CreateDatabaseFormState = {
  name: '',
  isSubmitting: false,
  error: null,
  nameError: null,
}

const CREATE_DIALOG_MAX_WIDTH = 480

function validateDatabaseName(value: string): string | null {
  if (!value.trim()) return 'Database name is required'
  if (value.length > MYSQL_IDENTIFIER_MAX_LENGTH)
    return `Database name cannot exceed ${MYSQL_IDENTIFIER_MAX_LENGTH} characters`
  return null
}

function isValidDatabaseName(name: string): boolean {
  return name.trim().length > 0 && name.length <= MYSQL_IDENTIFIER_MAX_LENGTH
}

interface CreateDatabaseInputs {
  isOpen: boolean
  connectionId: string
  onSuccess: (databaseName: string) => void
}

function useCreateDatabaseForm({ isOpen, connectionId, onSuccess }: CreateDatabaseInputs) {
  const [formState, setFormState] = useState<CreateDatabaseFormState>(IDLE_FORM_STATE)
  const { name, nameError } = formState
  const encoding = useDatabaseEncoding({ connectionId: connectionId, isOpen: isOpen })
  const { charset, collation } = encoding

  const patchFormState = useCallback((patch: Partial<CreateDatabaseFormState>) => {
    setFormState((current) => ({ ...current, ...patch }))
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setFormState(IDLE_FORM_STATE)
  }, [isOpen])

  const changeName = (value: string) => {
    if (nameError) {
      patchFormState({ name: value, nameError: validateDatabaseName(value) })
      return
    }
    patchFormState({ name: value })
  }

  const handleSubmit = useCallback(async () => {
    const validation = validateDatabaseName(name)
    if (validation) {
      patchFormState({ nameError: validation })
      return
    }

    patchFormState({ isSubmitting: true, error: null })

    try {
      await createDatabase({
        connectionId: connectionId,
        name: name.trim(),
        charset: charset || null,
        collation: collation || null,
      })
      onSuccess(name.trim())
    } catch (error) {
      const message = toErrorMessage(error)
      patchFormState({ error: message })
      showErrorToast('Failed to create database', message)
    } finally {
      patchFormState({ isSubmitting: false })
    }
  }, [connectionId, charset, collation, name, onSuccess, patchFormState])

  return {
    formState: formState,
    encoding: encoding,
    changeName: changeName,
    handleFormSubmit: useFormSubmit(handleSubmit),
  }
}

interface DatabaseNameFieldProps {
  name: string
  nameError: string | null
  onChange: (value: string) => void
}

function DatabaseNameField({ name, nameError, onChange }: DatabaseNameFieldProps) {
  return (
    <div className={styles.formGroup}>
      <label className={styles.label} htmlFor="create-db-name">
        Database name
      </label>
      <TextInput
        id="create-db-name"
        type="text"
        invalid={!!nameError}
        value={name}
        onChange={(event) => onChange(event.target.value)}
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
  )
}

export function CreateDatabaseDialog({
  isOpen,
  connectionId,
  onSuccess,
  onCancel,
}: CreateDatabaseDialogProps) {
  const form = useCreateDatabaseForm({
    isOpen: isOpen,
    connectionId: connectionId,
    onSuccess: onSuccess,
  })
  const { name, isSubmitting, error, nameError } = form.formState
  const { encoding } = form

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={CREATE_DIALOG_MAX_WIDTH}
      testId="create-database-dialog"
      ariaLabel="Create database"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={isSubmitting}
      formProps={{ onSubmit: form.handleFormSubmit }}
    >
      <div
        className={styles.encodingRoot}
        data-testid="create-db-form"
        aria-busy={encoding.isLoading ? true : undefined}
      >
        <h2 className={styles.title}>Create database</h2>
        <DatabaseNameField name={name} nameError={nameError} onChange={form.changeName} />
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
            disabled={!isValidDatabaseName(name) || isSubmitting}
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
