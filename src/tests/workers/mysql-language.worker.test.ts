import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockStart = vi.fn()
const mockCreateParser = vi.fn()

vi.mock('monaco-editor/esm/vs/editor/editor.worker.start.js', () => ({
  start: mockStart,
}))

vi.mock('monaco-sql-languages/esm/languages/mysql/mysqlWorker', () => ({
  MySQLWorker: class {
    parser = {
      createParser: mockCreateParser,
    }
  },
}))

describe('mysql-language.worker', () => {
  const originalOnMessage = self.onmessage

  beforeEach(() => {
    vi.resetModules()
    mockStart.mockReset()
    mockCreateParser.mockReset()
    self.onmessage = null
  })

  afterEach(() => {
    self.onmessage = originalOnMessage
  })

  it('registers a worker bootstrap handler that patches parser errors to be silent by default', async () => {
    await import('../../workers/mysql-language.worker')

    expect(typeof self.onmessage).toBe('function')

    self.onmessage?.(new MessageEvent('message'))

    expect(mockStart).toHaveBeenCalledTimes(1)

    const factory = mockStart.mock.calls[0][0] as (ctx: unknown) => {
      parser: { createParser: (input: string, listener?: unknown) => unknown }
    }

    const worker = factory({})
    worker.parser.createParser('SELECT * FROM users')

    expect(mockCreateParser).toHaveBeenCalledWith('SELECT * FROM users', expect.any(Function))
  })

  it('preserves explicit parser error listeners when one is provided', async () => {
    await import('../../workers/mysql-language.worker')

    self.onmessage?.(new MessageEvent('message'))

    const factory = mockStart.mock.calls[0][0] as (ctx: unknown) => {
      parser: { createParser: (input: string, listener?: unknown) => unknown }
    }

    const worker = factory({})
    const customListener = vi.fn()

    worker.parser.createParser('SELECT * FROM users', customListener)

    expect(mockCreateParser).toHaveBeenCalledWith('SELECT * FROM users', customListener)
  })

  it('does not throw when parser.createParser is unavailable', async () => {
    await vi.doMock('monaco-sql-languages/esm/languages/mysql/mysqlWorker', () => ({
      MySQLWorker: class {
        parser = {}
      },
    }))

    await import('../../workers/mysql-language.worker')

    expect(() => self.onmessage?.(new MessageEvent('message'))).not.toThrow()
  })
})
