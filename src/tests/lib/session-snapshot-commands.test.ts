import { describe, it, expect } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  createSessionSnapshot,
  deleteSessionSnapshot,
  getSessionSnapshot,
  listSessionSnapshots,
  type CreateSnapshotArgs,
  type SnapshotSummary,
} from '../../lib/session-snapshot-commands'

describe('createSessionSnapshot', () => {
  it('invokes create_session_snapshot with the full argument shape and returns the new id', async () => {
    ipc.override('create_session_snapshot', () => 42)

    const args: CreateSnapshotArgs = {
      triggerType: 'manual',
      connectionCount: 2,
      tabCount: 5,
      summaryJson: '[{"name":"ProdDB","tabCount":3}]',
      stateJson: '{"version":1,"connections":[]}',
      keep: 10,
    }

    const id = await createSessionSnapshot(args)

    expect(id).toBe(42)
    expect(ipc.calls('create_session_snapshot')).toEqual([
      {
        triggerType: 'manual',
        connectionCount: 2,
        tabCount: 5,
        summaryJson: '[{"name":"ProdDB","tabCount":3}]',
        stateJson: '{"version":1,"connections":[]}',
        keep: 10,
      },
    ])
  })
})

describe('listSessionSnapshots', () => {
  it('invokes list_session_snapshots and returns the typed summaries', async () => {
    const summaries: SnapshotSummary[] = [
      {
        id: 2,
        createdAt: '2026-06-05T14:32:00.000Z',
        triggerType: 'daily',
        connectionCount: 1,
        tabCount: 3,
        connections: [{ name: 'ProdDB', tabCount: 3 }],
      },
    ]
    ipc.override('list_session_snapshots', () => summaries)

    const result = await listSessionSnapshots()

    expect(result).toEqual(summaries)
    expect(ipc.calls('list_session_snapshots')).toHaveLength(1)
  })
})

describe('getSessionSnapshot', () => {
  it('invokes get_session_snapshot with the id and returns the state JSON string', async () => {
    const stateJson = '{"version":1,"connections":[]}'
    ipc.override('get_session_snapshot', () => stateJson)

    const result = await getSessionSnapshot(7)

    expect(result).toBe(stateJson)
    expect(ipc.calls('get_session_snapshot')).toEqual([{ id: 7 }])
  })

  it('returns null when the snapshot no longer exists', async () => {
    ipc.override('get_session_snapshot', () => null)

    const result = await getSessionSnapshot(99)

    expect(result).toBeNull()
    expect(ipc.calls('get_session_snapshot')).toEqual([{ id: 99 }])
  })
})

describe('deleteSessionSnapshot', () => {
  it('invokes delete_session_snapshot with the id and resolves void', async () => {
    ipc.override('delete_session_snapshot', () => undefined)

    await expect(deleteSessionSnapshot(3)).resolves.toBeUndefined()
    expect(ipc.calls('delete_session_snapshot')).toEqual([{ id: 3 }])
  })
})
