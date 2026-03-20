import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSystemTheme } from '../hooks/use-system-theme'
import { setupMatchMedia, setupMatchMediaWithListeners } from './helpers/mock-match-media'

const mockAddEventListener = vi.fn()
const mockRemoveEventListener = vi.fn()

beforeEach(() => {
  mockAddEventListener.mockClear()
  mockRemoveEventListener.mockClear()
  setupMatchMediaWithListeners(false, mockAddEventListener, mockRemoveEventListener)
})

describe('useSystemTheme', () => {
  it('returns "light" when system prefers light mode', () => {
    setupMatchMediaWithListeners(false, mockAddEventListener, mockRemoveEventListener)
    const { result } = renderHook(() => useSystemTheme())
    expect(result.current).toBe('light')
  })

  it('returns "dark" when system prefers dark mode', () => {
    setupMatchMediaWithListeners(true, mockAddEventListener, mockRemoveEventListener)
    const { result } = renderHook(() => useSystemTheme())
    expect(result.current).toBe('dark')
  })

  it('registers a change event listener on mount', () => {
    renderHook(() => useSystemTheme())
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('removes the event listener on unmount', () => {
    const { unmount } = renderHook(() => useSystemTheme())
    unmount()
    expect(mockRemoveEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('updates theme when media query change event fires', () => {
    setupMatchMedia(false)
    let capturedListener: ((e: MediaQueryListEvent) => void) | null = null

    mockAddEventListener.mockImplementation(
      (_event: string, listener: (e: MediaQueryListEvent) => void) => {
        capturedListener = listener
      }
    )

    setupMatchMediaWithListeners(false, mockAddEventListener, mockRemoveEventListener)

    const { result } = renderHook(() => useSystemTheme())
    expect(result.current).toBe('light')

    act(() => {
      capturedListener?.({ matches: true } as MediaQueryListEvent)
    })

    expect(result.current).toBe('dark')
  })
})
