/**
 * Monaco CodeLens provider for "Run" and "Ask AI" per SQL statement.
 *
 * Registered as a module side-effect (import './codelens-provider').
 * The provider is global — it inspects each model's URI to determine
 * the tab context via the completion-service model registry.
 *
 * - "Run" appears above each detected SQL statement and executes it.
 * - "Ask AI" appears only when `ai.enabled` is true and opens the
 *   AI panel with the statement attached as context.
 *
 * Both actions work through direct store calls to avoid coupling to
 * the shortcut system.
 */

import * as monaco from 'monaco-editor'
import type { editor, CancellationToken } from 'monaco-editor'
import { getModelContext } from './completion-service'
import { splitStatements } from './sql-parser-utils'
import type { StatementRange } from './sql-parser-utils'
import { useSettingsStore } from '../../stores/settings-store'
import { useQueryStore, isCallSql, isExecutionLocked } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a character offset in `text` to a 1-indexed line number.
 * The offset is clamped to the text length.
 */
export function offsetToLineNumber(text: string, offset: number): number {
  let line = 1
  const maxOffset = Math.min(offset, text.length)
  for (let index = 0; index < maxOffset; index++) {
    if (text[index] === '\n') line++
  }
  return line
}

/**
 * Convert a character offset in `text` to a 1-indexed column number.
 */
export function offsetToColumn(text: string, offset: number): number {
  let lastNewline = -1
  const maxOffset = Math.min(offset, text.length)
  for (let index = 0; index < maxOffset; index++) {
    if (text[index] === '\n') lastNewline = index
  }
  return offset - lastNewline
}

// ---------------------------------------------------------------------------
// Command handlers for CodeLens actions
// ---------------------------------------------------------------------------

/**
 * Execute a specific SQL statement via the query store.
 * Exported for testing.
 */
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

/**
 * Open the AI panel and attach the statement as context.
 * Exported for testing.
 *
 * The range is computed to cover exactly `stmt.sql` within the editor text.
 * `stmt.start`/`stmt.end` from `splitStatements` may include leading
 * whitespace and a trailing delimiter (`;`), so we locate the trimmed SQL
 * content inside `fullText.slice(stmt.start, stmt.end)` to derive a tight
 * range.  This ensures that `getValueInRange(range)` returns exactly
 * `stmt.sql`, which is what `applyDiff` expects for its staleness check.
 */
export function handleAskAi({ tabId, statement, fullText }: CodeLensAskAiTarget): void {
  const aiStore = useAiStore.getState()

  // Open the AI panel if not already open
  if (!aiStore.tabs[tabId]?.isPanelOpen) {
    aiStore.openPanel(tabId)
  }

  // Locate the exact position of the trimmed SQL within the raw segment
  // covered by stmt.start..stmt.end.  This strips leading whitespace and
  // the trailing delimiter that splitStatements includes in the range but
  // NOT in stmt.sql.
  const rawSegment = fullText.slice(statement.start, statement.end)
  const sqlOffset = rawSegment.indexOf(statement.sql)
  const actualStart = statement.start + (sqlOffset >= 0 ? sqlOffset : 0)
  const actualEnd = actualStart + statement.sql.length

  // Compute the editor range for the statement
  const startLine = offsetToLineNumber(fullText, actualStart)
  const startColumn = offsetToColumn(fullText, actualStart)
  const endLine = offsetToLineNumber(fullText, actualEnd)
  const endColumn = offsetToColumn(fullText, actualEnd)

  // Attach the statement as context
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

// ---------------------------------------------------------------------------
// CodeLens provider implementation
// ---------------------------------------------------------------------------

// Unique, stable command IDs for CodeLens actions (registered below)
const RUN_COMMAND_ID = 'sqllumen.codelens.run'
const ASK_AI_COMMAND_ID = 'sqllumen.codelens.askAi'

/** @internal Exported for testing. */
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

    // "Run" CodeLens — always present
    lenses.push({
      range: lensRange,
      command: {
        id: RUN_COMMAND_ID,
        title: '\u25B6 Run',
        arguments: [statementTarget],
      },
    })

    // "Ask AI" CodeLens — only when AI is enabled
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

// ---------------------------------------------------------------------------
// Change emitter — fires when settings change so Monaco re-queries lenses
// ---------------------------------------------------------------------------

const onDidChangeEmitter = new monaco.Emitter<monaco.languages.CodeLensProvider>()

// ---------------------------------------------------------------------------
// Build and register the CodeLens provider object
// ---------------------------------------------------------------------------

const codeLensProvider: monaco.languages.CodeLensProvider = {
  onDidChange: onDidChangeEmitter.event,
  provideCodeLenses: provideCodeLenses,
}

const disposable = monaco.languages.registerCodeLensProvider('mysql', codeLensProvider)

// Subscribe to the settings store and fire the emitter when ai.enabled changes.
// This must happen AFTER the provider is defined so the emitter fires with the
// correct provider reference.
let lastAiEnabled = useSettingsStore.getState().getSetting('ai.enabled') === 'true'
useSettingsStore.subscribe((state) => {
  const current = state.getSetting('ai.enabled') === 'true'
  if (current !== lastAiEnabled) {
    lastAiEnabled = current
    onDidChangeEmitter.fire(codeLensProvider)
  }
})

// ---------------------------------------------------------------------------
// Register global commands for CodeLens actions
// ---------------------------------------------------------------------------

// Register commands in the global StandaloneCommandService so that CodeLens
// click dispatch can find them.  `monaco.editor.registerCommand` registers
// in the *global* command registry — the only registry CodeLens uses.
// (Using `addAction` via `onDidCreateEditor` only registers in the per-editor
// action registry, which CodeLens dispatch cannot reach.)

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

// Export for testing
export { onDidChangeEmitter, disposable }
