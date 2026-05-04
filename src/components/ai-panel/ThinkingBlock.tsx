import { useState, useEffect, useRef } from 'react'
import { Brain, CaretRight, CaretDown } from '@phosphor-icons/react'
import styles from './ThinkingBlock.module.css'

export interface ThinkingBlockProps {
  content: string
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isStreaming || !contentRef.current) {
      return
    }

    contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [content, isStreaming])

  const handleToggle = () => {
    if (!isStreaming) {
      setIsOpen((prev) => !prev)
    }
  }

  const isExpanded = isStreaming || isOpen

  return (
    <div className={styles.container} data-testid="thinking-block">
      <button
        className={styles.header}
        onClick={handleToggle}
        data-testid="thinking-block-header"
        type="button"
      >
        <span className={styles.headerLabel}>
          <Brain size={14} />
          {isStreaming ? 'Thinking…' : 'Reasoning'}
        </span>
        {!isStreaming && (isOpen ? <CaretDown size={12} /> : <CaretRight size={12} />)}
      </button>
      {isExpanded && (
        <div ref={contentRef} className={styles.content} data-testid="thinking-block-content">
          <pre className={styles.pre}>
            {content}
            {isStreaming && <span className={styles.streamingCursor} aria-hidden="true" />}
          </pre>
        </div>
      )}
    </div>
  )
}
