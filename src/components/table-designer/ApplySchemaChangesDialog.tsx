import { WarningCircle } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'
import { SQL_HIGHLIGHT_CLASS_NAMES } from '../../lib/sql-highlight-class-names'
import { applyTableDdl } from '../../lib/table-designer-commands'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { Button } from '../common/Button'
import { DialogShell } from '../dialogs/DialogShell'
import { SCROLLBAR, joinClassNames } from '../../lib/class-names'

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
    <div
      className="flex flex-col gap-2 rounded-card border border-light-warning-a20 bg-light-warning-container-a28 p-3 dark:border-dark-warning-a20 dark:bg-dark-warning-container-a28"
      data-testid="apply-schema-warnings"
    >
      <div className="flex items-center gap-2 font-semibold text-light-warning dark:text-dark-warning">
        <WarningCircle size={18} weight="fill" />
        <span>Warnings</span>
      </div>
      <ul className="list-disc pl-5 text-light-on-surface dark:text-dark-on-surface">
        {warnings.map((warning) => (
          <li key={warning} className="not-first:mt-1">
            {warning}
          </li>
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
    <div className="flex justify-end gap-2">
      <Button
        variant="accent"
        className="min-w-42"
        onClick={onExecute}
        disabled={isExecuting}
        data-testid="apply-schema-confirm"
      >
        {isExecuting ? 'Executing...' : 'Execute changes'}
      </Button>
      <Button
        className="min-w-30"
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
      <div className="flex flex-col gap-4 p-6 text-light-on-surface dark:text-dark-on-surface">
        <div className="flex flex-col gap-1">
          <h2 className="font-headline text-subtitle font-semibold text-light-on-surface dark:text-dark-on-surface">
            Apply schema changes
          </h2>
          <p className="text-light-on-surface-variant dark:text-dark-on-surface-variant">
            The following SQL will be executed:
          </p>
        </div>

        <pre
          className={joinClassNames([
            'max-h-75 overflow-y-auto rounded-card border border-light-stroke-card bg-light-surface-container-lowest px-4 py-3.5 font-mono text-mono-relaxed whitespace-pre-wrap wrap-anywhere text-light-token-text dark:border-dark-stroke-card dark:bg-dark-surface-container-lowest dark:text-dark-token-text',
            SCROLLBAR,
          ])}
          data-testid="apply-schema-ddl"
        >
          <code>{highlightedDdl}</code>
        </pre>

        <SchemaWarnings warnings={warnings} />

        {error && (
          <div
            className="text-size-caption text-light-error dark:text-dark-error"
            data-testid="apply-schema-error"
          >
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
