import { start } from 'monaco-editor/esm/vs/editor/editor.worker.start.js'
import { MySQLWorker } from 'monaco-sql-languages/esm/languages/mysql/mysqlWorker.js'

type MySQLWorkerContext = ConstructorParameters<typeof MySQLWorker>[0]

type ParseErrorListener = (error: unknown) => void

const SILENT_PARSE_ERROR_LISTENER: ParseErrorListener = () => {}

class QuietMySQLWorker extends MySQLWorker {
  constructor(workerContext: MySQLWorkerContext, createData: { languageId: string }) {
    super(workerContext, createData)

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

// monaco-sql-languages' stock mysql.worker starts in two steps, which hangs under Monaco >= 0.55
self.onmessage = () => {
  start((workerContext) => new QuietMySQLWorker(workerContext, { languageId: 'mysql' }))
}
