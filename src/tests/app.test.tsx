import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App'

describe('App', () => {
  it('renders the application layout', () => {
    render(<App />)
    // Status bar should show "Ready"
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })
})
