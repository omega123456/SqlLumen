import type { languages } from 'monaco-editor'
import type { SqlIdentifierKind } from '../../../workers/sql-identifier-types'

const SEMANTIC_TOKEN_TYPES: readonly SqlIdentifierKind[] = [
  'database',
  'table',
  'tableAlias',
  'column',
  'columnAlias',
  'function',
]

export const SEMANTIC_TOKEN_LEGEND: languages.SemanticTokensLegend = {
  tokenTypes: [...SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [],
}

export function semanticTokenTypeIndex(kind: SqlIdentifierKind): number {
  return SEMANTIC_TOKEN_TYPES.indexOf(kind)
}
