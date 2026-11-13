import { describe, expect, it } from 'vitest'
import {
  isSameObjectIdentity,
  isSchemaInfoTabOfObject,
  isTableDataTabOfObject,
} from '../../lib/workspace-tab-matching'
import type { SchemaInfoTab, TableDataTab, WorkspaceTab } from '../../types/schema'

const USERS_IDENTITY = { databaseName: 'shop', objectName: 'users' }

const tableDataTab: TableDataTab = {
  id: 't1',
  type: 'table-data',
  label: 'users',
  connectionId: 'c1',
  databaseName: 'shop',
  objectName: 'users',
  objectType: 'table',
}

const schemaInfoTab: SchemaInfoTab = {
  id: 's1',
  type: 'schema-info',
  label: 'users',
  connectionId: 'c1',
  databaseName: 'shop',
  objectName: 'users',
  objectType: 'table',
}

const queryTab: WorkspaceTab = { id: 'q1', type: 'query-editor', label: 'Q', connectionId: 'c1' }

describe('isSameObjectIdentity', () => {
  it('needs both the database and the object name to match', () => {
    expect(
      isSameObjectIdentity(USERS_IDENTITY, { databaseName: 'shop', objectName: 'users' })
    ).toBe(true)
    expect(isSameObjectIdentity(USERS_IDENTITY, { databaseName: 'crm', objectName: 'users' })).toBe(
      false
    )
    expect(
      isSameObjectIdentity(USERS_IDENTITY, { databaseName: 'shop', objectName: 'orders' })
    ).toBe(false)
  })
})

describe('isTableDataTabOfObject', () => {
  it('matches only table-data tabs of the object', () => {
    expect(isTableDataTabOfObject(tableDataTab, USERS_IDENTITY)).toBe(true)
    expect(isTableDataTabOfObject(schemaInfoTab, USERS_IDENTITY)).toBe(false)
    expect(isTableDataTabOfObject(queryTab, USERS_IDENTITY)).toBe(false)
    expect(
      isTableDataTabOfObject(tableDataTab, { databaseName: 'shop', objectName: 'orders' })
    ).toBe(false)
  })
})

describe('isSchemaInfoTabOfObject', () => {
  it('matches only schema-info tabs of the object', () => {
    expect(isSchemaInfoTabOfObject(schemaInfoTab, USERS_IDENTITY)).toBe(true)
    expect(isSchemaInfoTabOfObject(tableDataTab, USERS_IDENTITY)).toBe(false)
    expect(
      isSchemaInfoTabOfObject(schemaInfoTab, { databaseName: 'crm', objectName: 'users' })
    ).toBe(false)
  })
})
