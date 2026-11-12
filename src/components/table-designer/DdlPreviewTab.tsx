import { Copy } from '@phosphor-icons/react'
import { useMemo, type ReactNode } from 'react'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'
import { SQL_HIGHLIGHT_CLASS_NAMES } from '../../lib/sql-highlight-class-names'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import {
  useTableDesignerStore,
  type TableDesignerTabState,
} from '../../stores/table-designer-store'
import { Button } from '../common/Button'
import styles from './DdlPreviewTab.module.css'

import { logFrontendError } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
interface DdlPreviewTabProps {
  tabId: string
}

interface DdlPreviewState {
  ddl: string
  isDdlLoading: boolean
  ddlError: string | null
}

const EMPTY_DDL_PREVIEW: DdlPreviewState = { ddl: '', isDdlLoading: false, ddlError: null }

function ddlPreviewState(tabState: TableDesignerTabState | undefined): DdlPreviewState {
  if (!tabState) return EMPTY_DDL_PREVIEW
  return {
    ddl: tabState.ddl,
    isDdlLoading: tabState.isDdlLoading,
    ddlError: tabState.ddlError,
  }
}

function isShowingLiveDdl(preview: DdlPreviewState): boolean {
  return !preview.isDdlLoading && !preview.ddlError
}

interface DdlPreviewBodyProps {
  preview: DdlPreviewState
  highlightedSql: ReactNode[]
}

function DdlPreviewBody({ preview, highlightedSql }: DdlPreviewBodyProps) {
  if (preview.isDdlLoading) {
    return (
      <div className={styles.state} data-testid="ddl-preview-loading">
        Generating...
      </div>
    )
  }

  if (preview.ddlError) {
    return (
      <div className={`${styles.state} ${styles.error}`} data-testid="ddl-preview-error">
        {preview.ddlError}
      </div>
    )
  }

  return (
    <pre className={styles.codeBlock} data-testid="ddl-preview-code">
      <code>{highlightedSql}</code>
    </pre>
  )
}

export function DdlPreviewTab({ tabId }: DdlPreviewTabProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])

  const preview = ddlPreviewState(tabState)
  const ddl = preview.ddl

  const highlightedSql = useMemo(
    () => SqlSyntaxHighlighter.highlightSql(ddl, SQL_HIGHLIGHT_CLASS_NAMES),
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
      logFrontendError('[ddl-preview-tab] Failed to copy DDL', error)
      showErrorToast('Copy failed', toErrorMessage(error))
    }
  }

  return (
    <div className={styles.container} data-testid="table-designer-ddl-preview">
      <div className={styles.header}>
        <Button
          variant="subtle"
          size="sm"
          onClick={() => {
            void handleCopy()
          }}
          disabled={ddl.trim() === ''}
          data-testid="ddl-preview-copy"
        >
          <Copy size={16} weight="regular" />
          <span>Copy to clipboard</span>
        </Button>
      </div>

      <div className={styles.body}>
        <DdlPreviewBody preview={preview} highlightedSql={highlightedSql} />
      </div>

      {isShowingLiveDdl(preview) && (
        <div className={styles.footer}>Live updating as changes are detected</div>
      )}
    </div>
  )
}
