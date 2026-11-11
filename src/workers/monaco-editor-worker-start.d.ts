declare module 'monaco-editor/esm/vs/editor/editor.worker.start.js' {
  import type { worker } from 'monaco-editor/esm/vs/editor/editor.api'

  export function start<TClient>(
    createClient: (workerContext: worker.IWorkerContext) => TClient
  ): void
}
