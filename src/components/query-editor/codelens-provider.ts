import * as monaco from 'monaco-editor'
import type { editor, CancellationToken } from 'monaco-editor'
import { getModelContext } from './completion-service'
import { splitStatements } from './sql-parser-utils'
import type { StatementRange } from './sql-parser-utils'
import { useSettingsStore } from '../../stores/settings-store'
import { useQueryStore, isCallSql, isExecutionLocked } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'

export function offsetToLineNumber(text: string, offset: number): number {
  let line = 1
  const maxOffset = Math.min(offset, text.length)
  for (let index = 0; index < maxOffset; index++) {
    if (text[index] === '\n') line++
  }
  return line
}

export function offsetToColumn(text: string, offset: number): number {
  let lastNewline = -1
  const maxOffset = Math.min(offset, text.length)
  for (let index = 0; index < maxOffset; index++) {
    if (text[index] === '\n') lastNewline = index
  }
  return offset - lastNewline
}

export interface CodeLensStatementTarget {
  connectionId: string
  tabId: string
  statement: StatementRange
}

export interface CodeLensAskAiTarget extends CodeLensStatementTarget {
  fullText: string
}

export function handleRunStatement({
  connectionId,
  tabId,
  statement,
}: CodeLensStatementTarget): void {
  const queryState = useQueryStore.getState()
  const tabState = queryState.tabs[tabId]
  if (isExecutionLocked(tabState)) {
    return
  }

  const sql = statement.sql
  if (!sql.trim()) return

  queryState.requestNavigationAction(tabId, () => {
    if (isCallSql(sql)) {
      queryState.executeCallQuery(connectionId, tabId, sql)
      return
    }
    queryState.executeQuery(connectionId, tabId, sql)
  })
}

export function handleAskAi({ tabId, statement, fullText }: CodeLensAskAiTarget): void {
  const aiStore = useAiStore.getState()

  if (!aiStore.tabs[tabId]?.isPanelOpen) {
    aiStore.openPanel(tabId)
  }

  const rawSegment = fullText.slice(statement.start, statement.end)
  const sqlOffset = rawSegment.indexOf(statement.sql)
  const actualStart = statement.start + (sqlOffset >= 0 ? sqlOffset : 0)
  const actualEnd = actualStart + statement.sql.length

  const startLine = offsetToLineNumber(fullText, actualStart)
  const startColumn = offsetToColumn(fullText, actualStart)
  const endLine = offsetToLineNumber(fullText, actualEnd)
  const endColumn = offsetToColumn(fullText, actualEnd)

  aiStore.setAttachedContext(tabId, {
    sql: statement.sql,
    range: {
      startLineNumber: startLine,
      startColumn: startColumn,
      endLineNumber: endLine,
      endColumn: endColumn,
    },
  })
}

const RUN_COMMAND_ID = 'sqllumen.codelens.run'
const ASK_AI_COMMAND_ID = 'sqllumen.codelens.askAi'

export function provideCodeLenses(
  model: editor.ITextModel,
  _unusedToken: CancellationToken
): monaco.languages.CodeLensList {
  void _unusedToken
  const context = getModelContext(model.uri.toString())

  if (context?.tabType !== 'query-editor') {
    return { lenses: [], dispose: () => {} }
  }

  const text = model.getValue()
  if (!text.trim()) {
    return { lenses: [], dispose: () => {} }
  }

  const statements = splitStatements(text)
  const aiEnabled = useSettingsStore.getState().getSetting('ai.enabled') === 'true'
  const lenses: monaco.languages.CodeLens[] = []

  for (const statement of statements) {
    const { lineNumber } = model.getPositionAt(statement.start)
    const lensRange = new monaco.Range(lineNumber, 1, lineNumber, 1)
    const statementTarget: CodeLensStatementTarget = {
      connectionId: context.connectionId,
      tabId: context.tabId,
      statement: statement,
    }

    lenses.push({
      range: lensRange,
      command: {
        id: RUN_COMMAND_ID,
        title: '\u25B6 Run',
        arguments: [statementTarget],
      },
    })

    if (aiEnabled) {
      lenses.push({
        range: lensRange,
        command: {
          id: ASK_AI_COMMAND_ID,
          title: '\u2726 Ask AI',
          arguments: [{ ...statementTarget, fullText: text }],
        },
      })
    }
  }

  return { lenses: lenses, dispose: () => {} }
}

const onDidChangeEmitter = new monaco.Emitter<monaco.languages.CodeLensProvider>()

const codeLensProvider: monaco.languages.CodeLensProvider = {
  onDidChange: onDidChangeEmitter.event,
  provideCodeLenses: provideCodeLenses,
}

const disposable = monaco.languages.registerCodeLensProvider('mysql', codeLensProvider)

let lastAiEnabled = useSettingsStore.getState().getSetting('ai.enabled') === 'true'
useSettingsStore.subscribe((state) => {
  const current = state.getSetting('ai.enabled') === 'true'
  if (current !== lastAiEnabled) {
    lastAiEnabled = current
    onDidChangeEmitter.fire(codeLensProvider)
  }
})

monaco.editor.registerCommand(
  RUN_COMMAND_ID,
  (_accessor: unknown, target?: CodeLensStatementTarget) => {
    if (!target) return
    handleRunStatement(target)
  }
)

monaco.editor.registerCommand(
  ASK_AI_COMMAND_ID,
  (_accessor: unknown, target?: CodeLensAskAiTarget) => {
    if (!target) return
    handleAskAi(target)
  }
)

export { onDidChangeEmitter, disposable }
