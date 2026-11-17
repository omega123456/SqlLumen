import { describe, it, expect } from 'vitest'

import { ipc } from '../../ipc-mock'
import { invokeArgumentCommand, invokeCommand } from '../../../lib/ipc/dispatch'

describe('invokeCommand', () => {
  it('wraps the request in a payload and returns the response', async () => {
    ipc.override('list_schema_objects', () => ['users', 'orders'])

    const response = await invokeCommand({
      command: 'list_schema_objects',
      payload: { connectionId: 'conn-1', database: 'mydb', objectType: 'table' },
    })

    expect(response).toEqual(['users', 'orders'])
    expect(ipc.calls('list_schema_objects')).toEqual([
      { payload: { connectionId: 'conn-1', database: 'mydb', objectType: 'table' } },
    ])
  })

  it('propagates the error thrown by the backend command', async () => {
    ipc.override('list_schema_objects', () => {
      throw new Error('Unknown type')
    })

    await expect(
      invokeCommand({
        command: 'list_schema_objects',
        payload: { connectionId: 'conn-1', database: 'mydb', objectType: 'bad' },
      })
    ).rejects.toThrow('Unknown type')
  })
})

describe('invokeArgumentCommand', () => {
  it('sends the argument as is and returns the response', async () => {
    ipc.override('list_databases', () => ['db1', 'db2'])

    const response = await invokeArgumentCommand({
      command: 'list_databases',
      argument: { connectionId: 'conn-1' },
    })

    expect(response).toEqual(['db1', 'db2'])
    expect(ipc.calls('list_databases')).toEqual([{ connectionId: 'conn-1' }])
  })

  it('propagates the error thrown by the backend command', async () => {
    ipc.override('list_databases', () => {
      throw new Error('Not connected')
    })

    await expect(
      invokeArgumentCommand({ command: 'list_databases', argument: { connectionId: 'conn-1' } })
    ).rejects.toThrow('Not connected')
  })
})
