import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppLayout } from '../../components/layout/AppLayout'
import { useConnectionStore } from '../../stores/connection-store'

beforeEach(() => {
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
})

describe('AppLayout', () => {
  it('renders all four main sections', () => {
    render(<AppLayout />)
    // Status bar
    expect(screen.getByText('Ready')).toBeInTheDocument()
    // Sidebar empty state
    expect(screen.getByText('No active connection')).toBeInTheDocument()
    // Workspace welcome
    expect(screen.getByText('Welcome!')).toBeInTheDocument()
  })

  it('renders the theme toggle button', () => {
    render(<AppLayout />)
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('renders the New Connection button in workspace', () => {
    render(<AppLayout />)
    expect(screen.getByText('+ New Connection')).toBeInTheDocument()
  })
})
