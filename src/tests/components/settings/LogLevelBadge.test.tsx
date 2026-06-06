import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LogLevelBadge } from '../../../components/settings/LogLevelBadge'

describe('LogLevelBadge', () => {
  it('renders the normalized level text', () => {
    render(<LogLevelBadge level="warn" />)

    expect(screen.getByText('WARN')).toBeInTheDocument()
  })

  it('falls back to uppercase text for unknown levels', () => {
    render(<LogLevelBadge level="custom" />)

    expect(screen.getByText('CUSTOM')).toBeInTheDocument()
  })
})
