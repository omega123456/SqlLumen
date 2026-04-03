import { Copy } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import styles from './DdlPreviewTab.module.css'

interface DdlPreviewTabProps {
  tabId: string
}

const KEYWORDS = new Set([
  'CREATE',
  'TABLE',
  'ALTER',
  'ADD',
  'DROP',
  'MODIFY',
  'COLUMN',
  'INDEX',
  'UNIQUE',
  'PRIMARY',
  'KEY',
  'FOREIGN',
  'REFERENCES',
  'ENGINE',
  'DEFAULT',
  'CHARSET',
  'COLLATE',
  'NOT',
  'NULL',
  'AUTO_INCREMENT',
  'CONSTRAINT',
])

const TYPES = new Set([
  'INT',
  'INTEGER',
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'BIGINT',
  'VARCHAR',
  'CHAR',
  'TEXT',
  'TINYTEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'BLOB',
  'TINYBLOB',
  'MEDIUMBLOB',
  'LONGBLOB',
  'DECIMAL',
  'NUMERIC',
  'FLOAT',
  'DOUBLE',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
  'YEAR',
  'JSON',
  'BOOLEAN',
  'BOOL',
  'ENUM',
  'SET',
])

function escapeRegexToken(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const keywordPattern = Array.from(KEYWORDS, escapeRegexToken).join('|')
const typePattern = Array.from(TYPES, escapeRegexToken).join('|')
const IDENTIFIER_PATTERN = '`[^`]+`'
const STRING_PATTERN = String.raw`'(?:[^'\\]|\\.)*'`
const TOKEN_REGEX = new RegExp(
  `(${IDENTIFIER_PATTERN}|${STRING_PATTERN}|\\b(?:${keywordPattern})\\b|\\b(?:${typePattern})\\b)`,
  'gi'
)

function renderToken(token: string, key: string): ReactNode {
  if (token.startsWith('`')) {
    return (
      <span key={key} className={`${styles.identifier} identifier`}>
        {token}
      </span>
    )
  }

  if (token.startsWith("'")) {
    return (
      <span key={key} className={`${styles.string} string`}>
        {token}
      </span>
    )
  }

  const normalizedToken = token.toUpperCase()

  if (KEYWORDS.has(normalizedToken)) {
    return (
      <span key={key} className={`${styles.keyword} keyword`}>
        {token}
      </span>
    )
  }

  if (TYPES.has(normalizedToken)) {
    return (
      <span key={key} className={`${styles.type} type`}>
        {token}
      </span>
    )
  }

  return token
}

function highlightSql(sql: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let matchIndex = 0

  for (const match of sql.matchAll(TOKEN_REGEX)) {
    const token = match[0]
    const index = match.index ?? 0

    if (index > lastIndex) {
      nodes.push(sql.slice(lastIndex, index))
    }

    nodes.push(renderToken(token, `token-${matchIndex}`))
    lastIndex = index + token.length
    matchIndex += 1
  }

  if (lastIndex < sql.length) {
    nodes.push(sql.slice(lastIndex))
  }

  return nodes
}

export function DdlPreviewTab({ tabId }: DdlPreviewTabProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])

  const ddl = tabState?.ddl ?? ''
  const isDdlLoading = tabState?.isDdlLoading ?? false
  const ddlError = tabState?.ddlError ?? null

  const highlightedSql = useMemo(() => highlightSql(ddl), [ddl])

  if (!tabState) {
    return null
  }

  const handleCopy = async () => {
    try {
      await writeClipboardText(ddl)
    } catch (error) {
      console.error('[ddl-preview-tab] Failed to copy DDL', error)
    }
  }

  return (
    <div className={styles.container} data-testid="table-designer-ddl-preview">
      <div className={styles.header}>
        <button
          type="button"
          className={styles.copyButton}
          onClick={() => {
            void handleCopy()
          }}
          disabled={ddl.trim() === ''}
          data-testid="ddl-preview-copy"
        >
          <Copy size={16} weight="bold" />
          <span>Copy to Clipboard</span>
        </button>
      </div>

      <div className={styles.body}>
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
      </div>

      {!isDdlLoading && !ddlError && (
        <div className={styles.footer}>Live updating as changes are detected</div>
      )}
    </div>
  )
}
