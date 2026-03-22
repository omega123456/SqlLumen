import { useCallback } from 'react'
import type { ColumnInfo, TableMetadata, ObjectType } from '../../types/schema'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { tokenizeSql } from '../../lib/sql-tokenizer'
import type { TokenType } from '../../lib/sql-tokenizer'
import { ElevatedSurface } from '../common/ElevatedSurface'
import { MetadataCard } from './MetadataCard'
import { ColumnsPanel } from './ColumnsPanel'
import styles from './DdlPanel.module.css'

export interface DdlPanelProps {
  ddl: string
  metadata?: TableMetadata | null
  objectType: ObjectType
  columns?: ColumnInfo[]
}

const TOKEN_CLASS_MAP: Record<TokenType, string | undefined> = {
  keyword: styles.keyword,
  string: styles.string,
  identifier: styles.identifier,
  comment: styles.comment,
  number: styles.number,
  plain: undefined,
}

export function DdlPanel({ ddl, metadata, objectType, columns }: DdlPanelProps) {
  const tokens = tokenizeSql(ddl)
  const isTable = objectType === 'table'

  const handleCopy = useCallback(() => {
    void writeClipboardText(ddl)
  }, [ddl])

  return (
    <div className={styles.container} data-testid="ddl-panel">
      {isTable && metadata ? (
        <>
          <div className={styles.topSection}>
            <div className={styles.ddlColumn}>
              <div className={styles.codeHeader}>
                <span className={styles.codeLabel}>&lt;&gt; SHOW CREATE TABLE</span>
                <button type="button" className={styles.copyButton} onClick={handleCopy}>
                  Copy SQL
                </button>
              </div>
              <pre className={styles.codeBlock}>
                <code>
                  {tokens.map((token, idx) => {
                    const cls = TOKEN_CLASS_MAP[token.type]
                    return cls ? (
                      <span key={idx} className={cls}>
                        {token.text}
                      </span>
                    ) : (
                      <span key={idx}>{token.text}</span>
                    )
                  })}
                </code>
              </pre>
            </div>
            <div className={styles.metadataColumn}>
              <MetadataCard metadata={metadata} />
            </div>
          </div>
          {columns && columns.length > 0 && (
            <ElevatedSurface className={styles.columnsSection}>
              <div className={styles.columnsSectionHeader}>
                <span className={styles.columnsSectionTitle}>Columns Definition</span>
                <span className={styles.columnsSectionCount}>{columns.length} COLUMNS</span>
              </div>
              <ColumnsPanel columns={columns} embedded />
            </ElevatedSurface>
          )}
        </>
      ) : (
        <div className={styles.ddlOnly}>
          <div className={styles.codeHeader}>
            <span className={styles.codeLabel}>&lt;&gt; DDL</span>
            <button type="button" className={styles.copyButton} onClick={handleCopy}>
              Copy SQL
            </button>
          </div>
          <pre className={styles.codeBlock}>
            <code>
              {tokens.map((token, idx) => {
                const cls = TOKEN_CLASS_MAP[token.type]
                return cls ? (
                  <span key={idx} className={cls}>
                    {token.text}
                  </span>
                ) : (
                  <span key={idx}>{token.text}</span>
                )
              })}
            </code>
          </pre>
        </div>
      )}
    </div>
  )
}
