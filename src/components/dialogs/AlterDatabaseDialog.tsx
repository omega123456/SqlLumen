import { useState, useEffect, useCallback } from 'react'
import { Button } from '../common/Button'
import { alterDatabase, getDatabaseDetails } from '../../lib/schema-commands'
import { useDatabaseEncoding } from '../../hooks/useDatabaseEncoding'
import { DialogShell } from './DialogShell'
import { EncodingFields } from './EncodingFields'
import { showErrorToast } from '../../stores/toast-store'
import styles from './AlterDatabaseDialog.module.css'
import { toErrorMessage } from '../../lib/error-message'
import { useFormSubmit } from '../../hooks/useFormSubmit'

interface InitialEncodingState {
  charset?: string
  collation?: string
}

interface AlterDatabaseDialogState {
  detailsLoading: boolean
  initialEncoding: InitialEncodingState
  isSubmitting: boolean
  detailsError: string | null
  submitError: string | null
}

const IDLE_DIALOG_STATE: AlterDatabaseDialogState = {
  detailsLoading: true,
  initialEncoding: {},
  isSubmitting: false,
  detailsError: null,
  submitError: null,
}

export interface AlterDatabaseDialogProps {
  isOpen: boolean
  connectionId: string
  databaseName: string
  onSuccess: () => void
  onCancel: () => void
}

function firstErrorMessage(candidates: (string | null)[]): string | null {
  return candidates.find(Boolean) ?? null
}

interface AlterDatabaseEncodingSectionProps {
  isLoading: boolean
  hasBlockingLoadError: boolean
  encoding: ReturnType<typeof useDatabaseEncoding>
}

function AlterDatabaseEncodingSection({
  isLoading,
  hasBlockingLoadError,
  encoding,
}: AlterDatabaseEncodingSectionProps) {
  if (isLoading) return <div className={styles.loading}>Loading database details...</div>
  if (hasBlockingLoadError) return null
  return <EncodingFields idPrefix="alter-db" encoding={encoding} />
}

export function AlterDatabaseDialog({
  isOpen,
  connectionId,
  databaseName,
  onSuccess,
  onCancel,
}: AlterDatabaseDialogProps) {
  const [dialogState, setDialogState] = useState<AlterDatabaseDialogState>(IDLE_DIALOG_STATE)
  const { detailsLoading, initialEncoding, isSubmitting, detailsError, submitError } = dialogState

  const patchDialogState = useCallback((patch: Partial<AlterDatabaseDialogState>) => {
    setDialogState((current) => ({ ...current, ...patch }))
  }, [])

  useEffect(() => {
    if (isOpen) return
    setDialogState(IDLE_DIALOG_STATE)
  }, [isOpen])

  // Load current database details on open
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function load() {
      patchDialogState({ detailsLoading: true, detailsError: null, submitError: null })
      try {
        const details = await getDatabaseDetails(connectionId, databaseName)
        if (!cancelled) {
          patchDialogState({
            initialEncoding: {
              charset: details.defaultCharacterSet,
              collation: details.defaultCollation,
            },
          })
        }
      } catch (error) {
        if (!cancelled) {
          const message = toErrorMessage(error)
          patchDialogState({ detailsError: message })
          showErrorToast('Failed to load database', message)
        }
      } finally {
        if (!cancelled) {
          patchDialogState({ detailsLoading: false })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isOpen, connectionId, databaseName, patchDialogState])

  const encoding = useDatabaseEncoding(
    connectionId,
    isOpen,
    initialEncoding.charset,
    initialEncoding.collation
  )

  // Combine loading states
  const isLoading = detailsLoading || encoding.isLoading

  // Combine errors
  const displayError = firstErrorMessage([submitError, detailsError, encoding.error])
  const hasBlockingLoadError = detailsError !== null || encoding.error !== null
  const canSubmit = !isLoading && !hasBlockingLoadError && !isSubmitting

  const handleSubmit = useCallback(async () => {
    patchDialogState({ isSubmitting: true, submitError: null })

    try {
      await alterDatabase(
        connectionId,
        databaseName,
        encoding.charset || undefined,
        encoding.collation || undefined
      )
      onSuccess()
    } catch (error) {
      const message = toErrorMessage(error)
      patchDialogState({ submitError: message })
      showErrorToast('Failed to alter database', message)
    } finally {
      patchDialogState({ isSubmitting: false })
    }
  }, [
    connectionId,
    databaseName,
    encoding.charset,
    encoding.collation,
    onSuccess,
    patchDialogState,
  ])

  const handleFormSubmit = useFormSubmit(handleSubmit)

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={480}
      testId="alter-database-dialog"
      ariaLabel="Alter database"
      nonDismissible={isSubmitting}
      formProps={{ onSubmit: handleFormSubmit }}
    >
      <h2 className={styles.title}>Alter database</h2>
      <p className={styles.subtitle}>{databaseName}</p>

      <AlterDatabaseEncodingSection
        isLoading={isLoading}
        hasBlockingLoadError={hasBlockingLoadError}
        encoding={encoding}
      />

      {displayError && (
        <div className={styles.error} data-testid="alter-db-error">
          {displayError}
        </div>
      )}

      <div className={styles.actions}>
        <Button
          variant="accent"
          type="submit"
          disabled={!canSubmit}
          data-testid="alter-db-submit-button"
        >
          {isSubmitting ? 'Saving...' : 'Alter database'}
        </Button>
        <Button onClick={onCancel} disabled={isSubmitting} data-testid="alter-db-cancel-button">
          Cancel
        </Button>
      </div>
    </DialogShell>
  )
}
