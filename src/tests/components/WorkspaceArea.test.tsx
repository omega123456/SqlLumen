import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkspaceArea } from '../../components/layout/WorkspaceArea'

describe('WorkspaceArea', () => {
  it('renders the welcome message', () => {
    render(<WorkspaceArea />)
    expect(screen.getByText('Welcome!')).toBeInTheDocument()
    expect(screen.getByText('Connect to a MySQL server to get started')).toBeInTheDocument()
  })

  it('renders the New Connection button', () => {
    render(<WorkspaceArea />)
    expect(screen.getByText('+ New Connection')).toBeInTheDocument()
  })
})
