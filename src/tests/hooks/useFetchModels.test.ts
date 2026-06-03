import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFetchModels } from '../../hooks/useFetchModels'
import { ipc } from '../ipc-mock'

const MODELS = [
  { id: 'chat-1', name: 'Chat One', category: 'chat' },
  { id: 'embed-1', name: 'Embed One', category: 'embedding' },
]

beforeEach(() => {
  vi.clearAllMocks()
  ipc.override('list_ai_models', () => ({ models: MODELS }))
})

describe('useFetchModels', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => useFetchModels('http://localhost/v1'))

    expect(result.current.models).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('does not fetch when url is blank', async () => {
    const { result } = renderHook(() => useFetchModels('   '))

    await act(async () => {
      await result.current.fetch()
    })

    expect(ipc.calls('list_ai_models')).toEqual([])
    expect(result.current.models).toEqual([])
  })

  it('fetches and populates models', async () => {
    const { result } = renderHook(() => useFetchModels('http://localhost/v1'))

    await act(async () => {
      await result.current.fetch()
    })

    expect(ipc.calls('list_ai_models')).toEqual([{ endpoint: 'http://localhost/v1' }])
    expect(result.current.models).toEqual(MODELS)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('sets loading true while in flight', async () => {
    ipc.override('list_ai_models', () => new Promise(() => {}))
    const { result } = renderHook(() => useFetchModels('http://localhost/v1'))

    act(() => {
      void result.current.fetch()
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })
  })

  it('reports the error string returned by listAiModels', async () => {
    ipc.override('list_ai_models', () => {
      throw new Error('boom')
    })
    const { result } = renderHook(() => useFetchModels('http://localhost/v1'))

    await act(async () => {
      await result.current.fetch()
    })

    expect(result.current.error).toBe('boom')
    expect(result.current.loading).toBe(false)
  })

  it('reports "No models found" when the endpoint returns an empty list', async () => {
    ipc.override('list_ai_models', () => ({ models: [] }))
    const { result } = renderHook(() => useFetchModels('http://localhost/v1'))

    await act(async () => {
      await result.current.fetch()
    })

    expect(result.current.error).toBe('No models found at this endpoint.')
    expect(result.current.models).toEqual([])
  })

  it('ignores a stale fetch result when a newer fetch supersedes it', async () => {
    let resolveFirst: ((value: { models: typeof MODELS }) => void) | undefined
    ipc.override('list_ai_models', () => {
      if (!resolveFirst) {
        return new Promise<{ models: typeof MODELS }>((resolve) => {
          resolveFirst = resolve
        })
      }
      return { models: MODELS }
    })

    const { result } = renderHook(() => useFetchModels('http://localhost/v1'))

    // Kick off the first (slow) fetch, then a second (fast) fetch.
    let firstFetch: Promise<void>
    act(() => {
      firstFetch = result.current.fetch()
    })
    await act(async () => {
      await result.current.fetch()
    })

    expect(result.current.models).toEqual(MODELS)

    // Now resolve the stale first request with different data — it must be ignored.
    await act(async () => {
      resolveFirst?.({ models: [{ id: 'stale', name: 'Stale', category: 'chat' }] })
      await firstFetch
    })

    expect(result.current.models).toEqual(MODELS)
  })

  it('reset clears state and invalidates an in-flight fetch', async () => {
    let resolveFetch: ((value: { models: typeof MODELS }) => void) | undefined
    ipc.override(
      'list_ai_models',
      () =>
        new Promise<{ models: typeof MODELS }>((resolve) => {
          resolveFetch = resolve
        })
    )

    const { result } = renderHook(() => useFetchModels('http://localhost/v1'))

    let pending: Promise<void>
    act(() => {
      pending = result.current.fetch()
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    act(() => {
      result.current.reset()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.models).toEqual([])

    // The in-flight fetch resolving must not revive state.
    await act(async () => {
      resolveFetch?.({ models: MODELS })
      await pending
    })

    expect(result.current.models).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})
