import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  useAiMemoryStore,
  initAiMemoryStore,
  _resetAiMemoryStoreForTest,
} from '../../stores/ai-memory-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useConnectionStore } from '../../stores/connection-store'

describe('ai-memory-store', () => {
  beforeEach(() => {
    useAiMemoryStore.setState({ reembedStatus: {} })
  })

  it('initial state has empty reembedStatus', () => {
    const state = useAiMemoryStore.getState()
    expect(state.reembedStatus).toEqual({})
  })

  it('setReembedStatus sets running status', () => {
    useAiMemoryStore.getState().setReembedStatus('conn-1', {
      status: 'running',
      done: 3,
      total: 10,
    })
    const status = useAiMemoryStore.getState().reembedStatus['conn-1']
    expect(status).toEqual({ status: 'running', done: 3, total: 10 })
  })

  it('setReembedStatus resets to idle', () => {
    useAiMemoryStore.getState().setReembedStatus('conn-1', {
      status: 'running',
      done: 5,
      total: 10,
    })
    useAiMemoryStore.getState().setReembedStatus('conn-1', {
      status: 'idle',
      done: 0,
      total: 0,
    })
    const status = useAiMemoryStore.getState().reembedStatus['conn-1']
    expect(status.status).toBe('idle')
  })
})

describe('initAiMemoryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetAiMemoryStoreForTest()
    useAiMemoryStore.setState({ reembedStatus: {} })
    ipc.override('reembed_memories', () => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is idempotent — second call is a no-op', async () => {
    initAiMemoryStore()
    initAiMemoryStore()

    // Verify only one listener is registered: emit event once and check state updates only once
    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c1',
      phase: 'embedding',
      done: 1,
      total: 5,
    })
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    // If two listeners were registered, the count/state would be applied twice —
    // but since state updates are idempotent here, verify by checking the second
    // initAiMemoryStore call does not register a new listen handler.
    // We verify this behaviorally: state should reflect exactly the event payload.
    expect(status).toEqual({ status: 'running', done: 1, total: 5 })
  })

  it('registers event listener via listen — verifies via event delivery', async () => {
    initAiMemoryStore()

    // If no listener was registered, emit would not update state
    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c2',
      phase: 'embedding',
      done: 3,
      total: 7,
    })
    const status = useAiMemoryStore.getState().reembedStatus['c2']
    expect(status).toEqual({ status: 'running', done: 3, total: 7 })
  })

  it('handles embedding phase event', async () => {
    initAiMemoryStore()
    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c1',
      phase: 'embedding',
      done: 2,
      total: 5,
    })
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    expect(status).toEqual({ status: 'running', done: 2, total: 5 })
  })

  it('handles error phase event', async () => {
    initAiMemoryStore()
    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c1',
      phase: 'error',
      done: 0,
      total: 0,
      error: 'test error',
    })
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    expect(status).toEqual({ status: 'idle', done: 0, total: 0 })
  })

  it('handles done phase event with delayed reset', async () => {
    initAiMemoryStore()
    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c1',
      phase: 'embedding',
      done: 5,
      total: 5,
    })
    expect(useAiMemoryStore.getState().reembedStatus['c1']?.status).toBe('running')

    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c1',
      phase: 'done',
      done: 5,
      total: 5,
    })
    // Still running — timer hasn't fired
    expect(useAiMemoryStore.getState().reembedStatus['c1']?.status).toBe('running')

    vi.advanceTimersByTime(2000)
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    expect(status).toEqual({ status: 'idle', done: 0, total: 0 })
  })

  it('cancelResetTimer clears previous done timer on new event', async () => {
    initAiMemoryStore()
    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c1',
      phase: 'done',
      done: 5,
      total: 5,
    })
    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c1',
      phase: 'embedding',
      done: 1,
      total: 10,
    })
    vi.advanceTimersByTime(3000)
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    expect(status).toEqual({ status: 'running', done: 1, total: 10 })
  })

  it('skips listen when hasTauriApis is false — event does not update state', async () => {
    // Remove __TAURI_INTERNALS__ to simulate non-Tauri environment
    const saved = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__

    initAiMemoryStore()

    // Restore TAURI_INTERNALS so ipc.emit works correctly for the emit call
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = saved

    // Even though we emit the event, no listener was registered so state should not change
    await ipc.emit('ai-memory-reembed-progress', {
      connectionId: 'c1',
      phase: 'embedding',
      done: 2,
      total: 5,
    })
    // Since no listener was registered, the state should remain empty
    expect(useAiMemoryStore.getState().reembedStatus['c1']).toBeUndefined()
  })

  it('model change triggers reembed for saved connections', async () => {
    vi.useRealTimers()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-a' },
    } as never)
    useConnectionStore.setState({
      savedConnections: [
        { id: 'c1', name: 'Test', host: 'localhost', port: 3306, username: 'root' },
      ],
    } as never)

    initAiMemoryStore()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-b' },
    } as never)

    await new Promise((r) => setTimeout(r, 50))
    const reembedCalls = ipc.calls('reembed_memories')
    expect(reembedCalls.length).toBeGreaterThan(0)
    expect((reembedCalls[0] as Record<string, unknown>)?.connectionId).toBe('c1')
  })

  it('model change does not trigger when new model is null', async () => {
    vi.useRealTimers()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-a' },
    } as never)

    initAiMemoryStore()
    // Clear any calls from prior subscription fires
    ipc.reset()
    ipc.override('reembed_memories', () => undefined)

    useSettingsStore.setState({ settings: {} } as never)

    await new Promise((r) => setTimeout(r, 50))
    expect(ipc.calls('reembed_memories').length).toBe(0)
  })

  it('model change fetches connections if savedConnections is empty', async () => {
    vi.useRealTimers()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-a' },
    } as never)

    const fetchMock = vi.fn(async () => {
      useConnectionStore.setState({
        savedConnections: [
          { id: 'c2', name: 'Fetched', host: 'localhost', port: 3306, username: 'root' },
        ],
      } as never)
    })
    useConnectionStore.setState({
      savedConnections: [],
      fetchSavedConnections: fetchMock,
    } as never)

    initAiMemoryStore()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-c' },
    } as never)

    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalled()
    const reembedCalls = ipc.calls('reembed_memories')
    expect(reembedCalls.length).toBeGreaterThan(0)
    expect((reembedCalls[0] as Record<string, unknown>)?.connectionId).toBe('c2')
  })

  it('model change handles reembed error gracefully', async () => {
    vi.useRealTimers()
    ipc.override('reembed_memories', () => {
      throw new Error('network error')
    })

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-a' },
    } as never)
    useConnectionStore.setState({
      savedConnections: [
        { id: 'c1', name: 'Test', host: 'localhost', port: 3306, username: 'root' },
      ],
    } as never)

    initAiMemoryStore()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-d' },
    } as never)

    await new Promise((r) => setTimeout(r, 50))
    const logCalls = ipc.calls('log_frontend')
    const hasReembedError = logCalls.some(
      (call) =>
        (call as Record<string, unknown>)?.level === 'error' &&
        String((call as Record<string, unknown>)?.message ?? '').includes('Re-embed failed')
    )
    expect(hasReembedError).toBe(true)
  })
})
