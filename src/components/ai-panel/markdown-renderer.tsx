import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import { AiCodeBlock } from './AiCodeBlock'

export interface MarkdownRendererProps {
  content: string
  onTriggerDiff?: (sql: string) => void
  showDiffButton?: boolean
}

/**
 * Renders markdown content with GFM support and syntax highlighting.
 *
 * Code blocks get rehype-highlight syntax classes and the hljs-theme.css
 * custom-property mapping automatically adapts to light/dark theme.
 *
 * SQL code blocks render as AiCodeBlock with copy + optional diff buttons.
 */
export function MarkdownRenderer({
  content,
  onTriggerDiff,
  showDiffButton,
}: MarkdownRendererProps) {
  const components: Components = {
    code({ className, children, ...rest }) {
      const match = /language-(\w+)/.exec(className ?? '')
      const isInline = !match && !className

      if (isInline) {
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        )
      }

      const language = match?.[1]

      return (
        <AiCodeBlock
          language={language}
          onTriggerDiff={onTriggerDiff}
          showDiffButton={showDiffButton}
        >
          {children}
        </AiCodeBlock>
      )
    },
  }

  return (
    <div data-testid="markdown-renderer">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  )
}
