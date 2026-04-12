import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be before imports of the module under test
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const mockListen = vi.fn()
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}))

import { sendAiChat, cancelAiStream, listenToAiStream, listAiModels } from '../../lib/ai-commands'
import type { AiChatParams } from '../../lib/ai-commands'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockResolvedValue(undefined)
  mockListen.mockResolvedValue(vi.fn())
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendAiChat', () => {
  it('invokes ai_chat with correct parameter mapping', async () => {
    const params: AiChatParams = {
      messages: [
        { role: 'system', content: 'You are a SQL assistant.' },
        { role: 'user', content: 'Show me all users' },
      ],
      endpoint: 'http://localhost:11434/v1/chat/completions',
      model: 'llama3',
      temperature: 0.5,
      maxTokens: 1024,
      streamId: 'stream-123',
    }

    await sendAiChat(params)

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('ai_chat', {
      request: {
        messages: params.messages,
        endpoint: params.endpoint,
        model: params.model,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        streamId: params.streamId,
      },
    })
  })

  it('propagates errors from the backend', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('AI service unavailable'))

    await expect(
      sendAiChat({
        messages: [],
        endpoint: '',
        model: '',
        temperature: 0,
        maxTokens: 0,
        streamId: 'stream-err',
      })
    ).rejects.toThrow('AI service unavailable')
  })
})

describe('cancelAiStream', () => {
  it('invokes ai_cancel with the streamId', async () => {
    await cancelAiStream('stream-abc')

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('ai_cancel', { streamId: 'stream-abc' })
  })

  it('propagates errors from the backend', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Stream not found'))

    await expect(cancelAiStream('stream-missing')).rejects.toThrow('Stream not found')
  })
})

describe('listenToAiStream', () => {
  it('sets up three event listeners for chunk, done, and error', async () => {
    const unlistenChunk = vi.fn()
    const unlistenDone = vi.fn()
    const unlistenError = vi.fn()

    mockListen
      .mockResolvedValueOnce(unlistenChunk)
      .mockResolvedValueOnce(unlistenDone)
      .mockResolvedValueOnce(unlistenError)

    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await listenToAiStream('stream-xyz', callbacks)

    expect(mockListen).toHaveBeenCalledTimes(3)
    expect(mockListen).toHaveBeenCalledWith('ai-stream-chunk', expect.any(Function))
    expect(mockListen).toHaveBeenCalledWith('ai-stream-done', expect.any(Function))
    expect(mockListen).toHaveBeenCalledWith('ai-stream-error', expect.any(Function))
  })

  it('returns an unlisten function that calls all three unlistens', async () => {
    const unlistenChunk = vi.fn()
    const unlistenDone = vi.fn()
    const unlistenError = vi.fn()

    mockListen
      .mockResolvedValueOnce(unlistenChunk)
      .mockResolvedValueOnce(unlistenDone)
      .mockResolvedValueOnce(unlistenError)

    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    const unlisten = await listenToAiStream('stream-xyz', callbacks)

    expect(unlistenChunk).not.toHaveBeenCalled()
    expect(unlistenDone).not.toHaveBeenCalled()
    expect(unlistenError).not.toHaveBeenCalled()

    unlisten()

    expect(unlistenChunk).toHaveBeenCalledTimes(1)
    expect(unlistenDone).toHaveBeenCalledTimes(1)
    expect(unlistenError).toHaveBeenCalledTimes(1)
  })

  it('filters events by streamId — matching stream calls onChunk', async () => {
    let chunkHandler: ((event: { payload: { streamId: string; content: string } }) => void) | null =
      null

    mockListen.mockImplementation((eventName: string, handler: unknown) => {
      if (eventName === 'ai-stream-chunk') {
        chunkHandler = handler as typeof chunkHandler
      }
      return Promise.resolve(vi.fn())
    })

    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await listenToAiStream('stream-aaa', callbacks)

    // Matching streamId
    chunkHandler!({ payload: { streamId: 'stream-aaa', content: 'hello' } })
    expect(callbacks.onChunk).toHaveBeenCalledWith('hello')
  })

  it('filters events by streamId — mismatched stream does not call onChunk', async () => {
    let chunkHandler: ((event: { payload: { streamId: string; content: string } }) => void) | null =
      null

    mockListen.mockImplementation((eventName: string, handler: unknown) => {
      if (eventName === 'ai-stream-chunk') {
        chunkHandler = handler as typeof chunkHandler
      }
      return Promise.resolve(vi.fn())
    })

    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await listenToAiStream('stream-aaa', callbacks)

    // Non-matching streamId
    chunkHandler!({ payload: { streamId: 'stream-bbb', content: 'hello' } })
    expect(callbacks.onChunk).not.toHaveBeenCalled()
  })

  it('filters done events by streamId', async () => {
    let doneHandler: ((event: { payload: { streamId: string } }) => void) | null = null

    mockListen.mockImplementation((eventName: string, handler: unknown) => {
      if (eventName === 'ai-stream-done') {
        doneHandler = handler as typeof doneHandler
      }
      return Promise.resolve(vi.fn())
    })

    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await listenToAiStream('stream-done-test', callbacks)

    // Matching
    doneHandler!({ payload: { streamId: 'stream-done-test' } })
    expect(callbacks.onDone).toHaveBeenCalledTimes(1)

    // Non-matching
    doneHandler!({ payload: { streamId: 'stream-other' } })
    expect(callbacks.onDone).toHaveBeenCalledTimes(1) // still 1
  })

  it('filters error events by streamId', async () => {
    let errorHandler: ((event: { payload: { streamId: string; error: string } }) => void) | null =
      null

    mockListen.mockImplementation((eventName: string, handler: unknown) => {
      if (eventName === 'ai-stream-error') {
        errorHandler = handler as typeof errorHandler
      }
      return Promise.resolve(vi.fn())
    })

    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await listenToAiStream('stream-err-test', callbacks)

    // Matching
    errorHandler!({ payload: { streamId: 'stream-err-test', error: 'timeout' } })
    expect(callbacks.onError).toHaveBeenCalledWith('timeout')

    // Non-matching
    errorHandler!({ payload: { streamId: 'stream-nope', error: 'nope' } })
    expect(callbacks.onError).toHaveBeenCalledTimes(1) // still 1
  })
})

describe('listAiModels', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy?.mockRestore()
  })

  it('returns models from the backend', async () => {
    mockInvoke.mockResolvedValueOnce({
      models: [
        { id: 'codellama', name: null },
        { id: 'deepseek-coder', name: null },
      ],
    })

    const result = await listAiModels('http://localhost:11434/v1/chat/completions')

    expect(mockInvoke).toHaveBeenCalledWith('list_ai_models', {
      endpoint: 'http://localhost:11434/v1/chat/completions',
    })
    expect(result.models).toEqual([
      { id: 'codellama', name: null },
      { id: 'deepseek-coder', name: null },
    ])
    expect(result.error).toBeUndefined()
  })

  it('returns empty models array and error string on failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await listAiModels('http://localhost:9999/v1')

    expect(result.models).toEqual([])
    expect(result.error).toBe('Connection refused')
    expect(consoleSpy).toHaveBeenCalledWith(
      '[ai-commands] Failed to list AI models:',
      'Connection refused'
    )
  })

  it('returns empty models array without error when backend returns no models', async () => {
    mockInvoke.mockResolvedValueOnce({ models: [] })

    const result = await listAiModels('http://localhost:11434/v1')
    expect(result.models).toEqual([])
    expect(result.error).toBeUndefined()
  })
})
