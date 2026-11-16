declare module 'monaco-editor/editor/editor.worker.start.js' {
  import type { worker } from 'monaco-editor'

  export function start<TClient>(
    createClient: (workerContext: worker.IWorkerContext) => TClient
  ): void
}
