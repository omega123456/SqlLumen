import { useState, useCallback, useMemo, type ReactNode } from 'react'
import { Copy, GitDiff } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { splitStatements } from '../query-editor/sql-parser-utils'
import styles from './AiCodeBlock.module.css'

export interface AiCodeBlockProps {
  language?: string
  children: ReactNode
  onTriggerDiff?: (sql: string) => void
  showDiffButton?: boolean
  onSqlAccepted?: (sql: string) => void
}

export function AiCodeBlock({
  language,
  children,
  onTriggerDiff,
  showDiffButton = false,
  onSqlAccepted,
}: AiCodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const getTextContent = useCallback((): string => {
    if (typeof children === 'string') return children
    // Extract text from React elements recursively
    const extractText = (node: ReactNode): string => {
      if (typeof node === 'string') return node
      if (typeof node === 'number') return String(node)
      if (!node) return ''
      if (Array.isArray(node)) return node.map(extractText).join('')
      if (typeof node === 'object' && 'props' in node) {
        return extractText((node as { props: { children?: ReactNode } }).props.children)
      }
      return ''
    }
    return extractText(children)
  }, [children])

  const isSql = language === 'sql' || language === 'mysql'

  /** True when the SQL is exactly one statement (multi-statement diff is not supported). */
  const isSingleStatement = useMemo((): boolean => {
    if (!isSql) return false
    const text = getTextContent()
    if (!text.trim()) return false
    return splitStatements(text).length === 1
  }, [isSql, getTextContent])

  const notifyAccepted = useCallback(
    (text: string) => {
      if (isSql && onSqlAccepted) onSqlAccepted(text)
    },
    [isSql, onSqlAccepted]
  )

  const handleCopy = useCallback(async () => {
    try {
      const text = getTextContent()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('[ai-panel] Failed to copy code:', err)
    }
  }, [getTextContent])

  const handleDiff = useCallback(() => {
    if (!onTriggerDiff) return
    const text = getTextContent()
    onTriggerDiff(text)
    notifyAccepted(text)
  }, [onTriggerDiff, getTextContent, notifyAccepted])

  return (
    <div className={styles.codeBlock} data-testid="ai-code-block">
      <div className={styles.header}>
        <span className={styles.language}>{language ?? 'code'}</span>
        <div className={styles.actions}>
          {showDiffButton && isSql && isSingleStatement && onTriggerDiff && (
            <Button
              variant="ghost"
              className={styles.actionButton}
              onClick={handleDiff}
              title="View diff"
              aria-label="View diff"
              data-testid="ai-code-diff-button"
            >
              <GitDiff size={14} />
              <span className={styles.actionLabel}>Diff</span>
            </Button>
          )}
          <Button
            variant="ghost"
            className={styles.actionButton}
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy code'}
            aria-label={copied ? 'Copied!' : 'Copy SQL'}
            data-testid="ai-code-copy-button"
          >
            <Copy size={14} />
            <span className={styles.actionLabel}>{copied ? 'Copied!' : 'Copy'}</span>
          </Button>
        </div>
      </div>
      <pre className={styles.pre}>
        <code className={language ? `language-${language}` : undefined}>{children}</code>
      </pre>
    </div>
  )
}
