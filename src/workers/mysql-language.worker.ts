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

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no .d.ts for internal Monaco worker entry point
import { start } from 'monaco-editor/esm/vs/editor/editor.worker.start.js'
import { MySQLWorker } from 'monaco-sql-languages/esm/languages/mysql/mysqlWorker'

type ParseErrorListener = (error: unknown) => void

const SILENT_PARSE_ERROR_LISTENER: ParseErrorListener = () => {}

class QuietMySQLWorker extends MySQLWorker {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: any,
    createData: { languageId: string }
  ) {
    super(ctx, createData)

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  start((ctx: any) => {
    return new QuietMySQLWorker(ctx, { languageId: 'mysql' })
  })
}
