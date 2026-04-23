import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { reembedMemories } from '../../lib/ai-memory-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { hasTauriApis } from '../../lib/tauri-env'
import {
  useAiMemoryStore,
  initAiMemoryStore,
  _resetAiMemoryStoreForTest,
} from '../../stores/ai-memory-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useConnectionStore } from '../../stores/connection-store'

// Keep reference to the listen callback so we can simulate events
let listenCallback: ((event: { payload: Record<string, unknown> }) => void) | null = null

vi.mock('../../lib/tauri-env', () => ({
  hasTauriApis: vi.fn(() => true),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_eventName: string, cb: (event: unknown) => void) => {
    listenCallback = cb as typeof listenCallback
    return Promise.resolve(() => {})
  }),
}))

vi.mock('../../lib/ai-memory-commands', () => ({
  reembedMemories: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../lib/app-log-commands', () => ({
  logFrontend: vi.fn(),
}))

const mockedListen = vi.mocked(listen)
const mockedHasTauriApis = vi.mocked(hasTauriApis)
const mockedReembedMemories = vi.mocked(reembedMemories)
const mockedLogFrontend = vi.mocked(logFrontend)

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
    listenCallback = null
    mockedListen.mockClear()
    mockedHasTauriApis.mockReturnValue(true)
    mockedReembedMemories.mockClear()
    mockedReembedMemories.mockResolvedValue(undefined as never)
    mockedLogFrontend.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is idempotent — second call is a no-op', () => {
    initAiMemoryStore()
    const callsAfterFirst = mockedListen.mock.calls.length
    initAiMemoryStore()
    expect(mockedListen.mock.calls.length).toBe(callsAfterFirst)
  })

  it('registers event listener via listen', () => {
    initAiMemoryStore()
    expect(mockedListen).toHaveBeenCalledWith('ai-memory-reembed-progress', expect.any(Function))
  })

  it('handles embedding phase event', () => {
    initAiMemoryStore()
    expect(listenCallback).not.toBeNull()
    listenCallback!({
      payload: { connectionId: 'c1', phase: 'embedding', done: 2, total: 5 },
    })
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    expect(status).toEqual({ status: 'running', done: 2, total: 5 })
  })

  it('handles error phase event', () => {
    initAiMemoryStore()
    listenCallback!({
      payload: { connectionId: 'c1', phase: 'error', done: 0, total: 0, error: 'test error' },
    })
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    expect(status).toEqual({ status: 'idle', done: 0, total: 0 })
  })

  it('handles done phase event with delayed reset', () => {
    initAiMemoryStore()
    listenCallback!({
      payload: { connectionId: 'c1', phase: 'embedding', done: 5, total: 5 },
    })
    expect(useAiMemoryStore.getState().reembedStatus['c1']?.status).toBe('running')

    listenCallback!({
      payload: { connectionId: 'c1', phase: 'done', done: 5, total: 5 },
    })
    // Still running — timer hasn't fired
    expect(useAiMemoryStore.getState().reembedStatus['c1']?.status).toBe('running')

    vi.advanceTimersByTime(2000)
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    expect(status).toEqual({ status: 'idle', done: 0, total: 0 })
  })

  it('cancelResetTimer clears previous done timer on new event', () => {
    initAiMemoryStore()
    listenCallback!({
      payload: { connectionId: 'c1', phase: 'done', done: 5, total: 5 },
    })
    listenCallback!({
      payload: { connectionId: 'c1', phase: 'embedding', done: 1, total: 10 },
    })
    vi.advanceTimersByTime(3000)
    const status = useAiMemoryStore.getState().reembedStatus['c1']
    expect(status).toEqual({ status: 'running', done: 1, total: 10 })
  })

  it('skips listen when hasTauriApis is false', () => {
    mockedHasTauriApis.mockReturnValue(false)
    initAiMemoryStore()
    expect(mockedListen).not.toHaveBeenCalled()
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
    expect(mockedReembedMemories).toHaveBeenCalledWith({ connectionId: 'c1' })
  })

  it('model change does not trigger when new model is null', async () => {
    vi.useRealTimers()

    useSettingsStore.setState({
      settings: { 'ai.embeddingModel': 'model-a' },
    } as never)

    initAiMemoryStore()
    // Clear any calls from prior subscription fires
    mockedReembedMemories.mockClear()

    useSettingsStore.setState({ settings: {} } as never)

    await new Promise((r) => setTimeout(r, 50))
    expect(mockedReembedMemories).not.toHaveBeenCalled()
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
    expect(mockedReembedMemories).toHaveBeenCalledWith({ connectionId: 'c2' })
  })

  it('model change handles reembed error gracefully', async () => {
    vi.useRealTimers()
    mockedReembedMemories.mockRejectedValueOnce(new Error('network error'))

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
    expect(mockedLogFrontend).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Re-embed failed')
    )
  })
})
