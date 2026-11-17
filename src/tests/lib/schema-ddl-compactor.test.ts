import { describe, it, expect } from 'vitest'
import { compactSchemaDdl, quoteIdentifier } from '../../lib/schema-ddl-compactor'
import type { TableInfo, ColumnMeta, ForeignKeyInfo, IndexInfo } from '../../types/schema'

describe('quoteIdentifier', () => {
  it('wraps a plain name in backticks', () => {
    expect(quoteIdentifier('users')).toBe('`users`')
  })

  it('escapes embedded backticks by doubling them', () => {
    expect(quoteIdentifier('my`db')).toBe('`my``db`')
  })
})

describe('compactSchemaDdl', () => {
  it('returns empty DDL and 0 tokens for empty input', () => {
    const result = compactSchemaDdl({ tables: {}, columns: {}, foreignKeys: {}, indexes: {} })
    expect(result.ddl).toBe('')
    expect(result.estimatedTokens).toBe(0)
    expect(result.warning).toBe(false)
  })

  it('handles missing column entries gracefully', () => {
    const tables: Record<string, TableInfo[]> = {
      testdb: [{ name: 'missing', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    // No column entry for testdb.missing
    const columns: Record<string, ColumnMeta[]> = {}

    const result = compactSchemaDdl({
      tables: tables,
      columns: columns,
      foreignKeys: {},
      indexes: {},
    })
    expect(result.ddl).toBe('CREATE TABLE `testdb`.`missing` ();')
  })

  it('estimates tokens using ~4 chars/token heuristic', () => {
    const tables: Record<string, TableInfo[]> = {
      db: [{ name: 'test', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'db.test': [{ name: 'id', dataType: 'INT' }],
    }

    const result = compactSchemaDdl({
      tables: tables,
      columns: columns,
      foreignKeys: {},
      indexes: {},
    })
    expect(result.ddl).toBe('CREATE TABLE `db`.`test` (`id` INT);')
    expect(result.estimatedTokens).toBe(Math.ceil(result.ddl.length / 4))
  })

  // --- New tests for quoting & escaping ---

  // --- Index tests ---

  it('includes a UNIQUE INDEX in the DDL output', () => {
    const tables: Record<string, TableInfo[]> = {
      mydb: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
      ],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'mydb.users': [
        { name: 'id', dataType: 'INT' },
        { name: 'email', dataType: 'VARCHAR(255)' },
      ],
    }
    const indexes: Record<string, IndexInfo[]> = {
      'mydb.users': [
        {
          name: 'uk_email',
          indexType: 'BTREE',
          cardinality: null,
          columns: ['email'],
          isVisible: true,
          isUnique: true,
        },
      ],
    }

    const result = compactSchemaDdl({
      tables: tables,
      columns: columns,
      foreignKeys: {},
      indexes: indexes,
    })
    expect(result.ddl).toContain('UNIQUE INDEX `uk_email` (`email`)')
  })

  // --- Foreign key tests ---

  it('places indexes after columns and FKs after indexes', () => {
    const tables: Record<string, TableInfo[]> = {
      mydb: [{ name: 'orders', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'mydb.orders': [
        { name: 'id', dataType: 'INT' },
        { name: 'user_id', dataType: 'INT' },
      ],
    }
    const foreignKeys: Record<string, ForeignKeyInfo[]> = {
      'mydb.orders': [
        {
          name: 'fk_user',
          columnName: 'user_id',
          referencedDatabase: 'mydb',
          referencedTable: 'users',
          referencedColumn: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
        },
      ],
    }
    const indexes: Record<string, IndexInfo[]> = {
      'mydb.orders': [
        {
          name: 'idx_user_id',
          indexType: 'BTREE',
          cardinality: null,
          columns: ['user_id'],
          isVisible: true,
          isUnique: false,
        },
      ],
    }

    const result = compactSchemaDdl({
      tables: tables,
      columns: columns,
      foreignKeys: foreignKeys,
      indexes: indexes,
    })
    const ddl = result.ddl
    const idxPos = ddl.indexOf('INDEX `idx_user_id`')
    const fkPos = ddl.indexOf('CONSTRAINT `fk_user`')
    const colPos = ddl.indexOf('`id` INT')
    expect(colPos).toBeLessThan(idxPos)
    expect(idxPos).toBeLessThan(fkPos)
  })
})
