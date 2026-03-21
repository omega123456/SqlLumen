import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDatabaseEncoding } from '../../hooks/useDatabaseEncoding'

// Mock schema-commands
vi.mock('../../lib/schema-commands', () => ({
  listCharsets: vi.fn(),
  listCollations: vi.fn(),
}))

import { listCharsets, listCollations } from '../../lib/schema-commands'

const mockListCharsets = vi.mocked(listCharsets)
const mockListCollations = vi.mocked(listCollations)

const CHARSETS = [
  {
    charset: 'utf8mb4',
    description: 'UTF-8 Unicode',
    defaultCollation: 'utf8mb4_general_ci',
    maxLength: 4,
  },
  {
    charset: 'latin1',
    description: 'Latin 1',
    defaultCollation: 'latin1_swedish_ci',
    maxLength: 1,
  },
]

const COLLATIONS = [
  { name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: true },
  { name: 'utf8mb4_unicode_ci', charset: 'utf8mb4', isDefault: false },
  { name: 'latin1_swedish_ci', charset: 'latin1', isDefault: true },
  { name: 'latin1_bin', charset: 'latin1', isDefault: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockListCharsets.mockResolvedValue(CHARSETS)
  mockListCollations.mockResolvedValue(COLLATIONS)
})

describe('useDatabaseEncoding', () => {
  it('fetches charsets and collations when isOpen is true', async () => {
    const { result } = renderHook(() => useDatabaseEncoding('conn-1', true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mockListCharsets).toHaveBeenCalledWith('conn-1')
    expect(mockListCollations).toHaveBeenCalledWith('conn-1')
    expect(result.current.charsets).toEqual(CHARSETS)
    expect(result.current.collations).toEqual(COLLATIONS)
  })

  it('does not fetch when isOpen is false', () => {
    renderHook(() => useDatabaseEncoding('conn-1', false))

    expect(mockListCharsets).not.toHaveBeenCalled()
    expect(mockListCollations).not.toHaveBeenCalled()
  })

  it('starts with isLoading true when open', () => {
    // Make the mocks hang
    mockListCharsets.mockReturnValue(new Promise(() => {}))
    mockListCollations.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useDatabaseEncoding('conn-1', true))

    expect(result.current.isLoading).toBe(true)
  })

  it('sets error when fetch fails', async () => {
    mockListCharsets.mockRejectedValue(new Error('Connection lost'))

    const { result } = renderHook(() => useDatabaseEncoding('conn-1', true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBe('Connection lost')
  })

  it('uses initialCharset and initialCollation values', () => {
    const { result } = renderHook(() =>
      useDatabaseEncoding('conn-1', false, 'utf8mb4', 'utf8mb4_general_ci')
    )

    expect(result.current.charset).toBe('utf8mb4')
    expect(result.current.collation).toBe('utf8mb4_general_ci')
  })

  it('filters collations by selected charset', async () => {
    const { result } = renderHook(() => useDatabaseEncoding('conn-1', true, 'utf8mb4'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.filteredCollations).toHaveLength(2)
    expect(result.current.filteredCollations.every((c) => c.charset === 'utf8mb4')).toBe(true)
  })

  it('returns all collations when no charset is selected', async () => {
    const { result } = renderHook(() => useDatabaseEncoding('conn-1', true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // No charset set => filteredCollations returns all
    expect(result.current.filteredCollations).toEqual(COLLATIONS)
  })

  it('setCharset updates charset and resets collation to default', async () => {
    const { result } = renderHook(() => useDatabaseEncoding('conn-1', true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.setCharset('latin1')
    })

    expect(result.current.charset).toBe('latin1')
    expect(result.current.collation).toBe('latin1_swedish_ci')
  })

  it('setCharset with empty string clears both charset and collation', async () => {
    const { result } = renderHook(() =>
      useDatabaseEncoding('conn-1', true, 'utf8mb4', 'utf8mb4_general_ci')
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.setCharset('')
    })

    expect(result.current.charset).toBe('')
    expect(result.current.collation).toBe('')
  })

  it('setCollation updates collation directly', async () => {
    const { result } = renderHook(() =>
      useDatabaseEncoding('conn-1', true, 'utf8mb4', 'utf8mb4_general_ci')
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.setCollation('utf8mb4_unicode_ci')
    })

    expect(result.current.collation).toBe('utf8mb4_unicode_ci')
  })

  it('applies initialCharset/initialCollation when they change', async () => {
    const { result, rerender } = renderHook(
      ({ charset, collation }: { charset?: string; collation?: string }) =>
        useDatabaseEncoding('conn-1', true, charset, collation),
      {
        initialProps: { charset: undefined, collation: undefined } as {
          charset?: string
          collation?: string
        },
      }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Initially no charset/collation
    expect(result.current.charset).toBe('')
    expect(result.current.collation).toBe('')

    // Simulate setting initial values (like AlterDatabaseDialog does after fetching details)
    rerender({ charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' })

    expect(result.current.charset).toBe('utf8mb4')
    expect(result.current.collation).toBe('utf8mb4_unicode_ci')
  })

  it('cancels fetch when unmounted during load', async () => {
    // Use a delayed mock that we can control
    let resolveCharsets: ((value: typeof CHARSETS) => void) | undefined
    mockListCharsets.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCharsets = resolve
        })
    )

    const { unmount } = renderHook(() => useDatabaseEncoding('conn-1', true))

    // Unmount before the fetch resolves
    unmount()

    // Resolve after unmount — should not throw
    if (resolveCharsets) resolveCharsets(CHARSETS)

    // No assertion needed — just ensuring no errors/warnings from state updates after unmount
  })
})
