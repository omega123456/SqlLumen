import { useState, useEffect } from 'react'
import { Button } from '../common/Button'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { alterDatabase, getDatabaseDetails } from '../../lib/schema-commands'
import { useDatabaseEncoding } from '../../hooks/useDatabaseEncoding'
import { DialogShell } from './DialogShell'
import { showErrorToast } from '../../stores/toast-store'
import styles from './AlterDatabaseDialog.module.css'

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
  const [detailsLoading, setDetailsLoading] = useState(true)
  const [initialCharset, setInitialCharset] = useState<string | undefined>(undefined)
  const [initialCollation, setInitialCollation] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load current database details on open
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function load() {
      setDetailsLoading(true)
      setError(null)
      try {
        const details = await getDatabaseDetails(connectionId, databaseName)
        if (!cancelled) {
          setInitialCharset(details.defaultCharacterSet)
          setInitialCollation(details.defaultCollation)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          showErrorToast('Failed to load database', msg)
        }
      } finally {
        if (!cancelled) {
          setDetailsLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isOpen, connectionId, databaseName])

  const encoding = useDatabaseEncoding(connectionId, isOpen, initialCharset, initialCollation)

  // Combine loading states
  const isLoading = detailsLoading || encoding.isLoading

  // Combine errors
  const displayError = error || encoding.error

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

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
      setError(msg)
      showErrorToast('Failed to alter database', msg)
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

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={480}
      testId="alter-database-dialog"
      ariaLabel="Alter Database"
    >
      <h2 className={styles.title}>Alter Database</h2>
      <p className={styles.subtitle}>{databaseName}</p>

      {isLoading ? (
        <div className={styles.loading}>Loading database details...</div>
      ) : (
        <>
          <div className={styles.formGroup}>
            <label className={styles.label} id="alter-db-charset-label">
              Character Set
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
        <Button variant="secondary" onClick={onCancel} data-testid="alter-db-cancel-button">
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={isLoading || isSubmitting}
          data-testid="alter-db-submit-button"
        >
          {isSubmitting ? 'Saving...' : 'Alter Database'}
        </Button>
      </div>
    </DialogShell>
  )
}
