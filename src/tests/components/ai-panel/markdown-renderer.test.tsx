import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownRenderer } from '../../../components/ai-panel/markdown-renderer'
import { AiCodeBlock } from '../../../components/ai-panel/AiCodeBlock'

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('MarkdownRenderer', () => {
  it('renders with data-testid="markdown-renderer"', () => {
    render(<MarkdownRenderer content="Hello" />)
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()
  })

  it('renders markdown content', () => {
    render(<MarkdownRenderer content="Test content" />)
    // The global react-markdown mock in setup.ts renders children as text
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('accepts onTriggerDiff prop without error', () => {
    const onTriggerDiff = vi.fn()
    render(<MarkdownRenderer content="Hello" onTriggerDiff={onTriggerDiff} />)
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()
  })

  it('renders empty content without error', () => {
    render(<MarkdownRenderer content="" />)
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()
  })

  it('renders complex markdown content', () => {
    const content = '# Hello\n\nSome **bold** text'
    render(<MarkdownRenderer content={content} />)
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()
  })

  it('accepts showDiffButton prop', () => {
    render(<MarkdownRenderer content="test" showDiffButton={true} />)
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()
  })

  it('renders without showDiffButton', () => {
    render(<MarkdownRenderer content="test" showDiffButton={false} />)
    expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument()
  })

  it('AiCodeBlock renders with data-testid="ai-code-block" when given language and children', () => {
    // Verify AiCodeBlock (used by MarkdownRenderer for code fences) renders the
    // expected structure when rendered directly.
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" onTriggerDiff={onTriggerDiff} showDiffButton={true}>
        SELECT 1
      </AiCodeBlock>
    )
    expect(screen.getByTestId('ai-code-block')).toBeInTheDocument()
    // Copy button is always present
    expect(screen.getByTestId('ai-code-copy-button')).toBeInTheDocument()
    // Diff button is shown for single-statement SQL with showDiffButton=true
    expect(screen.getByTestId('ai-code-diff-button')).toBeInTheDocument()
  })
})
