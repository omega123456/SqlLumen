import { Copy } from '@phosphor-icons/react'
import { useCallback, useMemo } from 'react'
import type { TableMetadata, ObjectType } from '../../types/schema'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'
import { SQL_HIGHLIGHT_CLASS_NAMES } from '../../lib/sql-highlight-class-names'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { Button } from '../common/Button'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import { MetadataCard } from './MetadataCard'
import { SchemaPanel } from './SchemaTableParts'
import { toErrorMessage } from '../../lib/error-message'

export interface DdlPanelProps {
  ddl: string
  metadata?: TableMetadata | null
  objectType: ObjectType
}

export function DdlPanel({ ddl, metadata, objectType }: DdlPanelProps) {
  const isTable = objectType === 'table'
  const highlightedSql = useMemo(
    () => SqlSyntaxHighlighter.highlightSql(ddl, SQL_HIGHLIGHT_CLASS_NAMES),
    [ddl]
  )

  const handleCopy = useCallback(async () => {
    try {
      await writeClipboardText(ddl)
      showSuccessToast('Copied to clipboard')
    } catch (error) {
      const message = toErrorMessage(error)
      showErrorToast('Copy failed', message)
    }
  }, [ddl])

  const codePanel = (
    <ElevatedCodePanel
      surfaceVariant="recessed"
      preSpacing="listing"
      headerVariant="strip"
      label={isTable ? 'SHOW CREATE TABLE' : 'DDL'}
      headerActions={
        <Button variant="subtle" size="sm" onClick={() => void handleCopy()}>
          <Copy size={16} weight="regular" />
          Copy SQL
        </Button>
      }
    >
      {highlightedSql}
    </ElevatedCodePanel>
  )

  if (isTable && metadata) {
    return (
      <SchemaPanel data-testid="ddl-panel">
        <div className="grid grid-cols-ddl-split items-start gap-4">
          <div className="min-w-0">{codePanel}</div>
          <div className="min-w-0">
            <MetadataCard metadata={metadata} />
          </div>
        </div>
      </SchemaPanel>
    )
  }

  return (
    <SchemaPanel data-testid="ddl-panel">
      <div className="w-full">{codePanel}</div>
    </SchemaPanel>
  )
}
