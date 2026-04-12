import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { MarkdownRenderer } from '../../../components/ai-panel/markdown-renderer'

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
  setupMockIPC()
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
})
