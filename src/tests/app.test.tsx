import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import App from '../App'
import { useConnectionStore } from '../stores/connection-store'
import { useUpdateStore } from '../stores/update-store'

beforeEach(() => {
  act(() => {
    useConnectionStore.setState({
      activeConnections: {},
      activeTabId: null,
      dialogOpen: false,
      error: null,
    })
  })
})

describe('App', () => {
  it('renders the application layout', () => {
    render(<App />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('starts periodic update checks on mount and stops them on unmount', () => {
    const startPeriodicCheck = vi.fn().mockResolvedValue(undefined)
    const stopPeriodicCheck = vi.fn()

    act(() => {
      useUpdateStore.setState({
        startPeriodicCheck,
        stopPeriodicCheck,
      })
    })

    const { unmount } = render(<App />)

    expect(startPeriodicCheck).toHaveBeenCalledTimes(1)

    unmount()
    expect(stopPeriodicCheck).toHaveBeenCalledTimes(1)
  })
})
