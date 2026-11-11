import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { Button } from '../common/Button'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { alterDatabase, getDatabaseDetails } from '../../lib/schema-commands'
import { useDatabaseEncoding } from '../../hooks/useDatabaseEncoding'
import { DialogShell } from './DialogShell'
import { showErrorToast } from '../../stores/toast-store'
import styles from './AlterDatabaseDialog.module.css'

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
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          patchDialogState({ detailsError: msg })
          showErrorToast('Failed to load database', msg)
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
  const displayError = submitError || detailsError || encoding.error
  const hasBlockingLoadError = detailsError !== null || encoding.error !== null

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      patchDialogState({ submitError: msg })
      showErrorToast('Failed to alter database', msg)
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

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void handleSubmit()
    },
    [handleSubmit]
  )

  // Build dropdown options
  const charsetOptions: DropdownOption[] = [
    { value: '', label: 'Server default' },
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

      {isLoading ? (
        <div className={styles.loading}>Loading database details...</div>
      ) : hasBlockingLoadError ? null : (
        <>
          <div className={styles.formGroup}>
            <label className={styles.label} id="alter-db-charset-label">
              Character set
            </label>
            <Dropdown
              id="alter-db-charset"
              labelledBy="alter-db-charset-label"
              options={charsetOptions}
              value={encoding.charset}
              onChange={encoding.setCharset}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label} id="alter-db-collation-label">
              Collation
            </label>
            <Dropdown
              id="alter-db-collation"
              labelledBy="alter-db-collation-label"
              options={collationOptions}
              value={encoding.collation}
              onChange={encoding.setCollation}
            />
          </div>
        </>
      )}

      {displayError && (
        <div className={styles.error} data-testid="alter-db-error">
          {displayError}
        </div>
      )}

      <div className={styles.actions}>
        <Button
          variant="accent"
          type="submit"
          disabled={detailsLoading || encoding.isLoading || hasBlockingLoadError || isSubmitting}
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
