import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KillSummaryDialog } from '../../../components/processlist/KillSummaryDialog'
import type { KillResult } from '../../../lib/processlist-commands'

describe('KillSummaryDialog', () => {
  it('renders nothing when results is null', () => {
    const { container } = render(<KillSummaryDialog results={null} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows failures', () => {
    const results: KillResult[] = [
      { id: 1, success: true, error: null },
      { id: 2, success: false, error: 'Process not found' },
    ]
    render(<KillSummaryDialog results={results} onClose={vi.fn()} />)
    expect(screen.getByText('1 process killed successfully')).toBeInTheDocument()
    expect(screen.getByText(/ID 2: Process not found/)).toBeInTheDocument()
  })
})
