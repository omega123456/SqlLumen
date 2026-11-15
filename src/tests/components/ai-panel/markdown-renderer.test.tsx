import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownRenderer } from '../../../components/ai-panel/markdown-renderer'

vi.unmock('react-markdown')
vi.unmock('remark-gfm')
vi.unmock('rehype-highlight')

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6]

describe('MarkdownRenderer elements', () => {
  it.each(HEADING_LEVELS)('renders a level %i heading', (level) => {
    render(<MarkdownRenderer content={`${'#'.repeat(level)} Title ${level}`} />)

    expect(
      screen.getByRole('heading', { level: level, name: `Title ${level}` })
    ).toBeInTheDocument()
  })

  it('renders paragraphs with inline code', () => {
    render(<MarkdownRenderer content={'Use `LIMIT 10` here'} />)

    const inlineCode = screen.getByText('LIMIT 10')
    expect(inlineCode.tagName).toBe('CODE')
    expect(inlineCode.closest('p')).not.toBeNull()
  })

  it('renders nested bullet lists inside list items', () => {
    render(<MarkdownRenderer content={'- one\n  - nested\n- two'} />)

    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(2)
    expect(within(lists[0]).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the start number of ordered lists', () => {
    render(<MarkdownRenderer content={'3. third\n4. fourth'} />)

    expect(screen.getByRole('list')).toHaveAttribute('start', '3')
  })

  it('renders tables with header and body cells and their alignment', () => {
    render(<MarkdownRenderer content={'| Name | Count |\n|------|------:|\n| a | 1 |'} />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    expect(screen.getByRole('cell', { name: '1' })).toHaveStyle({ textAlign: 'right' })
  })

  it('renders fenced blocks without a language as plain code in a pre', () => {
    render(<MarkdownRenderer content={'```\nplain block\n```'} />)

    const code = screen.getByText('plain block')
    expect(code.tagName).toBe('CODE')
    expect(code.parentElement?.tagName).toBe('PRE')
  })

  it('renders fenced blocks with a language as an AI code block', () => {
    render(<MarkdownRenderer content={'```python\nprint(1)\n```'} />)

    expect(screen.getByTestId('ai-code-block')).toHaveTextContent('python')
  })
})
