import { WarningCircle } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'
import { SQL_HIGHLIGHT_CLASS_NAMES } from '../../lib/sql-highlight-class-names'
import { applyTableDdl } from '../../lib/table-designer-commands'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { Button } from '../common/Button'
import { DialogShell } from '../dialogs/DialogShell'
import styles from './ApplySchemaChangesDialog.module.css'

import { logFrontendError } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { isPlaywrightBuild } from '../../lib/tauri-env'
export interface ApplySchemaChangesDialogProps {
  isOpen: boolean
  ddl: string
  warnings: string[]
  connectionId: string
  database: string
  schemaMode: 'create' | 'alter'
  tableLabel: string
  onSuccess: () => void
  onCancel: () => void
}

type ApplyRequest = Pick<
  ApplySchemaChangesDialogProps,
  'isOpen' | 'ddl' | 'connectionId' | 'database' | 'schemaMode' | 'tableLabel' | 'onSuccess'
>

function useApplySchemaChanges(request: ApplyRequest) {
  const { isOpen, ddl, connectionId, database, schemaMode, tableLabel, onSuccess } = request
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
      const successTitle = schemaMode === 'create' ? 'Table created' : 'Table updated'
      showSuccessToast(successTitle, tableLabel)
      onSuccess()
    } catch (applyError) {
      logFrontendError('[apply-schema-dialog] Failed to apply schema changes', applyError)
      const message = toErrorMessage(applyError)
      setError(message)
      showErrorToast('Failed to apply schema changes', message)
    } finally {
      setIsExecuting(false)
    }
  }

  return { isExecuting, error, handleExecute }
}

function SchemaWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
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
  )
}

interface ApplyActionsProps {
  isExecuting: boolean
  onExecute: () => void
  onCancel: () => void
}

function ApplyActions({ isExecuting, onExecute, onCancel }: ApplyActionsProps) {
  return (
    <div className={styles.actions}>
      <Button
        variant="accent"
        className={styles.executeButton}
        onClick={onExecute}
        disabled={isExecuting}
        data-testid="apply-schema-confirm"
      >
        {isExecuting ? 'Executing...' : 'Execute changes'}
      </Button>
      <Button
        className={styles.cancelButton}
        onClick={onCancel}
        disabled={isExecuting}
        data-testid="apply-schema-cancel"
      >
        Cancel
      </Button>
    </div>
  )
}

export function ApplySchemaChangesDialog(props: ApplySchemaChangesDialogProps) {
  const { isOpen, ddl, warnings, onCancel } = props
  const { isExecuting, error, handleExecute } = useApplySchemaChanges(props)
  const highlightedDdl = useMemo(
    () => SqlSyntaxHighlighter.highlightSql(ddl, SQL_HIGHLIGHT_CLASS_NAMES),
    [ddl]
  )

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={760}
      testId="apply-schema-dialog"
      ariaLabel="Apply schema changes"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={isExecuting}
    >
      <div className={styles.root}>
        <div className={styles.header}>
          <h2 className={styles.title}>Apply schema changes</h2>
          <p className={styles.description}>The following SQL will be executed:</p>
        </div>

        <pre className={styles.codeBlock} data-testid="apply-schema-ddl">
          <code>{highlightedDdl}</code>
        </pre>

        <SchemaWarnings warnings={warnings} />

        {error && (
          <div className={styles.error} data-testid="apply-schema-error">
            {error}
          </div>
        )}

        <ApplyActions
          isExecuting={isExecuting}
          onExecute={() => void handleExecute()}
          onCancel={onCancel}
        />
      </div>
    </DialogShell>
  )
}
