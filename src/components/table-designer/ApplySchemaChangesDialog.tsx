import { WarningCircle } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { applyTableDdl } from '../../lib/table-designer-commands'
import { DialogShell } from '../dialogs/DialogShell'
import styles from './ApplySchemaChangesDialog.module.css'

const isPlaywright = import.meta.env.VITE_PLAYWRIGHT === 'true'

export interface ApplySchemaChangesDialogProps {
  isOpen: boolean
  ddl: string
  warnings: string[]
  connectionId: string
  database: string
  onSuccess: () => void
  onCancel: () => void
}

export function ApplySchemaChangesDialog({
  isOpen,
  ddl,
  warnings,
  connectionId,
  database,
  onSuccess,
  onCancel,
}: ApplySchemaChangesDialogProps) {
  const [isExecuting, setIsExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setIsExecuting(false)
    setError(null)
  }, [isOpen, ddl])

  const handleExecute = async () => {
    setIsExecuting(true)
    setError(null)

    try {
      await applyTableDdl(connectionId, database, ddl)
      onSuccess()
    } catch (applyError) {
      console.error('[apply-schema-dialog] Failed to apply schema changes', applyError)
      setError(applyError instanceof Error ? applyError.message : String(applyError))
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={760}
      testId="apply-schema-dialog"
      ariaLabel="Apply Schema Changes"
      disableFocusManagement={isPlaywright}
      nonDismissible={isExecuting}
    >
      <div className={styles.root}>
        <div className={styles.header}>
          <h2 className={styles.title}>Apply Schema Changes</h2>
          <p className={styles.description}>The following SQL will be executed:</p>
        </div>

        <pre className={styles.codeBlock} data-testid="apply-schema-ddl">
          <code>{ddl}</code>
        </pre>

        {warnings.length > 0 && (
          <div className={styles.warningSection} data-testid="apply-schema-warnings">
            <div className={styles.warningHeader}>
              <WarningCircle size={18} weight="fill" />
              <span>Warnings</span>
            </div>
            <ul className={styles.warningList}>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className={styles.error} data-testid="apply-schema-error">
            {error}
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={`ui-button-secondary ${styles.cancelButton}`}
            onClick={onCancel}
            disabled={isExecuting}
            data-testid="apply-schema-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.executeButton}
            onClick={handleExecute}
            disabled={isExecuting}
            data-testid="apply-schema-confirm"
          >
            {isExecuting ? 'Executing...' : 'Execute Changes'}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
