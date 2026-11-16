import { editor, MarkerSeverity } from 'monaco-editor'
import type { IDisposable } from 'monaco-editor'
import { useConnectionStore } from '../../../stores/connection-store'
import { useSchemaStore } from '../../../stores/schema-store'
import {
  getModelConnectionId,
  onModelConnectionChange,
  resolveCompletionDatabases,
} from '../completion-service'
import { getCache, onSchemaCacheChange } from '../schema-metadata-cache'
import type { SqlStatementIdentifiers } from '../../../workers/sql-identifier-types'
import { findSchemaProblems, type SchemaCheckContext, type SchemaProblem } from './schema-problems'

export const SCHEMA_MARKER_OWNER = 'sqllumen-schema'

interface TrackedModel {
  model: editor.ITextModel
  statements: SqlStatementIdentifiers[]
  context: SchemaCheckContext | null
}

function schemaCheckContextOf(model: editor.ITextModel): SchemaCheckContext | null {
  const connectionId = getModelConnectionId(model.uri.toString())
  if (!connectionId) return null
  const cache = getCache(connectionId)
  if (cache.status !== 'ready') return null
  const defaultDatabase = resolveCompletionDatabases(connectionId).resolutionDatabase
  return { cache: cache, defaultDatabase: defaultDatabase }
}

function isSameContext(
  previous: SchemaCheckContext | null,
  current: SchemaCheckContext | null
): boolean {
  if (previous === null) return current === null
  if (current === null) return false
  const isSameCache = previous.cache === current.cache
  return isSameCache && previous.defaultDatabase === current.defaultDatabase
}

function problemsOf(tracked: TrackedModel): SchemaProblem[] {
  if (!tracked.context) return []
  return findSchemaProblems(tracked.statements, tracked.context)
}

function toMarker(problem: SchemaProblem): editor.IMarkerData {
  const { lineNumber, startColumn, length } = problem.range
  return {
    severity: MarkerSeverity.Warning,
    message: problem.message,
    startLineNumber: lineNumber,
    startColumn: startColumn,
    endLineNumber: lineNumber,
    endColumn: startColumn + length,
  }
}

export class SchemaProblemReporter implements IDisposable {
  private readonly trackedModels = new Map<string, TrackedModel>()
  private readonly unsubscribers: (() => void)[]

  constructor() {
    this.unsubscribers = [
      onSchemaCacheChange(() => this.refreshChangedContexts()),
      onModelConnectionChange(() => this.refreshChangedContexts()),
      useConnectionStore.subscribe(() => this.refreshChangedContexts()),
      useSchemaStore.subscribe(() => this.refreshChangedContexts()),
    ]
  }

  report(model: editor.ITextModel, statements: SqlStatementIdentifiers[]): void {
    this.apply({ model: model, statements: statements, context: schemaCheckContextOf(model) })
  }

  forget(model: editor.ITextModel): void {
    this.trackedModels.delete(model.uri.toString())
    editor.setModelMarkers(model, SCHEMA_MARKER_OWNER, [])
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe())
  }

  private apply(tracked: TrackedModel): void {
    this.trackedModels.set(tracked.model.uri.toString(), tracked)
    editor.setModelMarkers(tracked.model, SCHEMA_MARKER_OWNER, problemsOf(tracked).map(toMarker))
  }

  private refreshChangedContexts(): void {
    for (const tracked of this.trackedModels.values()) {
      const context = schemaCheckContextOf(tracked.model)
      if (isSameContext(tracked.context, context)) continue
      this.apply({ ...tracked, context: context })
    }
  }
}
