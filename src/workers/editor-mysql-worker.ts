import { MySQLWorker } from 'monaco-sql-languages/esm/languages/mysql/mysqlWorker.js'
import { EditorMySQLParser } from './editor-mysql-parser'
import { classifySqlIdentifiers } from './sql-identifier-classifier'
import type { SqlStatementIdentifiers } from './sql-identifier-types'

export class EditorMySQLWorker extends MySQLWorker {
  protected override parser = new EditorMySQLParser()

  async classifyIdentifiers(code: string): Promise<SqlStatementIdentifiers[]> {
    return classifySqlIdentifiers(this.parser, code)
  }
}
