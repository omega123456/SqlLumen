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

self.onmessage = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  start((ctx: any) => {
    return new MySQLWorker(ctx, { languageId: 'mysql' })
  })
}
