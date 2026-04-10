import { useCallback } from 'react'
import type { TableMetadata, ObjectType } from '../../types/schema'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { tokenizeSql } from '../../lib/sql-tokenizer'
import type { TokenType } from '../../lib/sql-tokenizer'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { Button } from '../common/Button'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import { MetadataCard } from './MetadataCard'
import styles from './DdlPanel.module.css'

export interface DdlPanelProps {
  ddl: string
  metadata?: TableMetadata | null
  objectType: ObjectType
}

const TOKEN_CLASS_MAP: Record<TokenType, string | undefined> = {
  keyword: styles.keyword,
  string: styles.string,
  identifier: styles.identifier,
  comment: styles.comment,
  number: styles.number,
  plain: undefined,
}

export function DdlPanel({ ddl, metadata, objectType }: DdlPanelProps) {
  const tokens = tokenizeSql(ddl)
  const isTable = objectType === 'table'

  const handleCopy = useCallback(async () => {
    try {
      await writeClipboardText(ddl)
      showSuccessToast('Copied to clipboard')
    } catch (error) {
      console.error('[ddl-panel] Failed to copy SQL', error)
      showErrorToast('Copy failed', error instanceof Error ? error.message : String(error))
    }
  }, [ddl])

  return (
    <div className={styles.container} data-testid="ddl-panel">
      {isTable && metadata ? (
        <>
          <div className={styles.topSection}>
            <div className={styles.ddlColumn}>
              <ElevatedCodePanel
                label="&lt;&gt; SHOW CREATE TABLE"
                headerActions={
                  <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
                    Copy SQL
                  </Button>
                }
              >
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
              </ElevatedCodePanel>
            </div>
            <div className={styles.metadataColumn}>
              <MetadataCard metadata={metadata} />
            </div>
          </div>
        </>
      ) : (
        <div className={styles.ddlOnly}>
          <ElevatedCodePanel
            label="&lt;&gt; DDL"
            headerActions={
              <Button type="button" variant="secondary" onClick={() => void handleCopy()}>
                Copy SQL
              </Button>
            }
          >
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
          </ElevatedCodePanel>
        </div>
      )}
    </div>
  )
}
