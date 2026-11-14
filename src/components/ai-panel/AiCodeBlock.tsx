import { useState, useCallback, useMemo, type ReactNode } from 'react'
import { Copy, GitDiff } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { splitStatements } from '../query-editor/sql-parser-utils'
import styles from './AiCodeBlock.module.css'

import { logFrontendError } from '../../lib/app-log-commands'

const COPIED_FEEDBACK_DURATION_MS = 2000
const SQL_LANGUAGE_LABEL = 'SQL'
const FALLBACK_LANGUAGE_LABEL = 'code'

interface ElementWithChildren {
  props: { children?: ReactNode }
}

function isElementWithChildren(node: ReactNode): node is ReactNode & ElementWithChildren {
  return typeof node === 'object' && node !== null && 'props' in node
}

function codeLanguageLabel(language: string | undefined, isSql: boolean): string {
  if (isSql) return SQL_LANGUAGE_LABEL
  return language ?? FALLBACK_LANGUAGE_LABEL
}

function codeLanguageClassName(language: string | undefined): string | undefined {
  return language ? `language-${language}` : undefined
}

interface CopyCodeButtonProps {
  copied: boolean
  onCopy: () => void
}

function CopyCodeButton({ copied, onCopy }: CopyCodeButtonProps) {
  const copiedLabel = 'Copied!'
  return (
    <Button
      variant="subtleMuted"
      size="sm"
      onClick={onCopy}
      title={copied ? copiedLabel : 'Copy code'}
      aria-label={copied ? copiedLabel : 'Copy SQL'}
      data-testid="ai-code-copy-button"
    >
      <Copy size={16} />
      {copied ? copiedLabel : 'Copy'}
    </Button>
  )
}

export interface AiCodeBlockProps {
  language?: string
  children: ReactNode
  onTriggerDiff?: (sql: string) => void
  showDiffButton?: boolean
  onSqlAccepted?: (sql: string) => void
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isElementWithChildren(node)) {
    return extractText(node.props.children)
  }
  return ''
}

function DiffButton({ onDiff }: { onDiff: () => void }) {
  return (
    <Button
      variant="subtleMuted"
      size="sm"
      onClick={onDiff}
      title="View diff"
      aria-label="View diff"
      data-testid="ai-code-diff-button"
    >
      <GitDiff size={16} />
      Diff
    </Button>
  )
}

export function AiCodeBlock({
  language,
  children,
  onTriggerDiff,
  showDiffButton = false,
  onSqlAccepted,
}: AiCodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const getTextContent = useCallback((): string => extractText(children), [children])

  const isSql = language === 'sql' || language === 'mysql'

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
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_DURATION_MS)
    } catch (error) {
      logFrontendError('[ai-panel] Failed to copy code:', error)
    }
  }, [getTextContent])

  const handleDiff = useCallback(() => {
    if (!onTriggerDiff) return
    const text = getTextContent()
    onTriggerDiff(text)
    notifyAccepted(text)
  }, [onTriggerDiff, getTextContent, notifyAccepted])

  const canShowDiff = Boolean(showDiffButton && isSql && isSingleStatement && onTriggerDiff)

  return (
    <div className={styles.codeBlock} data-testid="ai-code-block">
      <div className={styles.header}>
        <span className={styles.language}>{codeLanguageLabel(language, isSql)}</span>
        <div className={styles.actions}>
          {canShowDiff && <DiffButton onDiff={handleDiff} />}
          <CopyCodeButton copied={copied} onCopy={handleCopy} />
        </div>
      </div>
      <pre className={styles.pre}>
        <code className={codeLanguageClassName(language)}>{children}</code>
      </pre>
    </div>
  )
}
