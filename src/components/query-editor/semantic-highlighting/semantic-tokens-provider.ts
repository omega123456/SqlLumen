import { editor } from 'monaco-editor'
import type { IDisposable, languages, Uri } from 'monaco-editor'
import type { SqlStatementIdentifiers } from '../../../workers/sql-identifier-types'
import { SEMANTIC_TOKEN_LEGEND } from './semantic-token-legend'
import { encodeSemanticTokens } from './semantic-token-encoding'
import {
  clearSemanticHighlightingStatus,
  markSemanticHighlightingApplied,
  type ModelVersion,
} from './semantic-highlighting-status'
import type { SchemaProblemReporter } from './schema-problem-reporter'

export const SEMANTIC_HIGHLIGHTING_MAX_LENGTH = 200_000

export interface SqlIdentifierClassifier {
  classifyIdentifiers(code: string): Promise<SqlStatementIdentifiers[]>
}

export type SqlIdentifierWorkerAccessor = (...uris: Uri[]) => Promise<SqlIdentifierClassifier>

function isTooLongToHighlight(model: editor.ITextModel): boolean {
  return model.getValueLength() > SEMANTIC_HIGHLIGHTING_MAX_LENGTH
}

function identifiersOf(statements: SqlStatementIdentifiers[]) {
  return statements.flatMap((statement) => statement.identifiers)
}

function versionOf(model: editor.ITextModel): ModelVersion {
  return { uri: model.uri.toString(), versionId: model.getVersionId() }
}

export class MySqlSemanticTokensProvider
  implements languages.DocumentSemanticTokensProvider, IDisposable
{
  private readonly modelDisposeListener: IDisposable

  constructor(
    private readonly worker: SqlIdentifierWorkerAccessor,
    private readonly schemaProblems: SchemaProblemReporter
  ) {
    this.modelDisposeListener = editor.onWillDisposeModel((model) => this.releaseModel(model))
  }

  getLegend(): languages.SemanticTokensLegend {
    return SEMANTIC_TOKEN_LEGEND
  }

  async provideDocumentSemanticTokens(
    model: editor.ITextModel
  ): Promise<languages.SemanticTokens | null> {
    const requestedVersion = versionOf(model)
    if (isTooLongToHighlight(model)) {
      this.schemaProblems.forget(model)
      markSemanticHighlightingApplied(requestedVersion)
      return null
    }
    const code = model.getValue()
    const worker = await this.worker(model.uri)
    const statements = await worker.classifyIdentifiers(code)
    if (model.isDisposed()) return null
    this.schemaProblems.report(model, statements)
    markSemanticHighlightingApplied(requestedVersion)
    return { data: encodeSemanticTokens(identifiersOf(statements)) }
  }

  releaseDocumentSemanticTokens(): void {}

  dispose(): void {
    this.modelDisposeListener.dispose()
    this.schemaProblems.dispose()
  }

  private releaseModel(model: editor.ITextModel): void {
    this.schemaProblems.forget(model)
    clearSemanticHighlightingStatus(model.uri.toString())
  }
}
