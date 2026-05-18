import { describe, expect, it } from 'vitest'

import { ipc } from '../ipc-mock'
import {
  applyTableDdl,
  generateTableDdl,
  loadTableForDesigner,
} from '../../lib/table-designer-commands'

describe('loadTableForDesigner', () => {
  it('calls invoke with the correct command and args', async () => {
    const response = {
      tableName: 'users',
      columns: [],
      indexes: [],
      foreignKeys: [],
      properties: {
        engine: 'InnoDB',
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
        autoIncrement: 1,
        rowFormat: 'DYNAMIC',
        comment: '',
      },
    }

    ipc.override('load_table_for_designer', () => response)

    const result = await loadTableForDesigner('conn-1', 'app_db', 'users')

    expect(ipc.calls('load_table_for_designer')).toEqual([
      { connectionId: 'conn-1', database: 'app_db', tableName: 'users' },
    ])
    expect(result).toEqual(response)
  })
})

describe('generateTableDdl', () => {
  it('calls invoke with the correct command and request shape', async () => {
    const request = {
      originalSchema: null,
      currentSchema: {
        tableName: '__new_table__',
        columns: [],
        indexes: [],
        foreignKeys: [],
        properties: {
          engine: 'InnoDB',
          charset: 'utf8mb4',
          collation: 'utf8mb4_unicode_ci',
          autoIncrement: null,
          rowFormat: 'DYNAMIC',
          comment: '',
        },
      },
      database: 'mock_db',
      mode: 'create' as const,
    }
    const response = {
      ddl: 'CREATE TABLE `mock_db`.`__new_table__` (...)',
      warnings: [],
    }

    ipc.override('generate_table_ddl', () => response)

    const result = await generateTableDdl(request)

    expect(ipc.calls('generate_table_ddl')).toEqual([{ request }])
    expect(result).toEqual(response)
  })
})

describe('applyTableDdl', () => {
  it('calls invoke with the correct command and args', async () => {
    const result = await applyTableDdl(
      'conn-1',
      'app_db',
      'ALTER TABLE `users` ADD COLUMN `x` INT;'
    )

    expect(ipc.calls('apply_table_ddl')).toEqual([
      {
        connectionId: 'conn-1',
        database: 'app_db',
        ddl: 'ALTER TABLE `users` ADD COLUMN `x` INT;',
      },
    ])
    expect(result).toBeUndefined()
  })

  it('propagates invoke errors', async () => {
    ipc.override('apply_table_ddl', () => {
      throw new Error('DDL failed')
    })

    await expect(applyTableDdl('conn-1', 'app_db', 'ALTER TABLE `users` BROKEN')).rejects.toThrow(
      'DDL failed'
    )
  })
})
