import { describe, expect, it, vi } from 'vitest'
import type { EditorMySQLWorker } from '../../workers/editor-mysql-worker'

const mockStart = vi.fn()

vi.mock('monaco-editor/editor/editor.worker.start.js', () => ({
  start: mockStart,
}))

vi.mock('monaco-sql-languages/esm/languages/mysql/mysqlWorker.js', () => ({
  MySQLWorker: class {
    parser: unknown = null
  },
}))

async function startWorker(): Promise<EditorMySQLWorker> {
  const originalOnMessage = self.onmessage
  await import('../../workers/mysql-language.worker')
  self.onmessage?.(new MessageEvent('message'))
  self.onmessage = originalOnMessage
  const createWorker = mockStart.mock.calls[0][0] as (workerContext: unknown) => EditorMySQLWorker
  return createWorker({})
}

describe('mysql-language.worker', () => {
  it('starts the language worker with the editor MySQL parser', async () => {
    const worker = await startWorker()

    const [statement] = await worker.classifyIdentifiers('SELECT t.active FROM settings t')

    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(statement.qualifiedColumns[0].column.name).toBe('active')
  })

  it('classifies the identifiers of each statement', async () => {
    const worker = await startWorker()

    const statements = await worker.classifyIdentifiers('USE shop; SELECT u.id FROM users u')

    expect(statements).toHaveLength(2)
    expect(statements[0].usedDatabase).toBe('shop')
    expect(statements[1].tables[0]).toMatchObject({ alias: 'u' })
    expect(statements[1].qualifiedColumns[0].column.name).toBe('id')
  })
})
