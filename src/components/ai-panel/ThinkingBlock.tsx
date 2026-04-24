import { useState, useEffect, useRef } from 'react'
import { Brain, CaretRight, CaretDown } from '@phosphor-icons/react'
import styles from './ThinkingBlock.module.css'

export interface ThinkingBlockProps {
  content: string
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false)
  const prevStreamingRef = useRef(isStreaming)
  const contentRef = useRef<HTMLDivElement>(null)

  // While streaming, always show expanded; otherwise respect user toggle

  // Auto-collapse when streaming transitions from true to false
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setIsOpen(false)
    }
    prevStreamingRef.current = isStreaming
  }, [isStreaming])

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
      {(isStreaming || isOpen) && (
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
