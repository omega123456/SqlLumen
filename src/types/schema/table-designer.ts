export type DefaultValueModel =
  | { tag: 'NO_DEFAULT' }
  | { tag: 'NULL_DEFAULT' }
  | { tag: 'LITERAL'; value: string }
  | { tag: 'EXPRESSION'; value: string }

export interface TableDesignerColumnDef {
  name: string
  type: string
  typeModifier?: string
  length: string
  nullable: boolean
  isPrimaryKey: boolean
  isAutoIncrement: boolean
  defaultValue: DefaultValueModel
  comment: string
  originalName: string
}

export interface TableDesignerIndexDef {
  name: string
  indexType: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT'
  columns: string[]
}

export interface TableDesignerForeignKeyDef {
  name: string
  sourceColumn: string
  referencedDatabase: string
  referencedTable: string
  referencedColumn: string
  onDelete: string
  onUpdate: string
  isComposite: boolean
}

export interface TableDesignerProperties {
  engine: string
  charset: string
  collation: string
  autoIncrement: number | null
  rowFormat: string
  comment: string
}

export interface TableDesignerSchema {
  tableName: string
  columns: TableDesignerColumnDef[]
  indexes: TableDesignerIndexDef[]
  foreignKeys: TableDesignerForeignKeyDef[]
  properties: TableDesignerProperties
}

export interface GenerateDdlRequest {
  originalSchema: TableDesignerSchema | null
  currentSchema: TableDesignerSchema
  database: string
  mode: 'create' | 'alter'
}

export interface GenerateDdlResponse {
  ddl: string
  warnings: string[]
}
