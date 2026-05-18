import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import App from '../App'
import { useConnectionStore } from '../stores/connection-store'
import { useSessionRestoreStore } from '../stores/session-restore-store'
import { useShortcutStore } from '../stores/shortcut-store'
import { useThemeStore } from '../stores/theme-store'
import { useUpdateStore } from '../stores/update-store'

beforeEach(() => {
  act(() => {
    useConnectionStore.setState({
      activeConnections: {},
      activeTabId: null,
      dialogOpen: false,
      error: null,
    })
    useThemeStore.setState({
      theme: 'light',
      resolvedTheme: 'light',
      initialize: vi.fn().mockResolvedValue(undefined),
      setTheme: vi.fn().mockResolvedValue(undefined),
    })
    useShortcutStore.setState({
      initializeFromBackend: vi.fn().mockResolvedValue(undefined),
    } as never)
    useSessionRestoreStore.setState({
      isRestoring: false,
      restoreError: null,
      restoreSession: vi.fn().mockResolvedValue(undefined),
    } as never)
    useConnectionStore.setState({
      setupEventListeners: vi.fn().mockResolvedValue(undefined),
    } as never)
    useUpdateStore.setState({
      startPeriodicCheck: vi.fn().mockResolvedValue(undefined),
      stopPeriodicCheck: vi.fn(),
      status: 'idle',
      availableVersion: null,
      downloadProgress: 0,
      errorMessage: null,
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
