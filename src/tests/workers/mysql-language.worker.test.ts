import { describe, expect, it, vi } from 'vitest'
import { EditorMySQLParser } from '../../workers/editor-mysql-parser'

const mockStart = vi.fn()

vi.mock('monaco-editor/editor/editor.worker.start.js', () => ({
  start: mockStart,
}))

vi.mock('monaco-sql-languages/esm/languages/mysql/mysqlWorker.js', () => ({
  MySQLWorker: class {
    parser: unknown = null
  },
}))

describe('mysql-language.worker', () => {
  it('starts the language worker with the editor MySQL parser', async () => {
    const originalOnMessage = self.onmessage
    await import('../../workers/mysql-language.worker')

    self.onmessage?.(new MessageEvent('message'))

    expect(mockStart).toHaveBeenCalledTimes(1)
    const createWorker = mockStart.mock.calls[0][0] as (workerContext: unknown) => {
      parser: unknown
    }
    expect(createWorker({}).parser).toBeInstanceOf(EditorMySQLParser)
    self.onmessage = originalOnMessage
  })
})
