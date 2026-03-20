import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App'
import { useConnectionStore } from '../stores/connection-store'

beforeEach(() => {
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
})

describe('App', () => {
  it('renders the application layout', () => {
    render(<App />)
    // Status bar should show "Ready" when no connections are active
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })
})
