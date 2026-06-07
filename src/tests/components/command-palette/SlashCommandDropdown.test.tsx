import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SlashCommandDropdown } from '../../../components/command-palette/SlashCommandDropdown'

describe('SlashCommandDropdown', () => {
  it('renders keyword and database sections and selects an option', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <SlashCommandDropdown
        slashQuery=""
        databases={['analytics', 'app_main']}
        activeIndex={0}
        onSelect={onSelect}
      />
    )

    expect(screen.getByText('Keywords')).toBeInTheDocument()
    expect(screen.getByText('Databases')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /Tables/i }))

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'object-type',
      value: 'table',
      label: 'Tables',
    })
  })

  it('filters slash options by the active token and shows an empty state when nothing matches', () => {
    const { rerender } = render(
      <SlashCommandDropdown
        slashQuery="ana"
        databases={['analytics', 'app_main']}
        activeIndex={0}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('option', { name: /analytics/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /app_main/i })).not.toBeInTheDocument()

    rerender(
      <SlashCommandDropdown
        slashQuery="zzz"
        databases={['analytics']}
        activeIndex={0}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByTestId('command-palette-slash-empty')).toHaveTextContent(
      'No slash commands match'
    )
  })
})
