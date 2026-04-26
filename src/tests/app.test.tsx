import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App'
import { useConnectionStore } from '../stores/connection-store'

const startPeriodicCheck = vi.fn().mockResolvedValue(undefined)
const stopPeriodicCheck = vi.fn()

vi.mock('../stores/update-store', () => ({
  useUpdateStore: Object.assign(
    (selector?: (state: { status: string }) => unknown) =>
      selector ? selector({ status: 'idle' }) : { status: 'idle' },
    {
      getState: () => ({
        startPeriodicCheck,
        stopPeriodicCheck,
      }),
    }
  ),
}))

beforeEach(() => {
  startPeriodicCheck.mockClear()
  stopPeriodicCheck.mockClear()
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

  it('starts periodic update checks on mount and stops them on unmount', () => {
    const { unmount } = render(<App />)

    expect(startPeriodicCheck).toHaveBeenCalledTimes(1)

    unmount()
    expect(stopPeriodicCheck).toHaveBeenCalledTimes(1)
  })
})
