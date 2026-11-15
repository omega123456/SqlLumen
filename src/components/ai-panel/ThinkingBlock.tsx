import { useState, useEffect, useRef } from 'react'
import { Brain, CaretRight, CaretDown } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { FOCUS_RING } from '../../lib/focus-ring'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import { StreamingCursor } from './StreamingCursor'

export interface ThinkingBlockProps {
  content: string
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const contentElement = contentRef.current
    if (!isStreaming) return
    if (!contentElement) return

    contentElement.scrollTop = contentElement.scrollHeight
  }, [content, isStreaming])

  const handleToggle = () => {
    if (!isStreaming) {
      setIsOpen((previous) => !previous)
    }
  }

  const isExpanded = isStreaming || isOpen

  return (
    <div
      className="mb-2 overflow-hidden rounded-card border border-light-stroke-divider dark:border-dark-stroke-divider"
      data-testid="thinking-block"
    >
      <Button
        variant="bare"
        className={joinClassNames([
          'flex w-full cursor-pointer items-center gap-1 px-2 py-1 text-left text-size-caption leading-compact text-light-on-surface-variant select-none hover:bg-light-fill-subtle-hover dark:text-dark-on-surface-variant dark:hover:bg-dark-fill-subtle-hover',
          FOCUS_RING,
        ])}
        onClick={handleToggle}
        data-testid="thinking-block-header"
      >
        <span className="flex flex-1 items-center gap-1">
          <Brain size={14} />
          {isStreaming ? 'Thinking…' : 'Reasoning'}
        </span>
        {!isStreaming && (isOpen ? <CaretDown size={12} /> : <CaretRight size={12} />)}
      </Button>
      {isExpanded && (
        <div
          ref={contentRef}
          className={joinClassNames([
            'max-h-75 overflow-y-auto bg-light-surface-container-lowest px-3 py-2 dark:bg-dark-surface-container-lowest',
            SCROLLBAR,
          ])}
          data-testid="thinking-block-content"
        >
          <pre className="font-mono text-size-caption leading-body wrap-anywhere whitespace-pre-wrap text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {content}
            {isStreaming && <StreamingCursor />}
          </pre>
        </div>
      )}
    </div>
  )
}
