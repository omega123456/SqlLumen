import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ipc } from '../ipc-mock'
import {
  sendAiChat,
  cancelAiStream,
  listenToAiStream,
  listAiModels,
  aiQueryExpand,
} from '../../lib/ai-commands'
import type { AiChatParams } from '../../lib/ai-commands'

beforeEach(() => {
  ipc.reset()
  vi.clearAllMocks()
})

describe('sendAiChat', () => {
  it('invokes ai_chat with correct parameter mapping', async () => {
    const params: AiChatParams = {
      messages: [
        { role: 'system', content: 'You are a SQL assistant.' },
        { role: 'user', content: 'Show me all users' },
      ],
      endpoint: 'http://localhost:11434/v1',
      model: 'llama3',
      temperature: 0.5,
      maxTokens: 1024,
      streamId: 'stream-123',
      previousResponseId: 'resp_prev',
      preferResponsesApi: true,
    }

    await sendAiChat(params)

    expect(ipc.calls('ai_chat')).toEqual([{
      request: {
        messages: params.messages,
        endpoint: params.endpoint,
        model: params.model,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        streamId: params.streamId,
        previousResponseId: 'resp_prev',
        preferResponsesApi: true,
        enableReasoning: true,
      },
    }])
  })

  it('propagates errors from the backend', async () => {
    ipc.override('ai_chat', () => {
      throw new Error('AI service unavailable')
    })

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

  it('defaults preferResponsesApi to false when omitted', async () => {
    await sendAiChat({
      messages: [{ role: 'user', content: 'Hello' }],
      endpoint: 'http://localhost:11434/v1',
      model: 'llama3',
      temperature: 0.3,
      maxTokens: 256,
      streamId: 'stream-defaults',
    })

    expect(ipc.calls('ai_chat')).toEqual([{
      request: expect.objectContaining({
        preferResponsesApi: false,
        enableReasoning: true,
      }),
    }])
  })
})

describe('cancelAiStream', () => {
  it('invokes ai_cancel with the streamId', async () => {
    await cancelAiStream('stream-abc')
    expect(ipc.calls('ai_cancel')).toEqual([{ streamId: 'stream-abc' }])
  })

  it('propagates errors from the backend', async () => {
    ipc.override('ai_cancel', () => {
      throw new Error('Stream not found')
    })
    await expect(cancelAiStream('stream-missing')).rejects.toThrow('Stream not found')
  })
})

describe('listenToAiStream', () => {
  it('registers three listeners and tears them down', async () => {
    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    const unlisten = await listenToAiStream('stream-xyz', callbacks)

    await ipc.emit('ai-stream-chunk', { streamId: 'stream-xyz', content: 'hello' })
    expect(callbacks.onChunk).toHaveBeenCalledWith('hello', 'content')
    unlisten()
  })

  it('routes matching events and ignores non-matching stream ids', async () => {
    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    await listenToAiStream('stream-aaa', callbacks)

    await ipc.emit('ai-stream-chunk', { streamId: 'stream-aaa', content: 'hello' })
    await ipc.emit('ai-stream-chunk', { streamId: 'stream-bbb', content: 'ignored' })
    await ipc.emit('ai-stream-chunk', {
      streamId: 'stream-aaa',
      content: 'reasoning...',
      kind: 'thinking',
    })
    await ipc.emit('ai-stream-done', {
      streamId: 'stream-aaa',
      responseId: 'resp_123',
      transport: 'responses',
    })
    await ipc.emit('ai-stream-error', { streamId: 'stream-aaa', error: 'timeout' })

    expect(callbacks.onChunk).toHaveBeenNthCalledWith(1, 'hello', 'content')
    expect(callbacks.onChunk).toHaveBeenNthCalledWith(2, 'reasoning...', 'thinking')
    expect(callbacks.onChunk).toHaveBeenCalledTimes(2)
    expect(callbacks.onDone).toHaveBeenCalledWith({
      responseId: 'resp_123',
      transport: 'responses',
    })
    expect(callbacks.onError).toHaveBeenCalledWith('timeout')
  })
})

describe('listAiModels', () => {
  it('returns models from the backend', async () => {
    ipc.override('list_ai_models', () => ({
      models: [
        { id: 'codellama', name: null, category: 'chat' },
        { id: 'deepseek-coder', name: null, category: 'chat' },
      ],
    }))

    const result = await listAiModels('http://localhost:11434/v1')

    expect(ipc.calls('list_ai_models')).toEqual([{
      endpoint: 'http://localhost:11434/v1',
    }])
    expect(result.models).toEqual([
      { id: 'codellama', name: null, category: 'chat' },
      { id: 'deepseek-coder', name: null, category: 'chat' },
    ])
    expect(result.error).toBeUndefined()
  })

  it('returns empty models array and logs an error on failure', async () => {
    ipc.override('list_ai_models', () => {
      throw new Error('Connection refused')
    })

    const result = await listAiModels('http://localhost:9999/v1')

    expect(result.models).toEqual([])
    expect(result.error).toBe('Connection refused')
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'error',
      message: '[ai-commands] Failed to list AI models: Connection refused',
    })
  })
})

describe('aiQueryExpand', () => {
  it('invokes ai_query_expand with correct parameter mapping', async () => {
    ipc.override('ai_query_expand', () => ({ text: 'SELECT * FROM users' }))

    const req = {
      endpoint: 'http://localhost:11434/v1',
      model: 'llama3',
      systemPrompt: 'You are a SQL assistant.',
      userMessage: 'Find all users',
    }

    const result = await aiQueryExpand(req)

    expect(ipc.calls('ai_query_expand')).toEqual([{ req }])
    expect(result.text).toBe('SELECT * FROM users')
  })

  it('propagates errors from the backend', async () => {
    ipc.override('ai_query_expand', () => {
      throw new Error('Model not found')
    })

    await expect(
      aiQueryExpand({
        endpoint: 'http://localhost:11434/v1',
        model: 'nonexistent',
        systemPrompt: 'system',
        userMessage: 'user',
      })
    ).rejects.toThrow('Model not found')
  })
})
