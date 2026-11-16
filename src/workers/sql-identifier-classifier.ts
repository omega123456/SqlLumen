import { MySqlParserVisitor } from 'dt-sql-parser/dist/lib/mysql/MySqlParserVisitor'
import type {
  AtomTableItemContext,
  CallStatementContext,
  ColumnNameContext,
  ColumnNameCreateContext,
  ColumnNamePath_defaultContext,
  ColumnNamePath_dot_emptyContext,
  CommonTableExpressionsContext,
  DatabaseNameContext,
  DatabaseNameCreateContext,
  DottedIdContext,
  DropTableContext,
  DropViewContext,
  FullIdContext,
  FunctionNameContext,
  FunctionNameCreateContext,
  SelectElement_dot_emptyContext,
  SelectElement_exprContext,
  SelectElement_labelContext,
  SingleDeleteStatementContext,
  SingleUpdateStatementContext,
  SqlStatementContext,
  SubqueryTableItemContext,
  TableAllColumnsContext,
  TableNameContext,
  TableNameCreateContext,
  UidContext,
  UseStatementContext,
  ViewNameContext,
  ViewNameCreateContext,
} from 'dt-sql-parser/dist/lib/mysql/MySqlParser'
import { stripQuotes } from '../lib/sql-identifier-quotes'
import type { EditorMySQLParser } from './editor-mysql-parser'
import type {
  SqlIdentifierKind,
  SqlIdentifierSpan,
  SqlNamePart,
  SqlQualifiedColumn,
  SqlStatementIdentifiers,
  SqlTableReference,
} from './sql-identifier-types'

type Token = NonNullable<UidContext['start']>
type ParseTree = NonNullable<SqlStatementContext['children']>[number]

interface ParentNode {
  children: ParseTree[] | null
}

interface TableName {
  database: SqlNamePart | null
  table: SqlNamePart
}

interface CollectedTable extends TableName {
  alias: SqlNamePart | null
  mustExist: boolean
}

interface TableOccurrence {
  name: FullIdContext | null | undefined
  alias: UidContext | null
  mustExist: boolean
}

interface CollectedColumnPath {
  qualifier: TableName | null
  column: SqlNamePart | null
}

type DottedNameContext = ColumnNameContext | ColumnNamePath_defaultContext | ColumnNameCreateContext

// dt-sql-parser types rule accessors as non-null, yet they return null inside error-recovered trees
function recoveredChild<Child>(child: Child): Child | null {
  return child
}

function isConjuredToken(token: Token): boolean {
  return token.start < 0
}

function namePartOfToken(token: Token | null | undefined): SqlNamePart | null {
  if (!token) return null
  if (isConjuredToken(token)) return null
  const text = token.text ?? ''
  return {
    name: stripQuotes(text),
    range: { lineNumber: token.line, startColumn: token.column + 1, length: text.length },
  }
}

function namePartOfUid(uid: UidContext | null | undefined): SqlNamePart | null {
  if (!uid) return null
  const hasNoTokens = uid.getChildCount() === 0
  if (hasNoTokens) return null
  return namePartOfToken(uid.start)
}

function namePartOfDottedId(dottedId: DottedIdContext | null): SqlNamePart | null {
  if (!dottedId) return null
  const identifierToken = dottedId.ID()?.symbol
  if (identifierToken) return namePartOfToken(identifierToken)
  return namePartOfUid(dottedId.uid())
}

function presentParts(parts: (SqlNamePart | null)[]): SqlNamePart[] {
  return parts.filter((part): part is SqlNamePart => part !== null)
}

function namePartsOfFullId(fullId: FullIdContext | null | undefined): SqlNamePart[] {
  if (!fullId) return []
  return presentParts([namePartOfUid(fullId.uid()), namePartOfDottedId(fullId.dottedId())])
}

function namePartsOfDottedName(context: DottedNameContext): SqlNamePart[] {
  const dottedParts = context.dottedId().map((dottedId) => namePartOfDottedId(dottedId))
  return presentParts([namePartOfUid(context.uid()), ...dottedParts])
}

function lastPartOf(parts: SqlNamePart[]): SqlNamePart | null {
  if (parts.length === 0) return null
  return parts[parts.length - 1]
}

function partsBeforeLast(parts: SqlNamePart[]): SqlNamePart[] {
  return parts.slice(0, -1)
}

function tableNameOf(parts: SqlNamePart[]): TableName | null {
  const table = lastPartOf(parts)
  if (!table) return null
  return { database: lastPartOf(partsBeforeLast(parts)), table: table }
}

function columnPathOf(parts: SqlNamePart[]): CollectedColumnPath | null {
  const column = lastPartOf(parts)
  if (!column) return null
  return { qualifier: tableNameOf(partsBeforeLast(parts)), column: column }
}

function identifierSpan(kind: SqlIdentifierKind, part: SqlNamePart): SqlIdentifierSpan {
  return { kind: kind, range: part.range }
}

function toTableReference(table: CollectedTable): SqlTableReference {
  return { database: table.database, table: table.table, alias: table.alias?.name ?? null }
}

function toQualifiedColumn(path: CollectedColumnPath): SqlQualifiedColumn | null {
  if (!path.qualifier) return null
  if (!path.column) return null
  const qualifier = {
    database: path.qualifier.database?.name ?? null,
    table: path.qualifier.table.name,
  }
  return { qualifier: qualifier, column: path.column }
}

function normalizedName(part: SqlNamePart): string {
  return part.name.toLowerCase()
}

class StatementIdentifierCollector extends MySqlParserVisitor<void> {
  private usedDatabase: string | null = null
  private readonly tables: CollectedTable[] = []
  private readonly columnPaths: CollectedColumnPath[] = []
  private readonly tableAliasNames = new Set<string>()
  private readonly derivedNames: string[] = []
  private readonly createdTables: string[] = []
  private readonly identifiers: SqlIdentifierSpan[] = []

  override visitUseStatement = (context: UseStatementContext): void => {
    const database = this.recordDatabaseName(recoveredChild(context.databaseName())?.fullId())
    this.usedDatabase = database?.name ?? null
  }

  override visitDatabaseName = (context: DatabaseNameContext): void => {
    this.recordDatabaseName(context.fullId())
  }

  override visitDatabaseNameCreate = (context: DatabaseNameCreateContext): void => {
    this.recordDatabaseName(context.fullId())
  }

  override visitTableName = (context: TableNameContext): void => {
    this.recordTable({ name: context.fullId(), alias: null, mustExist: true })
  }

  override visitViewName = (context: ViewNameContext): void => {
    this.recordTable({ name: context.fullId(), alias: null, mustExist: true })
  }

  override visitAtomTableItem = (context: AtomTableItemContext): void => {
    const name = recoveredChild(context.tableName())?.fullId()
    this.recordTable({ name: name, alias: context.uid(), mustExist: true })
  }

  override visitSingleUpdateStatement = (context: SingleUpdateStatementContext): void => {
    const name = recoveredChild(context.tableName())?.fullId()
    this.recordTable({ name: name, alias: context.uid(), mustExist: true })
    this.visitChildrenExcept(context, [context.tableName(), context.uid()])
  }

  override visitSingleDeleteStatement = (context: SingleDeleteStatementContext): void => {
    const name = recoveredChild(context.tableName())?.fullId()
    this.recordTable({ name: name, alias: context.uid(), mustExist: true })
    this.visitChildrenExcept(context, [context.tableName(), context.uid()])
  }

  override visitDropTable = (context: DropTableContext): void => {
    const mustExist = context.ifExists() === null
    const tableNames = recoveredChild(context.tableNames())?.tableName() ?? []
    for (const tableName of tableNames) {
      this.recordTable({ name: tableName.fullId(), alias: null, mustExist: mustExist })
    }
  }

  override visitDropView = (context: DropViewContext): void => {
    const mustExist = context.ifExists() === null
    for (const viewName of context.viewName()) {
      this.recordTable({ name: viewName.fullId(), alias: null, mustExist: mustExist })
    }
  }

  override visitTableNameCreate = (context: TableNameCreateContext): void => {
    this.recordCreatedTable(context.fullId())
  }

  override visitViewNameCreate = (context: ViewNameCreateContext): void => {
    this.recordCreatedTable(context.fullId())
  }

  override visitSubqueryTableItem = (context: SubqueryTableItemContext): void => {
    const alias = namePartOfUid(context.uid())
    if (alias) {
      this.recordTableAlias(alias)
      this.derivedNames.push(alias.name)
    }
    this.visitPresent(context.atomSubQueryTableSource())
  }

  override visitCommonTableExpressions = (context: CommonTableExpressionsContext): void => {
    const [nameUid, ...columnUids] = context.uid()
    const name = namePartOfUid(nameUid)
    if (name) {
      this.identifiers.push(identifierSpan('table', name))
      this.derivedNames.push(name.name)
    }
    for (const columnUid of columnUids) {
      this.recordNamePart('columnAlias', namePartOfUid(columnUid))
    }
    this.visitChildrenExcept(context, context.uid())
  }

  override visitSelectElement_label = (context: SelectElement_labelContext): void => {
    this.recordNamePart('columnAlias', namePartOfUid(context.uid()))
    this.visitPresent(context.selectLiteralColumnName())
  }

  override visitSelectElement_expr = (context: SelectElement_exprContext): void => {
    this.recordNamePart('columnAlias', namePartOfUid(context.uid()))
    this.visitPresent(context.selectExpressionColumnName())
  }

  override visitTableAllColumns = (context: TableAllColumnsContext): void => {
    const qualifier = tableNameOf(namePartsOfFullId(context.fullId()))
    this.columnPaths.push({ qualifier: qualifier, column: null })
  }

  override visitSelectElement_dot_empty = (context: SelectElement_dot_emptyContext): void => {
    this.recordDanglingQualifier(context.uid())
  }

  override visitColumnNamePath_dot_empty = (context: ColumnNamePath_dot_emptyContext): void => {
    this.recordDanglingQualifier(context.uid())
  }

  override visitColumnName = (context: ColumnNameContext): void => {
    this.recordColumnPath(context)
  }

  override visitColumnNamePath_default = (context: ColumnNamePath_defaultContext): void => {
    this.recordColumnPath(context)
  }

  override visitColumnNameCreate = (context: ColumnNameCreateContext): void => {
    this.recordColumnPath(context)
  }

  override visitFunctionName = (context: FunctionNameContext): void => {
    this.recordFunctionName(context.fullId())
  }

  override visitFunctionNameCreate = (context: FunctionNameCreateContext): void => {
    this.recordFunctionName(context.fullId())
  }

  override visitCallStatement = (context: CallStatementContext): void => {
    this.recordFunctionName(context.fullId())
    this.visitChildrenExcept(context, [context.fullId()])
  }

  finish(): SqlStatementIdentifiers {
    const tableReferences: SqlTableReference[] = []
    for (const table of this.tables) {
      this.addTableSpans(table)
      if (this.isCheckedTable(table)) tableReferences.push(toTableReference(table))
    }
    const qualifiedColumns: SqlQualifiedColumn[] = []
    for (const path of this.columnPaths) {
      this.addColumnPathSpans(path)
      const qualifiedColumn = toQualifiedColumn(path)
      if (qualifiedColumn) qualifiedColumns.push(qualifiedColumn)
    }
    return {
      usedDatabase: this.usedDatabase,
      tables: tableReferences,
      qualifiedColumns: qualifiedColumns,
      derivedNames: this.derivedNames,
      createdTables: this.createdTables,
      identifiers: this.identifiers,
    }
  }

  private visitPresent(child: ParseTree | null): void {
    if (child) this.visit(child)
  }

  private visitChildrenExcept(context: ParentNode, skipped: ReadonlyArray<ParseTree | null>): void {
    for (const child of context.children ?? []) {
      if (skipped.includes(child)) continue
      this.visit(child)
    }
  }

  private recordNamePart(kind: SqlIdentifierKind, part: SqlNamePart | null): void {
    if (!part) return
    this.identifiers.push(identifierSpan(kind, part))
  }

  private recordDatabaseName(fullId: FullIdContext | null | undefined): SqlNamePart | null {
    const parts = namePartsOfFullId(fullId)
    for (const part of parts) {
      this.identifiers.push(identifierSpan('database', part))
    }
    return lastPartOf(parts)
  }

  private recordFunctionName(fullId: FullIdContext | null | undefined): void {
    const name = tableNameOf(namePartsOfFullId(fullId))
    if (!name) return
    this.recordNamePart('database', name.database)
    this.identifiers.push(identifierSpan('function', name.table))
  }

  private recordTableAlias(alias: SqlNamePart): void {
    this.tableAliasNames.add(normalizedName(alias))
    this.identifiers.push(identifierSpan('tableAlias', alias))
  }

  private recordTable(occurrence: TableOccurrence): void {
    const name = tableNameOf(namePartsOfFullId(occurrence.name))
    if (!name) return
    const alias = namePartOfUid(occurrence.alias)
    if (alias) this.recordTableAlias(alias)
    this.tables.push({ ...name, alias: alias, mustExist: occurrence.mustExist })
  }

  private recordCreatedTable(fullId: FullIdContext | null | undefined): void {
    const name = tableNameOf(namePartsOfFullId(fullId))
    if (!name) return
    this.recordNamePart('database', name.database)
    this.identifiers.push(identifierSpan('table', name.table))
    this.createdTables.push(name.table.name)
  }

  private recordColumnPath(context: DottedNameContext): void {
    const path = columnPathOf(namePartsOfDottedName(context))
    if (path) this.columnPaths.push(path)
  }

  private recordDanglingQualifier(uid: UidContext | null): void {
    const qualifier = tableNameOf(presentParts([namePartOfUid(uid)]))
    this.columnPaths.push({ qualifier: qualifier, column: null })
  }

  private isTableAlias(part: SqlNamePart): boolean {
    return this.tableAliasNames.has(normalizedName(part))
  }

  private isAliasReference(table: CollectedTable): boolean {
    const isBareName = table.database === null && table.alias === null
    return isBareName && this.isTableAlias(table.table)
  }

  private isCheckedTable(table: CollectedTable): boolean {
    return table.mustExist && !this.isAliasReference(table)
  }

  private addTableSpans(table: CollectedTable): void {
    if (this.isAliasReference(table)) {
      this.identifiers.push(identifierSpan('tableAlias', table.table))
      return
    }
    this.recordNamePart('database', table.database)
    this.identifiers.push(identifierSpan('table', table.table))
  }

  private qualifierKind(qualifier: TableName): SqlIdentifierKind {
    const isAlias = qualifier.database === null && this.isTableAlias(qualifier.table)
    return isAlias ? 'tableAlias' : 'table'
  }

  private addColumnPathSpans(path: CollectedColumnPath): void {
    if (path.qualifier) {
      this.recordNamePart('database', path.qualifier.database)
      this.identifiers.push(
        identifierSpan(this.qualifierKind(path.qualifier), path.qualifier.table)
      )
    }
    this.recordNamePart('column', path.column)
  }
}

function collectStatementIdentifiers(statement: SqlStatementContext): SqlStatementIdentifiers {
  const collector = new StatementIdentifierCollector()
  collector.visitChildren(statement)
  return collector.finish()
}

class ProgramStatementVisitor extends MySqlParserVisitor<void> {
  readonly statements: SqlStatementIdentifiers[] = []

  override visitSqlStatement = (context: SqlStatementContext): void => {
    this.statements.push(collectStatementIdentifiers(context))
  }
}

export function classifySqlIdentifiers(
  parser: EditorMySQLParser,
  code: string
): SqlStatementIdentifiers[] {
  const program = parser.createParser(code).program()
  const visitor = new ProgramStatementVisitor()
  visitor.visit(program)
  return visitor.statements
}
