import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { SlashCommandDropdown } from '../../../components/ai-panel/SlashCommandDropdown'
import type { SlashCommand } from '../../../lib/slash-commands'

const COMMANDS: SlashCommand[] = [
  { name: 'remember', description: 'Save a note to memory', execute: vi.fn() },
  { name: 'recall', description: 'Search memories', execute: vi.fn() },
]

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('SlashCommandDropdown', () => {
  it('renders command names and descriptions', () => {
    render(
      <SlashCommandDropdown
        commands={COMMANDS}
        highlightedIndex={-1}
        onSelect={vi.fn()}
        onHighlightChange={vi.fn()}
      />
    )
    expect(screen.getByText('/remember')).toBeInTheDocument()
    expect(screen.getByText('Save a note to memory')).toBeInTheDocument()
    expect(screen.getByText('/recall')).toBeInTheDocument()
  })

  it('highlights the item at highlightedIndex', () => {
    render(
      <SlashCommandDropdown
        commands={COMMANDS}
        highlightedIndex={0}
        onSelect={vi.fn()}
        onHighlightChange={vi.fn()}
      />
    )
    const item = screen.getByTestId('slash-command-item-remember')
    expect(item.getAttribute('aria-selected')).toBe('true')
  })

  it('calls onSelect when clicking an item', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <SlashCommandDropdown
        commands={COMMANDS}
        highlightedIndex={-1}
        onSelect={onSelect}
        onHighlightChange={vi.fn()}
      />
    )
    await user.click(screen.getByTestId('slash-command-item-recall'))
    expect(onSelect).toHaveBeenCalledWith(COMMANDS[1])
  })

  it('calls onHighlightChange on mouse enter', async () => {
    const user = userEvent.setup()
    const onHighlight = vi.fn()
    render(
      <SlashCommandDropdown
        commands={COMMANDS}
        highlightedIndex={-1}
        onSelect={vi.fn()}
        onHighlightChange={onHighlight}
      />
    )
    await user.hover(screen.getByTestId('slash-command-item-recall'))
    expect(onHighlight).toHaveBeenCalledWith(1)
  })

  it('has correct data-testid attributes', () => {
    render(
      <SlashCommandDropdown
        commands={COMMANDS}
        highlightedIndex={-1}
        onSelect={vi.fn()}
        onHighlightChange={vi.fn()}
      />
    )
    expect(screen.getByTestId('slash-command-dropdown')).toBeInTheDocument()
    expect(screen.getByTestId('slash-command-item-remember')).toBeInTheDocument()
    expect(screen.getByTestId('slash-command-item-recall')).toBeInTheDocument()
  })

  it('returns null when commands is empty', () => {
    const { container } = render(
      <SlashCommandDropdown
        commands={[]}
        highlightedIndex={-1}
        onSelect={vi.fn()}
        onHighlightChange={vi.fn()}
      />
    )
    expect(container.innerHTML).toBe('')
  })
})
