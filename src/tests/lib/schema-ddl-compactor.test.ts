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

  it('handles multiple embedded backticks', () => {
    expect(quoteIdentifier('a`b`c')).toBe('`a``b``c`')
  })

  it('handles empty string', () => {
    expect(quoteIdentifier('')).toBe('``')
  })
})

describe('compactSchemaDdl', () => {
  it('returns empty DDL and 0 tokens for empty input', () => {
    const result = compactSchemaDdl({}, {}, {}, {})
    expect(result.ddl).toBe('')
    expect(result.estimatedTokens).toBe(0)
    expect(result.warning).toBe(false)
  })

  it('generates database-qualified DDL for a single table with multiple columns', () => {
    const tables: Record<string, TableInfo[]> = {
      mydb: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
      ],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'mydb.users': [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR(255)' },
        { name: 'email', dataType: 'VARCHAR(255)' },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toBe(
      'CREATE TABLE `mydb`.`users` (`id` INT, `name` VARCHAR(255), `email` VARCHAR(255));'
    )
    expect(result.estimatedTokens).toBeGreaterThan(0)
    expect(result.warning).toBe(false)
  })

  it('generates database-qualified DDL for multiple tables in the same database', () => {
    const tables: Record<string, TableInfo[]> = {
      shop: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
        { name: 'orders', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 500, dataSize: 2048 },
      ],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'shop.users': [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR(255)' },
      ],
      'shop.orders': [
        { name: 'id', dataType: 'INT' },
        { name: 'user_id', dataType: 'INT' },
        { name: 'total', dataType: 'DECIMAL(10,2)' },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    const lines = result.ddl.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('CREATE TABLE `shop`.`users` (`id` INT, `name` VARCHAR(255));')
    expect(lines[1]).toBe(
      'CREATE TABLE `shop`.`orders` (`id` INT, `user_id` INT, `total` DECIMAL(10,2));'
    )
  })

  it('generates DDL spanning multiple databases', () => {
    const tables: Record<string, TableInfo[]> = {
      app_db: [
        { name: 'accounts', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 50, dataSize: 512 },
      ],
      analytics: [
        { name: 'events', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 10000, dataSize: 8192 },
      ],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'app_db.accounts': [
        { name: 'id', dataType: 'INT' },
        { name: 'email', dataType: 'VARCHAR(255)' },
      ],
      'analytics.events': [
        { name: 'id', dataType: 'BIGINT' },
        { name: 'event_type', dataType: 'VARCHAR(100)' },
        { name: 'created_at', dataType: 'TIMESTAMP' },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    const lines = result.ddl.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('CREATE TABLE `app_db`.`accounts` (`id` INT, `email` VARCHAR(255));')
    expect(lines[1]).toBe(
      'CREATE TABLE `analytics`.`events` (`id` BIGINT, `event_type` VARCHAR(100), `created_at` TIMESTAMP);'
    )
  })

  it('handles tables with no columns', () => {
    const tables: Record<string, TableInfo[]> = {
      testdb: [
        {
          name: 'empty_table',
          engine: 'InnoDB',
          charset: 'utf8mb4',
          rowCount: 0,
          dataSize: 0,
        },
      ],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'testdb.empty_table': [],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toBe('CREATE TABLE `testdb`.`empty_table` ();')
  })

  it('handles missing column entries gracefully', () => {
    const tables: Record<string, TableInfo[]> = {
      testdb: [{ name: 'missing', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    // No column entry for testdb.missing
    const columns: Record<string, ColumnMeta[]> = {}

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toBe('CREATE TABLE `testdb`.`missing` ();')
  })

  it('estimates tokens using ~4 chars/token heuristic', () => {
    const tables: Record<string, TableInfo[]> = {
      db: [{ name: 'test', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'db.test': [{ name: 'id', dataType: 'INT' }],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toBe('CREATE TABLE `db`.`test` (`id` INT);')
    expect(result.estimatedTokens).toBe(Math.ceil(result.ddl.length / 4))
  })

  it('sets warning when estimated tokens exceed 8000', () => {
    // Generate a large schema to exceed 8000 tokens (32000+ chars)
    const tables: Record<string, TableInfo[]> = { big_db: [] }
    const columns: Record<string, ColumnMeta[]> = {}

    for (let i = 0; i < 200; i++) {
      const tableName = `table_with_long_name_${i}`
      tables['big_db'].push({
        name: tableName,
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 0,
        dataSize: 0,
      })
      const tableCols: ColumnMeta[] = []
      for (let j = 0; j < 10; j++) {
        tableCols.push({
          name: `column_with_long_name_${j}`,
          dataType: 'VARCHAR(255)',
        })
      }
      columns[`big_db.${tableName}`] = tableCols
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.estimatedTokens).toBeGreaterThan(8000)
    expect(result.warning).toBe(true)
  })

  it('does not set warning when tokens are under 8000', () => {
    const tables: Record<string, TableInfo[]> = {
      db: [{ name: 'small', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'db.small': [{ name: 'id', dataType: 'INT' }],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.estimatedTokens).toBeLessThanOrEqual(8000)
    expect(result.warning).toBe(false)
  })

  it('includes column data types in the DDL', () => {
    const tables: Record<string, TableInfo[]> = {
      store: [{ name: 'products', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'store.products': [
        { name: 'id', dataType: 'BIGINT UNSIGNED' },
        { name: 'price', dataType: 'DECIMAL(10,2)' },
        { name: 'created_at', dataType: 'TIMESTAMP' },
        { name: 'description', dataType: 'TEXT' },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toContain('`id` BIGINT UNSIGNED')
    expect(result.ddl).toContain('`price` DECIMAL(10,2)')
    expect(result.ddl).toContain('`created_at` TIMESTAMP')
    expect(result.ddl).toContain('`description` TEXT')
  })

  it('produces single-line statements per table', () => {
    const tables: Record<string, TableInfo[]> = {
      db: [{ name: 'a', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'db.a': [
        { name: 'x', dataType: 'INT' },
        { name: 'y', dataType: 'INT' },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    // Each table is a single line — no newlines within a statement
    const lines = result.ddl.split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('\n')
  })

  it('handles a database with no tables as an empty entry', () => {
    const tables: Record<string, TableInfo[]> = {
      empty_db: [],
      populated_db: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 10, dataSize: 100 },
      ],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'populated_db.users': [{ name: 'id', dataType: 'INT' }],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    // Only the populated database's table appears
    expect(result.ddl).toBe('CREATE TABLE `populated_db`.`users` (`id` INT);')
  })

  // --- New tests for quoting & escaping ---

  it('quotes reserved word column names with backticks', () => {
    const tables: Record<string, TableInfo[]> = {
      mydb: [{ name: 'items', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'mydb.items': [
        { name: 'order', dataType: 'INT' },
        { name: 'select', dataType: 'VARCHAR(100)' },
        { name: 'key', dataType: 'INT' },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toContain('`order` INT')
    expect(result.ddl).toContain('`select` VARCHAR(100)')
    expect(result.ddl).toContain('`key` INT')
  })

  it('escapes embedded backticks in database names', () => {
    const tables: Record<string, TableInfo[]> = {
      'my`db': [{ name: 'tbl', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'my`db.tbl': [{ name: 'id', dataType: 'INT' }],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toContain('`my``db`')
  })

  it('quotes table names with spaces', () => {
    const tables: Record<string, TableInfo[]> = {
      mydb: [{ name: 'my table', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'mydb.my table': [{ name: 'id', dataType: 'INT' }],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toContain('`my table`')
  })

  // --- Index tests ---

  it('includes a non-PRIMARY index in the DDL output', () => {
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
          name: 'idx_email',
          indexType: 'BTREE',
          cardinality: null,
          columns: ['email'],
          isVisible: true,
          isUnique: false,
        },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, indexes)
    expect(result.ddl).toContain('INDEX `idx_email` (`email`)')
  })

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

    const result = compactSchemaDdl(tables, columns, {}, indexes)
    expect(result.ddl).toContain('UNIQUE INDEX `uk_email` (`email`)')
  })

  it('omits the PRIMARY index from DDL output', () => {
    const tables: Record<string, TableInfo[]> = {
      mydb: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
      ],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'mydb.users': [{ name: 'id', dataType: 'INT' }],
    }
    const indexes: Record<string, IndexInfo[]> = {
      'mydb.users': [
        {
          name: 'PRIMARY',
          indexType: 'BTREE',
          cardinality: 100,
          columns: ['id'],
          isVisible: true,
          isUnique: true,
        },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, indexes)
    expect(result.ddl).not.toContain('PRIMARY')
    expect(result.ddl).toBe('CREATE TABLE `mydb`.`users` (`id` INT);')
  })

  it('includes multi-column index in DDL', () => {
    const tables: Record<string, TableInfo[]> = {
      mydb: [{ name: 'events', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'mydb.events': [
        { name: 'user_id', dataType: 'INT' },
        { name: 'event_date', dataType: 'DATE' },
      ],
    }
    const indexes: Record<string, IndexInfo[]> = {
      'mydb.events': [
        {
          name: 'idx_user_date',
          indexType: 'BTREE',
          cardinality: null,
          columns: ['user_id', 'event_date'],
          isVisible: true,
          isUnique: false,
        },
      ],
    }

    const result = compactSchemaDdl(tables, columns, {}, indexes)
    expect(result.ddl).toContain('INDEX `idx_user_date` (`user_id`, `event_date`)')
  })

  // --- Foreign key tests ---

  it('includes a FK constraint in the DDL output', () => {
    const tables: Record<string, TableInfo[]> = {
      mydb: [
        { name: 'orders', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 500, dataSize: 2048 },
      ],
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

    const result = compactSchemaDdl(tables, columns, foreignKeys, {})
    expect(result.ddl).toContain(
      'CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `mydb`.`users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION'
    )
  })

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

    const result = compactSchemaDdl(tables, columns, foreignKeys, indexes)
    const ddl = result.ddl
    const idxPos = ddl.indexOf('INDEX `idx_user_id`')
    const fkPos = ddl.indexOf('CONSTRAINT `fk_user`')
    const colPos = ddl.indexOf('`id` INT')
    expect(colPos).toBeLessThan(idxPos)
    expect(idxPos).toBeLessThan(fkPos)
  })

  it('works with empty foreignKeys and indexes maps', () => {
    const tables: Record<string, TableInfo[]> = {
      db: [{ name: 't', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'db.t': [{ name: 'id', dataType: 'INT' }],
    }

    const result = compactSchemaDdl(tables, columns, {}, {})
    expect(result.ddl).toBe('CREATE TABLE `db`.`t` (`id` INT);')
  })

  it('defaults foreignKeys and indexes when omitted', () => {
    const tables: Record<string, TableInfo[]> = {
      db: [{ name: 't', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 0, dataSize: 0 }],
    }
    const columns: Record<string, ColumnMeta[]> = {
      'db.t': [{ name: 'id', dataType: 'INT' }],
    }

    const result = compactSchemaDdl(tables, columns)
    expect(result.ddl).toBe('CREATE TABLE `db`.`t` (`id` INT);')
  })
})
