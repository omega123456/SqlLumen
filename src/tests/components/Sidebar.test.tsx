import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from '../../components/layout/Sidebar'

describe('Sidebar', () => {
  it('renders the empty state message', () => {
    render(<Sidebar />)
    expect(screen.getByText('No active connection')).toBeInTheDocument()
  })
})
