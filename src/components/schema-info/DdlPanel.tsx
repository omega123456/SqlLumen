import { Copy } from '@phosphor-icons/react'
import { useCallback, useMemo } from 'react'
import type { TableMetadata, ObjectType } from '../../types/schema'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import sqlHighlightStyles from '../../styles/sql-syntax-highlight.module.css'
import { Button } from '../common/Button'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import { MetadataCard } from './MetadataCard'
import styles from './DdlPanel.module.css'

export interface DdlPanelProps {
  ddl: string
  metadata?: TableMetadata | null
  objectType: ObjectType
}

export function DdlPanel({ ddl, metadata, objectType }: DdlPanelProps) {
  const isTable = objectType === 'table'
  const highlightedSql = useMemo(
    () =>
      SqlSyntaxHighlighter.highlightSql(ddl, {
        keyword: sqlHighlightStyles.keyword,
        identifier: sqlHighlightStyles.identifier,
        type: sqlHighlightStyles.type,
        string: sqlHighlightStyles.string,
        number: sqlHighlightStyles.number,
      }),
    [ddl]
  )

  const handleCopy = useCallback(async () => {
    try {
      await writeClipboardText(ddl)
      showSuccessToast('Copied to clipboard')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast('Copy failed', message)
    }
  }, [ddl])

  const codePanel = (
    <ElevatedCodePanel
      className={styles.codePanel}
      preClassName={styles.ddl}
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

  return (
    <div className={styles.container} data-testid="ddl-panel">
      {isTable && metadata ? (
        <>
          <div className={styles.topSection}>
            <div className={styles.ddlColumn}>{codePanel}</div>
            <div className={styles.metadataColumn}>
              <MetadataCard metadata={metadata} />
            </div>
          </div>
        </>
      ) : (
        <div className={styles.ddlOnly}>{codePanel}</div>
      )}
    </div>
  )
}
