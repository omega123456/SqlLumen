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
import { SCROLLBAR, joinClassNames } from '../../lib/class-names'
import { DesignerPanel } from './designer-table/DesignerTableParts'

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

type DdlPreviewStatus = 'loading' | 'error'

const STATUS_BLOCK_CLASSES: Record<DdlPreviewStatus, string> = {
  loading:
    'flex min-h-30 w-full items-center justify-center rounded-card border border-light-stroke-card bg-light-surface-container-lowest px-4 py-3.5 font-body text-mono-relaxed text-light-on-surface-variant dark:border-dark-stroke-card dark:bg-dark-surface-container-lowest dark:text-dark-on-surface-variant',
  error:
    'flex min-h-30 w-full items-center justify-center rounded-card border border-light-stroke-card bg-light-surface-container-lowest px-4 py-3.5 font-body text-mono-relaxed text-light-error dark:border-dark-stroke-card dark:bg-dark-surface-container-lowest dark:text-dark-error',
}

interface DdlPreviewBodyProps {
  preview: DdlPreviewState
  highlightedSql: ReactNode[]
}

function DdlPreviewBody({ preview, highlightedSql }: DdlPreviewBodyProps) {
  if (preview.isDdlLoading) {
    return (
      <div className={STATUS_BLOCK_CLASSES.loading} data-testid="ddl-preview-loading">
        Generating...
      </div>
    )
  }

  if (preview.ddlError) {
    return (
      <div className={STATUS_BLOCK_CLASSES.error} data-testid="ddl-preview-error">
        {preview.ddlError}
      </div>
    )
  }

  return (
    <pre
      className={joinClassNames([
        'min-h-0 w-full flex-initial overflow-auto rounded-card border border-light-stroke-card bg-light-surface-container-lowest px-4 py-3.5 font-mono text-mono-relaxed whitespace-pre text-light-token-text select-text dark:border-dark-stroke-card dark:bg-dark-surface-container-lowest dark:text-dark-token-text',
        SCROLLBAR,
      ])}
      data-testid="ddl-preview-code"
    >
      <code className="font-generic-mono">{highlightedSql}</code>
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
    <DesignerPanel testId="table-designer-ddl-preview">
      <div className="flex h-command-bar flex-none items-center gap-1 px-4">
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

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-3">
        <DdlPreviewBody preview={preview} highlightedSql={highlightedSql} />
      </div>

      {isShowingLiveDdl(preview) && (
        <div className="px-5 pb-4 text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          Live updating as changes are detected
        </div>
      )}
    </DesignerPanel>
  )
}
