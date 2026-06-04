import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  useAiMemoryStore,
  initAiMemoryStore,
  _resetAiMemoryStoreForTest,
} from '../../stores/ai-memory-store'
import { useSettingsStore } from '../../stores/settings-store'

describe('ai-memory-store', () => {
  beforeEach(() => {
    useAiMemoryStore.setState({ reembedStatus: {} })
  })

  it('initial state has empty reembedStatus', () => {
    const state = useAiMemoryStore.getState()
    expect(state.reembedStatus).toEqual({})
  })

  it('setReembedStatus sets running status keyed by owner', () => {
    useAiMemoryStore.getState().setReembedStatus('global', {
      status: 'running',
      done: 3,
      total: 10,
    })
    const status = useAiMemoryStore.getState().reembedStatus['global']
    expect(status).toEqual({ status: 'running', done: 3, total: 10 })
  })

  it('setReembedStatus resets to idle', () => {
    useAiMemoryStore.getState().setReembedStatus('group_g1', {
      status: 'running',
      done: 5,
      total: 10,
    })
    useAiMemoryStore.getState().setReembedStatus('group_g1', {
      status: 'idle',
      done: 0,
      total: 0,
    })
    const status = useAiMemoryStore.getState().reembedStatus['group_g1']
    expect(status.status).toBe('idle')
  })
})

describe('initAiMemoryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetAiMemoryStoreForTest()
    useAiMemoryStore.setState({ reembedStatus: {} })
    ipc.override('reembed_all_memories', () => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is idempotent — second call is a no-op', async () => {
    let updates = 0
    const unsubscribe = useAiMemoryStore.subscribe(() => {
      updates += 1
    })

    initAiMemoryStore()
    initAiMemoryStore()

    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'global',
      phase: 'embedding',
      done: 1,
      total: 5,
    })

    unsubscribe()

    expect(updates).toBe(1)
    expect(useAiMemoryStore.getState().reembedStatus['global']).toEqual({
      status: 'running',
      done: 1,
      total: 5,
    })
  })

  it('registers event listener via listen — verifies via event delivery', async () => {
    initAiMemoryStore()

    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'group_g2',
      phase: 'embedding',
      done: 3,
      total: 7,
    })
    const status = useAiMemoryStore.getState().reembedStatus['group_g2']
    expect(status).toEqual({ status: 'running', done: 3, total: 7 })
  })

  it('handles embedding phase event', async () => {
    initAiMemoryStore()
    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'conn-1',
      phase: 'embedding',
      done: 2,
      total: 5,
    })
    const status = useAiMemoryStore.getState().reembedStatus['conn-1']
    expect(status).toEqual({ status: 'running', done: 2, total: 5 })
  })

  it('handles error phase event', async () => {
    initAiMemoryStore()
    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'conn-1',
      phase: 'error',
      done: 0,
      total: 0,
      error: 'test error',
    })
    const status = useAiMemoryStore.getState().reembedStatus['conn-1']
    expect(status).toEqual({ status: 'idle', done: 0, total: 0 })
  })

  it('handles done phase event with delayed reset', async () => {
    initAiMemoryStore()
    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'conn-1',
      phase: 'embedding',
      done: 5,
      total: 5,
    })
    expect(useAiMemoryStore.getState().reembedStatus['conn-1']?.status).toBe('running')

    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'conn-1',
      phase: 'done',
      done: 5,
      total: 5,
    })
    // Still running — timer hasn't fired
    expect(useAiMemoryStore.getState().reembedStatus['conn-1']?.status).toBe('running')

    vi.advanceTimersByTime(2000)
    const status = useAiMemoryStore.getState().reembedStatus['conn-1']
    expect(status).toEqual({ status: 'idle', done: 0, total: 0 })
  })

  it('cancelResetTimer clears previous done timer on new event', async () => {
    initAiMemoryStore()
    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'conn-1',
      phase: 'done',
      done: 5,
      total: 5,
    })
    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'conn-1',
      phase: 'embedding',
      done: 1,
      total: 10,
    })
    vi.advanceTimersByTime(3000)
    const status = useAiMemoryStore.getState().reembedStatus['conn-1']
    expect(status).toEqual({ status: 'running', done: 1, total: 10 })
  })

  it('skips listen when hasTauriApis is false — event does not update state', async () => {
    const saved = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__

    initAiMemoryStore()

    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = saved

    await ipc.emit('ai-memory-reembed-progress', {
      ownerKey: 'conn-1',
      phase: 'embedding',
      done: 2,
      total: 5,
    })
    expect(useAiMemoryStore.getState().reembedStatus['conn-1']).toBeUndefined()
  })

  it('model change triggers a single reembedAllMemories call', async () => {
    vi.useRealTimers()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-a' },
    } as never)

    initAiMemoryStore()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-b' },
    } as never)

    await new Promise((r) => setTimeout(r, 50))
    expect(ipc.calls('reembed_all_memories')).toHaveLength(1)
  })

  it('model change does not trigger when new model is null', async () => {
    vi.useRealTimers()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-a' },
    } as never)

    initAiMemoryStore()
    ipc.reset()
    ipc.override('reembed_all_memories', () => undefined)

    useSettingsStore.setState({ settings: {} } as never)

    await new Promise((r) => setTimeout(r, 50))
    expect(ipc.calls('reembed_all_memories')).toHaveLength(0)
  })

  it('model change handles reembed error gracefully', async () => {
    vi.useRealTimers()
    ipc.override('reembed_all_memories', () => {
      throw new Error('network error')
    })

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-a' },
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
