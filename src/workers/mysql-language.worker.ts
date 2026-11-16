import { start } from 'monaco-editor/editor/editor.worker.start.js'
import { MySQLWorker } from 'monaco-sql-languages/esm/languages/mysql/mysqlWorker.js'
import { EditorMySQLParser } from './editor-mysql-parser'

type MySQLWorkerContext = ConstructorParameters<typeof MySQLWorker>[0]

class EditorMySQLWorker extends MySQLWorker {
  constructor(workerContext: MySQLWorkerContext, createData: { languageId: string }) {
    super(workerContext, createData)
    this.parser = new EditorMySQLParser()
  }
}

// monaco-sql-languages' stock mysql.worker starts in two steps, which hangs under Monaco >= 0.55
self.onmessage = () => {
  start((workerContext) => new EditorMySQLWorker(workerContext, { languageId: 'mysql' }))
}
