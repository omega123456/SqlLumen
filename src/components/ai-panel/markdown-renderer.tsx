import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import { joinClassNames } from '../../lib/class-names'
import { AiCodeBlock } from './AiCodeBlock'
import { INLINE_CODE_CLASSES, MARKDOWN_ELEMENTS } from './markdown-elements'

export interface MarkdownRendererProps {
  content: string
  onTriggerDiff?: (sql: string) => void
  showDiffButton?: boolean
  onSqlAccepted?: (sql: string) => void
}

export function MarkdownRenderer({
  content,
  onTriggerDiff,
  showDiffButton,
  onSqlAccepted,
}: MarkdownRendererProps) {
  const components: Components = {
    ...MARKDOWN_ELEMENTS,
    code({ className, children, ...rest }) {
      const match = /language-(\w+)/.exec(className ?? '')
      const isInline = !match && !className

      if (isInline) {
        return (
          <code className={joinClassNames([INLINE_CODE_CLASSES, className])} {...rest}>
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
          onSqlAccepted={onSqlAccepted}
        >
          {children}
        </AiCodeBlock>
      )
    },
  }

  return (
    <div className="*:first:mt-0 *:last:mb-0" data-testid="markdown-renderer">
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
