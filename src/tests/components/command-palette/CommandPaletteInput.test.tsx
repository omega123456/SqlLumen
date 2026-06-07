import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandPaletteInput } from '../../../components/command-palette/CommandPaletteInput'
import type { CommandPaletteFilterPillValue } from '../../../components/command-palette/CommandPalette'

describe('CommandPaletteInput', () => {
  it('renders pills inside the capsule and removes them through the pill action', async () => {
    const user = userEvent.setup()
    const onPillRemove = vi.fn()
    const pills: CommandPaletteFilterPillValue[] = [
      { kind: 'object-type', value: 'table', label: 'Tables' },
      { kind: 'database', value: 'analytics', label: 'analytics' },
    ]

    render(
      <CommandPaletteInput
        query="user"
        pills={pills}
        isSlashDropdownOpen={false}
        onQueryChange={vi.fn()}
        onQueryKeyDown={vi.fn()}
        onPillRemove={onPillRemove}
        inputRef={createRef()}
      />
    )

    expect(screen.getByTestId('command-palette-capsule')).toBeInTheDocument()
    expect(screen.getByTestId('command-palette-pill-type')).toHaveTextContent('Tables')
    expect(screen.getByTestId('command-palette-pill-database')).toHaveTextContent('analytics')

    await user.click(screen.getByRole('button', { name: 'Remove analytics filter' }))

    expect(onPillRemove).toHaveBeenCalledWith(pills[1])
  })

  it('keeps the input wired as a combobox and forwards query changes', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()

    render(
      <CommandPaletteInput
        query=""
        pills={[]}
        isSlashDropdownOpen
        onQueryChange={onQueryChange}
        onQueryKeyDown={vi.fn()}
        onPillRemove={vi.fn()}
        inputRef={createRef()}
        activeDescendantId="command-palette-result-0"
      />
    )

    const input = screen.getByTestId('command-palette-input')
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-result-0')

    await user.type(input, '/tab')

    expect(onQueryChange).toHaveBeenCalled()
  })
})
