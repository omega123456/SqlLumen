import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBar } from '../../components/layout/StatusBar'

describe('StatusBar', () => {
  it('renders the Ready status text', () => {
    render(<StatusBar />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })
})
