import { Copy } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { Button } from '../common/Button'
import { ElevatedSurface } from '../common/ElevatedSurface'
import styles from './DdlPreviewTab.module.css'

interface DdlPreviewTabProps {
  tabId: string
}

export function DdlPreviewTab({ tabId }: DdlPreviewTabProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])

  const ddl = tabState?.ddl ?? ''
  const isDdlLoading = tabState?.isDdlLoading ?? false
  const ddlError = tabState?.ddlError ?? null

  const highlightedSql = useMemo(
    () =>
      SqlSyntaxHighlighter.highlightSql(ddl, {
        keyword: styles.keyword,
        identifier: styles.identifier,
        type: styles.type,
        string: styles.string,
      }),
    [ddl]
  )

  if (!tabState) {
    return null
  }

  const handleCopy = async () => {
    try {
      await writeClipboardText(ddl)
      showSuccessToast('Copied to clipboard')
    } catch (error) {
      console.error('[ddl-preview-tab] Failed to copy DDL', error)
      showErrorToast('Copy failed', error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className={styles.container} data-testid="table-designer-ddl-preview">
      <div className={styles.header}>
        <Button
          variant="secondary"
          onClick={() => {
            void handleCopy()
          }}
          disabled={ddl.trim() === ''}
          data-testid="ddl-preview-copy"
        >
          <Copy size={16} weight="bold" />
          <span>Copy to Clipboard</span>
        </Button>
      </div>

      <div className={styles.body}>
        <ElevatedSurface className={styles.codeSurface}>
          {isDdlLoading ? (
            <div className={styles.state} data-testid="ddl-preview-loading">
              Generating...
            </div>
          ) : ddlError ? (
            <div className={`${styles.state} ${styles.error}`} data-testid="ddl-preview-error">
              {ddlError}
            </div>
          ) : (
            <pre className={styles.codeBlock} data-testid="ddl-preview-code">
              <code>{highlightedSql}</code>
            </pre>
          )}
        </ElevatedSurface>
      </div>

      {!isDdlLoading && !ddlError && (
        <div className={styles.footer}>Live updating as changes are detected</div>
      )}
    </div>
  )
}
