import { useState, useCallback, useMemo, type ReactNode } from 'react'
import { Copy, GitDiff } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { splitStatements } from '../query-editor/sql-parser-utils'
import { logFrontendError } from '../../lib/app-log-commands'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'

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

interface CodeBlockHeaderProps {
  label: string
  children: ReactNode
}

function CodeBlockHeader({ label, children }: CodeBlockHeaderProps) {
  return (
    <div className="flex h-8.5 items-center gap-0.5 border-b border-light-stroke-divider bg-light-surface-container-high pr-1 pl-3 dark:border-dark-stroke-divider dark:bg-dark-surface-container-high">
      <span className="flex-1 font-body text-size-caption leading-5 text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {label}
      </span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  )
}

interface CodeBlockBodyProps {
  language: string | undefined
  children: ReactNode
}

function CodeBlockBody({ language, children }: CodeBlockBodyProps) {
  return (
    <pre
      className={joinClassNames([
        'overflow-x-auto px-3 py-2.5 font-mono text-size-code-block leading-4.75 whitespace-pre-wrap text-light-token-text dark:text-dark-token-text',
        SCROLLBAR,
      ])}
    >
      <code className={joinClassNames(['font-mono', codeLanguageClassName(language)])}>
        {children}
      </code>
    </pre>
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
    <div
      className="overflow-hidden rounded-card border border-light-stroke-card bg-light-surface-container-lowest font-body whitespace-normal dark:border-dark-stroke-card dark:bg-dark-surface-container-lowest"
      data-testid="ai-code-block"
    >
      <CodeBlockHeader label={codeLanguageLabel(language, isSql)}>
        {canShowDiff && <DiffButton onDiff={handleDiff} />}
        <CopyCodeButton copied={copied} onCopy={handleCopy} />
      </CodeBlockHeader>
      <CodeBlockBody language={language}>{children}</CodeBlockBody>
    </div>
  )
}
