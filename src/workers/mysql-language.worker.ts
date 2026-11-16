import { start } from 'monaco-editor/editor/editor.worker.start.js'
import { EditorMySQLWorker } from './editor-mysql-worker'

// monaco-sql-languages' stock mysql.worker starts in two steps, which hangs under Monaco >= 0.55
self.onmessage = () => {
  start((workerContext) => new EditorMySQLWorker(workerContext, { languageId: 'mysql' }))
}
