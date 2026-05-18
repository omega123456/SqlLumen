import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownRenderer } from '../../../components/ai-panel/markdown-renderer'

vi.mock('../../../components/ai-panel/AiCodeBlock', () => ({
  AiCodeBlock: ({
    language,
    onTriggerDiff,
    showDiffButton,
    children,
  }: {
    language?: string
    onTriggerDiff?: (sql: string) => void
    showDiffButton?: boolean
    children: unknown
  }) => (
    <div data-testid="ai-code-block" data-language={language ?? ''}>
      <span data-testid="ai-code-children">{String(children)}</span>
      <span data-testid="ai-code-has-diff">{String(Boolean(onTriggerDiff))}</span>
      <span data-testid="ai-code-show-diff">{String(Boolean(showDiffButton))}</span>
    </div>
  ),
}))

vi.mock('react-markdown', async () => {
  const React = await import('react')
  return {
    default: ({
      children,
      components,
    }: {
      children: string
      components?: {
        code?: (props: { className?: string; children?: React.ReactNode }) => React.ReactNode
      }
    }) => {
      const codeMatch = /^```(\w+)\n([\s\S]*?)\n```$/m.exec(children)
      if (codeMatch && components?.code) {
        return React.createElement(
          'div',
          { 'data-testid': 'markdown' },
          components.code({
            className: `language-${codeMatch[1]}`,
            children: codeMatch[2],
          })
        )
      }

      return React.createElement('div', { 'data-testid': 'markdown' }, children)
    },
  }
})

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
    // The mocked react-markdown just renders children as text
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
    // With the mock, it just renders the raw string
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

  it('renders fenced code blocks through AiCodeBlock with extracted language and props', () => {
    const onTriggerDiff = vi.fn()
    render(
      <MarkdownRenderer
        content={'```sql\nSELECT 1\n```'}
        onTriggerDiff={onTriggerDiff}
        showDiffButton={true}
      />
    )

    expect(screen.getByTestId('ai-code-block')).toBeInTheDocument()
    expect(screen.getByTestId('ai-code-block')).toHaveAttribute('data-language', 'sql')
    expect(screen.getByTestId('ai-code-has-diff')).toHaveTextContent('true')
    expect(screen.getByTestId('ai-code-show-diff')).toHaveTextContent('true')
  })
})
