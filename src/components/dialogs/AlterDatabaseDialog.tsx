import { useState, useEffect, useCallback } from 'react'
import { Button } from '../common/Button'
import { alterDatabase, getDatabaseDetails } from '../../lib/schema-commands'
import { useDatabaseEncoding } from '../../hooks/useDatabaseEncoding'
import { DialogShell } from './DialogShell'
import { EncodingFields } from './EncodingFields'
import { showErrorToast } from '../../stores/toast-store'
import { DIALOG_ERROR_BOX, DIALOG_FOOTER_ACTIONS, DIALOG_TITLE } from '../../lib/class-names-dialog'
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
  if (isLoading) {
    return (
      <div className="p-6 text-center text-size-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
        Loading database details...
      </div>
    )
  }
  if (hasBlockingLoadError) return null
  return <EncodingFields idPrefix="alter-db" encoding={encoding} />
}

const ALTER_DIALOG_MAX_WIDTH = 480

interface AlterDatabaseActionsProps {
  canSubmit: boolean
  isSubmitting: boolean
  onCancel: () => void
}

function AlterDatabaseActions({ canSubmit, isSubmitting, onCancel }: AlterDatabaseActionsProps) {
  return (
    <div className={DIALOG_FOOTER_ACTIONS}>
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
  )
}

function AlterDatabaseError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className={DIALOG_ERROR_BOX} data-testid="alter-db-error">
      {message}
    </div>
  )
}

type PatchDialogState = (patch: Partial<AlterDatabaseDialogState>) => void

interface DatabaseTarget {
  connectionId: string
  databaseName: string
}

function useAlterDialogState(isOpen: boolean, target: DatabaseTarget) {
  const { connectionId, databaseName } = target
  const [dialogState, setDialogState] = useState<AlterDatabaseDialogState>(IDLE_DIALOG_STATE)

  const patchDialogState = useCallback((patch: Partial<AlterDatabaseDialogState>) => {
    setDialogState((current) => ({ ...current, ...patch }))
  }, [])

  useEffect(() => {
    if (isOpen) return
    setDialogState(IDLE_DIALOG_STATE)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function load() {
      patchDialogState({ detailsLoading: true, detailsError: null, submitError: null })
      try {
        const details = await getDatabaseDetails(connectionId, databaseName)
        if (cancelled) return
        patchDialogState({
          initialEncoding: {
            charset: details.defaultCharacterSet,
            collation: details.defaultCollation,
          },
        })
      } catch (error) {
        if (cancelled) return
        const message = toErrorMessage(error)
        patchDialogState({ detailsError: message })
        showErrorToast('Failed to load database', message)
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

  return { dialogState: dialogState, patchDialogState: patchDialogState }
}

interface AlterSubmitInputs {
  target: DatabaseTarget
  encoding: ReturnType<typeof useDatabaseEncoding>
  onSuccess: () => void
  patchDialogState: PatchDialogState
}

function useAlterSubmit({ target, encoding, onSuccess, patchDialogState }: AlterSubmitInputs) {
  const { connectionId, databaseName } = target
  const { charset, collation } = encoding
  const handleSubmit = useCallback(async () => {
    patchDialogState({ isSubmitting: true, submitError: null })

    try {
      await alterDatabase({
        connectionId: connectionId,
        name: databaseName,
        charset: charset || null,
        collation: collation || null,
      })
      onSuccess()
    } catch (error) {
      const message = toErrorMessage(error)
      patchDialogState({ submitError: message })
      showErrorToast('Failed to alter database', message)
    } finally {
      patchDialogState({ isSubmitting: false })
    }
  }, [connectionId, databaseName, charset, collation, onSuccess, patchDialogState])

  return useFormSubmit(handleSubmit)
}

export function AlterDatabaseDialog({
  isOpen,
  connectionId,
  databaseName,
  onSuccess,
  onCancel,
}: AlterDatabaseDialogProps) {
  const target = { connectionId: connectionId, databaseName: databaseName }
  const { dialogState, patchDialogState } = useAlterDialogState(isOpen, target)
  const { detailsLoading, initialEncoding, isSubmitting, detailsError, submitError } = dialogState
  const encoding = useDatabaseEncoding({
    connectionId: connectionId,
    isOpen: isOpen,
    initialCharset: initialEncoding.charset,
    initialCollation: initialEncoding.collation,
  })
  const handleFormSubmit = useAlterSubmit({
    target: target,
    encoding: encoding,
    onSuccess: onSuccess,
    patchDialogState: patchDialogState,
  })

  const isLoading = detailsLoading || encoding.isLoading
  const hasBlockingLoadError = detailsError !== null || encoding.error !== null
  const canSubmit = !isLoading && !hasBlockingLoadError && !isSubmitting

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={ALTER_DIALOG_MAX_WIDTH}
      testId="alter-database-dialog"
      ariaLabel="Alter database"
      nonDismissible={isSubmitting}
      formProps={{ onSubmit: handleFormSubmit }}
    >
      <h2 className={DIALOG_TITLE}>Alter database</h2>
      <p className="mb-5 font-mono text-size-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {databaseName}
      </p>

      <AlterDatabaseEncodingSection
        isLoading={isLoading}
        hasBlockingLoadError={hasBlockingLoadError}
        encoding={encoding}
      />

      <AlterDatabaseError
        message={firstErrorMessage([submitError, detailsError, encoding.error])}
      />

      <AlterDatabaseActions canSubmit={canSubmit} isSubmitting={isSubmitting} onCancel={onCancel} />
    </DialogShell>
  )
}
