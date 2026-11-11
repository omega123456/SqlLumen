import type { GenerateDdlResponse, TableDesignerSchema } from '../../types/schema'
import { PLAYWRIGHT_MOCK_DATABASE } from './connections'

export const USERS_DESIGNER_SCHEMA: TableDesignerSchema = {
  tableName: 'users',
  columns: [
    {
      name: 'id',
      type: 'BIGINT',
      typeModifier: 'UNSIGNED',
      length: '20',
      nullable: false,
      isPrimaryKey: true,
      isAutoIncrement: true,
      defaultValue: { tag: 'NO_DEFAULT' },
      comment: '',
      originalName: 'id',
    },
    {
      name: 'username',
      type: 'VARCHAR',
      length: '64',
      nullable: false,
      isPrimaryKey: false,
      isAutoIncrement: false,
      defaultValue: { tag: 'NO_DEFAULT' },
      comment: '',
      originalName: 'username',
    },
    {
      name: 'email',
      type: 'VARCHAR',
      length: '255',
      nullable: true,
      isPrimaryKey: false,
      isAutoIncrement: false,
      defaultValue: { tag: 'NULL_DEFAULT' },
      comment: '',
      originalName: 'email',
    },
    {
      name: 'status',
      type: 'VARCHAR',
      length: '50',
      nullable: false,
      isPrimaryKey: false,
      isAutoIncrement: false,
      defaultValue: { tag: 'LITERAL', value: 'active' },
      comment: 'Account status',
      originalName: 'status',
    },
    {
      name: 'created_at',
      type: 'DATETIME',
      length: '',
      nullable: true,
      isPrimaryKey: false,
      isAutoIncrement: false,
      defaultValue: { tag: 'EXPRESSION', value: 'CURRENT_TIMESTAMP' },
      comment: 'Row creation timestamp',
      originalName: 'created_at',
    },
  ],
  indexes: [
    {
      name: 'PRIMARY',
      indexType: 'PRIMARY',
      columns: ['id'],
    },
    {
      name: 'uk_username',
      indexType: 'UNIQUE',
      columns: ['username'],
    },
  ],
  foreignKeys: [
    {
      name: 'fk_orders_user',
      sourceColumn: 'id',
      referencedDatabase: PLAYWRIGHT_MOCK_DATABASE,
      referencedTable: 'roles',
      referencedColumn: 'id',
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
      isComposite: false,
    },
    {
      name: 'fk_composite_example',
      sourceColumn: 'id',
      referencedDatabase: PLAYWRIGHT_MOCK_DATABASE,
      referencedTable: 'composite_table',
      referencedColumn: 'id',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      isComposite: true,
    },
  ],
  properties: {
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
    autoIncrement: 1,
    rowFormat: 'DYNAMIC',
    comment: 'User accounts table',
  },
}

export const CREATE_TABLE_DDL_PREVIEW: GenerateDdlResponse = {
  ddl: 'CREATE TABLE `mock_db`.`__new_table__` (\n  `id` BIGINT(20) NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
  warnings: [],
}

export const ALTER_TABLE_DDL_PREVIEW: GenerateDdlResponse = {
  ddl: 'ALTER TABLE `mock_db`.`users`\n  MODIFY COLUMN `email` VARCHAR(320) NOT NULL;',
  warnings: [],
}

export const TABLE_DDL_PREVIEW_BY_MODE: Record<string, GenerateDdlResponse> = {
  create: CREATE_TABLE_DDL_PREVIEW,
  default: ALTER_TABLE_DDL_PREVIEW,
}
