import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportLogs, listLogs } from '../../lib/log-commands'
import { ipc } from '../ipc-mock'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('log-commands', () => {
  it('sends the log listing and export requests with their filters', async () => {
    const response = {
      entries: [
        {
          id: 1,
          timestamp: '2026-06-06T12:00:00.000Z',
          level: 'ERROR',
          target: 'sqllumen_lib::tests',
          message: 'boom',
        },
      ],
      total: 1,
      page: 2,
      pageSize: 50,
    }
    ipc.override('list_logs', () => response)

    const result = await listLogs(2, 'warn')

    expect(ipc.payloads('list_logs')[0]).toEqual({
      page: 2,
      level: 'warn',
    })
    expect(result).toEqual(response)

    ipc.override('export_logs', () => 42)

    const exportLogsResult = await exportLogs('2026-06-01', '2026-06-07', '/tmp/logs.csv')

    expect(ipc.payloads('export_logs')[0]).toEqual({
      startTimestamp: '2026-06-01',
      endTimestamp: '2026-06-07',
      filePath: '/tmp/logs.csv',
    })
    expect(exportLogsResult).toBe(42)
  })
})
