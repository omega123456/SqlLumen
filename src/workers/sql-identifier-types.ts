export type SqlIdentifierKind =
  'database' | 'table' | 'tableAlias' | 'column' | 'columnAlias' | 'function'

export interface SqlTextRange {
  lineNumber: number
  startColumn: number
  length: number
}

export interface SqlIdentifierSpan {
  kind: SqlIdentifierKind
  range: SqlTextRange
}

export interface SqlNamePart {
  name: string
  range: SqlTextRange
}

export interface SqlTableReference {
  database: SqlNamePart | null
  table: SqlNamePart
  alias: string | null
}

export interface SqlColumnQualifier {
  database: string | null
  table: string
}

export interface SqlQualifiedColumn {
  qualifier: SqlColumnQualifier
  column: SqlNamePart
}

export interface SqlStatementIdentifiers {
  usedDatabase: string | null
  tables: SqlTableReference[]
  qualifiedColumns: SqlQualifiedColumn[]
  derivedNames: string[]
  createdTables: string[]
  identifiers: SqlIdentifierSpan[]
}
