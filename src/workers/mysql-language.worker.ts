/**
 * Custom MySQL web worker that initializes in a single step.
 *
 * The stock `mysql.worker.js` from monaco-sql-languages uses a
 * two-step initialization protocol that is incompatible with
 * Monaco ≥ 0.55's ESM worker message flow (the second RPC
 * message gets consumed as the initialization trigger and never
 * reaches the WebWorkerServer, causing `$ping` to hang
 * and completions to stay "Loading…" forever).
 *
 * This worker calls `start()` from `editor.worker.start.js`
 * directly on the first message, passing the MySQLWorker
 * factory so `EditorWorker._foreignModule` is set immediately.
 */

import { start } from 'monaco-editor/esm/vs/editor/editor.worker.start.js'
import { MySQLWorker } from 'monaco-sql-languages/esm/languages/mysql/mysqlWorker.js'

type MySQLWorkerContext = ConstructorParameters<typeof MySQLWorker>[0]

type ParseErrorListener = (error: unknown) => void

const SILENT_PARSE_ERROR_LISTENER: ParseErrorListener = () => {}

class QuietMySQLWorker extends MySQLWorker {
  constructor(workerContext: MySQLWorkerContext, createData: { languageId: string }) {
    super(workerContext, createData)

    // dt-sql-parser uses ConsoleErrorListener by default when no error listener is
    // supplied. During autocomplete the parser intentionally sees incomplete SQL,
    // so those console errors are just noise. Default to a no-op listener instead.
    const parser = this.parser as Partial<{
      createParser: (input: string, errorListener?: ParseErrorListener) => unknown
    }>

    if (typeof parser.createParser === 'function') {
      const originalCreateParser = parser.createParser.bind(parser)
      parser.createParser = (input: string, errorListener?: ParseErrorListener) =>
        originalCreateParser(input, errorListener ?? SILENT_PARSE_ERROR_LISTENER)
    }
  }
}

self.onmessage = () => {
  start((workerContext) => new QuietMySQLWorker(workerContext, { languageId: 'mysql' }))
}
