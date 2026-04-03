import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTableDdl,
  generateTableDdl,
  loadTableForDesigner,
} from '../../lib/table-designer-commands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockInvoke.mockReset()
})

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

    mockInvoke.mockResolvedValue(response)

    const result = await loadTableForDesigner('conn-1', 'app_db', 'users')

    expect(mockInvoke).toHaveBeenCalledWith('load_table_for_designer', {
      connectionId: 'conn-1',
      database: 'app_db',
      tableName: 'users',
    })
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

    mockInvoke.mockResolvedValue(response)

    const result = await generateTableDdl(request)

    expect(mockInvoke).toHaveBeenCalledWith('generate_table_ddl', { request })
    expect(result).toEqual(response)
  })
})

describe('applyTableDdl', () => {
  it('calls invoke with the correct command and args', async () => {
    mockInvoke.mockResolvedValue(undefined)

    const result = await applyTableDdl(
      'conn-1',
      'app_db',
      'ALTER TABLE `users` ADD COLUMN `x` INT;'
    )

    expect(mockInvoke).toHaveBeenCalledWith('apply_table_ddl', {
      connectionId: 'conn-1',
      database: 'app_db',
      ddl: 'ALTER TABLE `users` ADD COLUMN `x` INT;',
    })
    expect(result).toBeUndefined()
  })

  it('propagates invoke errors', async () => {
    mockInvoke.mockRejectedValue(new Error('DDL failed'))

    await expect(applyTableDdl('conn-1', 'app_db', 'ALTER TABLE `users` BROKEN')).rejects.toThrow(
      'DDL failed'
    )
  })
})
