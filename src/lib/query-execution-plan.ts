import { isCallSql } from '../stores/query-store'
import type { ConnectionTabRequest } from './ipc/requests'
import {
  splitStatements,
  findStatementAtCursor,
  cursorToOffset,
} from '../components/query-editor/sql-parser-utils'

export type ExecuteQueryPlan =
  | { kind: 'single'; payload: string }
  | { kind: 'call'; payload: string }
  | { kind: 'multi'; payload: string[] }

function getExecutableStatements(sql: string): string[] {
  return splitStatements(sql)
    .map((statement) => statement.sql.trim())
    .filter((statement) => statement.length > 0)
    .filter((statement) => !/^DELIMITER\s/i.test(statement))
}

export function buildExecuteQueryPlanFromSql(sql: string): ExecuteQueryPlan | null {
  const statements = getExecutableStatements(sql)

  if (statements.length === 0) {
    return null
  }

  if (statements.length > 1) {
    return { kind: 'multi', payload: statements }
  }

  const [statement] = statements
  return { kind: isCallSql(statement) ? 'call' : 'single', payload: statement }
}

export function buildExecuteQueryPlan(
  content: string,
  selectedText: string,
  cursorPosition: { lineNumber: number; column: number } | null
): ExecuteQueryPlan | null {
  if (selectedText.length > 0) {
    return buildExecuteQueryPlanFromSql(selectedText)
  }

  const cursor = cursorPosition ?? { lineNumber: 1, column: 1 }
  const offset = cursorToOffset(content, cursor.lineNumber, cursor.column)
  const statements = splitStatements(content)
  const statementAtCursor = findStatementAtCursor(statements, offset)
  const sql = statementAtCursor?.sql ?? content.trim()

  return buildExecuteQueryPlanFromSql(sql)
}

interface QueryPlanExecutor {
  executeQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>
  executeMultiQuery: (connectionId: string, tabId: string, statements: string[]) => Promise<void>
  executeCallQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>
}

interface NavigatingQueryPlanExecutor extends QueryPlanExecutor {
  requestTabNavigation: (tabId: string, action: () => void) => void
}

export async function executeQueryPlan(
  queryState: QueryPlanExecutor,
  { connectionId, tabId }: ConnectionTabRequest,
  plan: ExecuteQueryPlan
): Promise<void> {
  if (plan.kind === 'multi') {
    await queryState.executeMultiQuery(connectionId, tabId, plan.payload)
    return
  }

  if (plan.kind === 'call') {
    await queryState.executeCallQuery(connectionId, tabId, plan.payload)
    return
  }

  await queryState.executeQuery(connectionId, tabId, plan.payload)
}

export function runExecuteQueryPlan(
  queryState: NavigatingQueryPlanExecutor,
  target: ConnectionTabRequest,
  plan: ExecuteQueryPlan
): void {
  queryState.requestTabNavigation(target.tabId, () => {
    void executeQueryPlan(queryState, target, plan)
  })
}
