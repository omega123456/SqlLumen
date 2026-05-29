import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  listCopyableObjects,
  startCopyToHost,
  getCopyProgress,
  cancelCopy,
  sanitizeCopyToHostParams,
} from '../../lib/copy-to-host-commands'
import type {
  CopyableObjects,
  CopyToHostParams,
  CopyProgress,
} from '../../lib/copy-to-host-commands'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listCopyableObjects', () => {
  it('calls invoke with correct command and returns grouped objects', async () => {
    const mockResponse: CopyableObjects = {
      tables: [
        { name: 'users', estimatedRows: 100 },
        { name: 'orders', estimatedRows: 500 },
      ],
      procedures: ['sp_recalc', 'sp_purge'],
      functions: ['fn_total'],
      triggers: ['trg_audit'],
      events: ['ev_nightly'],
    }
    ipc.override('list_copyable_objects', () => mockResponse)

    const result = await listCopyableObjects('conn-1', 'shop')
    expect(ipc.calls('list_copyable_objects')).toEqual([
      { connectionId: 'conn-1', database: 'shop' },
    ])
    expect(result).toEqual(mockResponse)
    expect(result.tables).toHaveLength(2)
    expect(result.tables[0]).toEqual({ name: 'users', estimatedRows: 100 })
    expect(result.procedures).toEqual(['sp_recalc', 'sp_purge'])
  })

  it('returns empty categories from the default fixture without crashing', async () => {
    const result = await listCopyableObjects('conn-1', 'shop')
    expect(result.events).toEqual([])
    expect(Array.isArray(result.functions)).toBe(true)
  })
})

describe('startCopyToHost', () => {
  it('preserves non-table objects before invoking a data-only copy', async () => {
    const params: CopyToHostParams = {
      sourceConnectionId: 'conn-source',
      sourceDatabase: 'shop',
      targetConnectionId: 'profile-target',
      targetDatabase: 'shop_copy',
      objects: {
        tables: ['users', 'orders'],
        procedures: ['sp_recalc'],
        functions: ['fn_total'],
        triggers: ['trg_audit'],
        events: ['ev_nightly'],
      },
      options: {
        copyStructure: false,
        copyData: true,
        dropIfExists: false,
        createIfNotExists: true,
        truncateBeforeInsert: false,
        insertMode: 'insert',
        ignoreDefiner: true,
      },
    }

    expect(sanitizeCopyToHostParams(params)).toBe(params)

    ipc.override('start_copy_to_host', () => 'copy-job-1')

    await startCopyToHost(params)

    expect(ipc.calls('start_copy_to_host')).toEqual([
      {
        params: {
          ...params,
        },
      },
    ])
  })

  it('calls invoke with the params key and returns the job id', async () => {
    const params: CopyToHostParams = {
      sourceConnectionId: 'conn-source',
      sourceDatabase: 'shop',
      targetConnectionId: 'profile-target',
      targetDatabase: 'shop_copy',
      objects: {
        tables: ['users', 'orders'],
        procedures: ['sp_recalc'],
        functions: [],
        triggers: ['trg_audit'],
        events: [],
      },
      options: {
        copyStructure: true,
        copyData: true,
        dropIfExists: false,
        createIfNotExists: true,
        truncateBeforeInsert: false,
        insertMode: 'insert',
        ignoreDefiner: true,
      },
    }
    ipc.override('start_copy_to_host', () => 'copy-job-1')

    const jobId = await startCopyToHost(params)
    expect(ipc.calls('start_copy_to_host')).toEqual([{ params }])
    expect(jobId).toBe('copy-job-1')

    const sentParams = (ipc.calls('start_copy_to_host')[0] as Record<string, unknown>)
      .params as CopyToHostParams
    expect(sentParams.objects.tables).toEqual(['users', 'orders'])
    expect(sentParams.options.insertMode).toBe('insert')
  })
})

describe('getCopyProgress', () => {
  it('calls invoke with the job id and returns progress', async () => {
    const mockProgress: CopyProgress = {
      jobId: 'copy-job-1',
      status: 'running',
      objectsTotal: 12,
      objectsDone: 3,
      currentObject: 'orders',
      currentObjectType: 'table',
      rowsTotal: 50000,
      rowsDone: 15420,
      errorMessage: null,
      cancelRequested: false,
    }
    ipc.override('get_copy_progress', () => mockProgress)

    const result = await getCopyProgress('copy-job-1')
    expect(ipc.calls('get_copy_progress')).toEqual([{ jobId: 'copy-job-1' }])
    expect(result).toEqual(mockProgress)
    expect(result.status).toBe('running')
    expect(result.rowsDone).toBe(15420)
  })

  it('returns the completed default-fixture shape', async () => {
    const result = await getCopyProgress('copy-job-1')
    expect(result.status).toBe('completed')
    expect(result.currentObject).toBeNull()
    expect(result.rowsTotal).toBeNull()
  })
})

describe('cancelCopy', () => {
  it('calls invoke with the job id', async () => {
    ipc.override('cancel_copy', () => null)

    await cancelCopy('copy-job-1')
    expect(ipc.calls('cancel_copy')).toEqual([{ jobId: 'copy-job-1' }])
  })
})
